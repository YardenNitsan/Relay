"""Build consumed-development AI evaluation references; never train or read predictions.

Run with Python 3.10+: python build-evaluation-reference.py [--output PATH]
The default output is reference-v4.json beside this script. Existing output is refused.
Only the five named tracked inputs below are read; historical datasets and the
ignored adjudication packet are neither required nor opened.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from hashlib import sha256
import json
from pathlib import Path


LABELS = (
    "debugging", "coding", "repository_architecture", "multi_file_implementation",
    "structured_extraction", "document_analysis", "research_synthesis", "tool_driven",
    "planning_delegation", "review_verification", "security_review", "mathematics",
    "complex_reasoning", "multimodal", "factual_explanation", "conversation",
)
STATES = {"positive", "negative", "unresolved"}
DISPOSITIONS = {"include", "ambiguous", "insufficient_input", "out_of_taxonomy"}
BASE = Path(__file__).resolve().parent
FILES = {
    "inputs": "supervised-inputs-v4.json",
    "reviewerA": "annotations-v4-a.json",
    "reviewerB": "annotations-v4-b.json",
    "adjudication": "adjudication-v4.json",
    "rubric": "annotation-rubric-v4.md",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def index(rows: list[dict], name: str) -> dict[str, dict]:
    require(isinstance(rows, list), f"{name}: expected cases array")
    result = {row["id"]: row for row in rows}
    require(len(result) == len(rows), f"{name}: duplicate IDs")
    return result


def validate_labels(row: dict, context: str) -> None:
    labels = row["labels"]
    require(set(labels) == set(LABELS), f"{context}: expected all sixteen labels")
    require(all(value in STATES for value in labels.values()), f"{context}: invalid tri-state")
    require(row["disposition"] in DISPOSITIONS, f"{context}: invalid disposition")
    require(labels["multi_file_implementation"] != "positive" or labels["coding"] == "positive",
            f"{context}: multi-file implication violated")
    require(labels["security_review"] != "positive" or labels["review_verification"] == "positive",
            f"{context}: security implication violated")
    if row["disposition"] == "include":
        require("unresolved" not in labels.values() and "positive" in labels.values(),
                f"{context}: included row must be resolved and have positives")


def build() -> dict:
    raw = {key: (BASE / name).read_bytes() for key, name in FILES.items()}
    hashes = {key: sha256(value).hexdigest() for key, value in raw.items()}
    docs = {key: json.loads(value) for key, value in raw.items() if key != "rubric"}
    inputs, review_a, review_b, adjudication = (docs[key] for key in (
        "inputs", "reviewerA", "reviewerB", "adjudication"))
    for name, document in (("inputs", inputs), ("A", review_a), ("B", review_b)):
        require(document["rubricSha256"] == hashes["rubric"], f"{name}: rubric hash mismatch")
    require(review_a["inputSha256"] == hashes["inputs"], "A: input hash mismatch")
    require(review_b["inputsSha256"] == hashes["inputs"], "B: input hash mismatch")
    upstream = adjudication["provenance"]["upstreamManifestCopiedFromPacket"]
    for key in ("inputs", "reviewerA", "reviewerB", "rubric"):
        require(upstream[key]["sha256"] == hashes[key], f"Adjudication: {key} hash mismatch")
        require(Path(upstream[key]["path"]).name == FILES[key], f"Adjudication: {key} path mismatch")
    rubric_refs = [item for item in adjudication["provenance"]["directInputs"]
                   if Path(item["path"]).name == FILES["rubric"]]
    require(len(rubric_refs) == 1 and rubric_refs[0]["sha256"] == hashes["rubric"],
            "Adjudication direct rubric reference mismatch")
    require(adjudication["reviewer"]["humanGroundTruth"] is False, "Unexpected human-ground-truth claim")

    source = index(inputs["cases"], "inputs")
    a = index(review_a["cases"], "A")
    b = index(review_b["cases"], "B")
    changes = index(adjudication["cases"], "adjudication")
    expected_ids = {f"consumed-{number:03d}" for number in range(1, 201)}
    require(set(source) == set(a) == set(b) == expected_ids, "Full 200-row ID coverage mismatch")
    require(set(changes) <= expected_ids, "Unknown adjudication ID")

    memberships = {}
    for reviewer, records, field in (("A", a, "scenarioFamilyId"), ("B", b, "familyId")):
        groups = defaultdict(set)
        for row in records.values():
            require(isinstance(row[field], str) and bool(row[field]), f"{reviewer}: missing family")
            groups[row[field]].add(row["id"])
        memberships[reviewer] = {row_id: members for members in groups.values() for row_id in members}

    parent = {row_id: row_id for row_id in expected_ids}

    def find(row_id: str) -> str:
        require(row_id in parent, f"Unknown family member: {row_id}")
        if parent[row_id] != row_id:
            parent[row_id] = find(parent[row_id])
        return parent[row_id]

    def union(members) -> None:
        ordered = sorted(members)
        require(bool(ordered) and len(set(ordered)) == len(ordered), "Empty/duplicate family members")
        for member in ordered:
            left, right = sorted((find(ordered[0]), find(member)))
            parent[right] = left

    for reviewer_groups in memberships.values():
        for members in reviewer_groups.values():
            union(members)
    component_ids = set()
    component_members = set()
    for component in adjudication["familyComponents"]:
        require(component["familyId"] not in component_ids, "Duplicate adjudication family ID")
        component_ids.add(component["familyId"])
        require(not component_members.intersection(component["members"]), "Overlapping adjudication components")
        component_members.update(component["members"])
        union(component["members"])
    adjudication_groups = {group["familyId"]: set(group["members"])
                           for group in adjudication["familyComponents"]}

    counts = Counter()
    required_adjudication_ids = set()
    merged = []
    for row_id in sorted(source):
        original, first, second = source[row_id], a[row_id], b[row_id]
        actual_hash = sha256(original["objective"].encode("utf-8")).hexdigest()
        require(original["effectiveSha256"] == original["originalSha256"] == actual_hash,
                f"{row_id}: original/effective objective hash mismatch")
        require(original["inputDisposition"] == "ready", f"{row_id}: input is not frozen ready input")
        require(first["effectiveSha256"] == second["effectiveSha256"] == actual_hash,
                f"{row_id}: annotation objective hash mismatch")
        require(first["language"] == second["language"] == original["language"] in {"en", "he", "mixed"},
                f"{row_id}: language disagreement requires explicit adjudication")
        require(second["source"] == original["source"] and second["sourceId"] == original["sourceId"],
                f"{row_id}: original source metadata mismatch")
        require(first["reviewedAllLabels"] is True and second["allSixteenLabelsReviewed"] is True,
                f"{row_id}: incomplete review declaration")
        validate_labels(first, f"A/{row_id}")
        validate_labels(second, f"B/{row_id}")
        disputed = {label for label in LABELS if first["labels"][label] != second["labels"][label]}
        disposition_disputed = first["disposition"] != second["disposition"]
        family_disputed = memberships["A"][row_id] != memberships["B"][row_id]
        if disputed or disposition_disputed or family_disputed:
            required_adjudication_ids.add(row_id)
            require(row_id in changes, f"{row_id}: uncovered dispute")
        counts["rowsWithLabelDisagreements"] += bool(disputed)
        counts["labelDecisionDisagreements"] += len(disputed)
        counts["dispositionDisagreements"] += disposition_disputed
        counts["familyMembershipDisagreements"] += family_disputed
        labels = dict(first["labels"])
        disposition = first["disposition"]
        change = changes.get(row_id)
        if change:
            require(change["reviewedObjective"] == original["objective"] and
                    change["effectiveSha256"] == actual_hash, f"{row_id}: adjudication input mismatch")
            label_changes = change["labelDecisions"]
            require(len({entry["label"] for entry in label_changes}) == len(label_changes),
                    f"{row_id}: duplicate label decision")
            require({entry["label"] for entry in label_changes} == disputed,
                    f"{row_id}: disputed label coverage mismatch")
            for entry in label_changes:
                label = entry["label"]
                require(entry["before"] == {"A": first["labels"][label], "B": second["labels"][label]},
                        f"{row_id}/{label}: before values mismatch")
                require(entry["decision"] in STATES and bool(entry["rationale"].strip()),
                        f"{row_id}/{label}: missing decision/rationale")
                labels[label] = entry["decision"]
            dd = change["dispositionDecision"]
            require(bool(dd) == disposition_disputed, f"{row_id}: disposition coverage mismatch")
            if dd:
                require(dd["before"] == {"A": first["disposition"], "B": second["disposition"]},
                        f"{row_id}: disposition before values mismatch")
                require(dd["decision"] in DISPOSITIONS and bool(dd["rationale"].strip()),
                        f"{row_id}: missing disposition/rationale")
                disposition = dd["decision"]
            effective = change["effective"]
            require(effective["labels"] == labels and effective["disposition"] == disposition and
                    effective["language"] == original["language"], f"{row_id}: effective values mismatch")
            require(change["familyDecision"]["membershipWasDisputed"] == family_disputed,
                    f"{row_id}: family dispute mismatch")
            require(row_id in adjudication_groups[effective["familyId"]], f"{row_id}: family membership mismatch")
            require(memberships["A"][row_id] | memberships["B"][row_id] <=
                    adjudication_groups[effective["familyId"]], f"{row_id}: adjudication lost family link")
        unresolved = [label for label in LABELS if labels[label] == "unresolved"]
        positives = [label for label in LABELS if labels[label] == "positive"]
        eligible = disposition == "include" and not unresolved and bool(positives)
        if change:
            require(change["effective"]["unresolvedLabels"] == unresolved and
                    change["effective"]["positiveLabels"] == positives and
                    change["effective"]["eligibleForCompleteBinaryLabelMetrics"] == eligible,
                    f"{row_id}: adjudication derived values mismatch")
        row = {key: original[key] for key in ("id", "source", "sourceId", "language", "objective",
                                             "originalSha256", "effectiveSha256", "tokenCount", "inputDisposition")}
        row.update(labels=labels, disposition=disposition, unresolvedLabels=unresolved,
                   positiveLabels=positives, eligibleForCompleteBinaryLabelMetrics=eligible,
                   exclusionReasons=([f"disposition:{disposition}"] if disposition != "include" else []) +
                   (["unresolved_labels:" + ",".join(unresolved)] if unresolved else []) +
                   (["zero_positive_labels"] if not positives else []),
                   annotationProvenance={"reviewerA": first.get("evidence"), "reviewerB": second.get("evidence"),
                                         "adjudicationCaseId": row_id if change else None})
        validate_labels(row, f"merged/{row_id}")
        merged.append(row)
    require(set(changes) == required_adjudication_ids, "Adjudication IDs must exactly cover disputed rows")
    require(counts == Counter(rowsWithLabelDisagreements=34, labelDecisionDisagreements=36,
                              dispositionDisagreements=23, familyMembershipDisagreements=67),
            "Frozen v4 disagreement counts changed")

    groups = defaultdict(list)
    for row_id in sorted(expected_ids):
        groups[find(row_id)].append(row_id)
    families = []
    family_by_row = {}
    for members in sorted(groups.values()):
        digest = sha256("\n".join(members).encode("utf-8")).hexdigest()
        family_id = "scenario-v4-" + digest[:16]
        families.append({"familyId": family_id, "membershipSha256": digest, "members": members})
        for member in members:
            family_by_row[member] = family_id
    require(len({f["familyId"] for f in families}) == len(families), "Family hash collision")
    for row in merged:
        row["familyId"] = family_by_row[row["id"]]
    eligible_rows = [row for row in merged if row["eligibleForCompleteBinaryLabelMetrics"]]
    coverage = {label: {
        "allRows": dict(Counter(row["labels"][label] for row in merged)),
        "eligibleRows": {state: sum(row["labels"][label] == state for row in eligible_rows)
                         for state in ("positive", "negative", "unresolved")},
        "eligiblePositiveFamilies": len({row["familyId"] for row in eligible_rows
                                         if row["labels"][label] == "positive"}),
    } for label in LABELS}
    return {
        "schemaVersion": 1, "artifactType": "consumed-development-evaluation-reference",
        "purpose": "Compare existing ready-made pretrained routers using AI reference labels only. No training, custom classifier, threshold fitting, predictions, or unseen-final-evaluation claim.",
        "humanGroundTruth": False,
        "limitations": "Independent AI reviews and AI adjudication are fallible; agreement is not human validation. Unresolved labels and exclusions are preserved. Conservative family unions may overgroup distinct scenarios.",
        "provenance": {"builder": "build-evaluation-reference.py", "builderSha256": sha256(Path(__file__).read_bytes()).hexdigest(),
                       "inputs": {key: {"path": name, "sha256": hashes[key]} for key, name in FILES.items()},
                       "upstreamSourceHashesCopiedOnly": inputs["sources"],
                       "ignoredAdjudicationPacketRequired": False},
        "preprocessing": inputs["preprocessing"], "labels": list(LABELS),
        "eligibilityRule": "disposition is include, no unresolved labels, and at least one positive; excluded rows are never sixteen negative examples",
        "familyPolicy": "Connected components of all A/B scenario memberships plus adjudication family constraints; stable IDs hash sorted full component membership. Evaluation provenance only, never training authorization.",
        "summary": {"rows": len(merged), "eligibleRows": len(eligible_rows), "excludedRows": len(merged) - len(eligible_rows),
                    "rowsWithUnresolvedLabels": sum(bool(row["unresolvedLabels"]) for row in merged),
                    "families": len(families), "eligibleFamilies": len({row["familyId"] for row in eligible_rows}),
                    "dispositions": dict(Counter(row["disposition"] for row in merged)),
                    "languages": dict(Counter(row["language"] for row in merged)),
                    "excludedLanguages": dict(Counter(row["language"] for row in merged if not row["eligibleForCompleteBinaryLabelMetrics"])),
                    "adjudicatedRows": len(changes), **counts},
        "classCoverage": coverage, "families": families, "cases": merged,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=BASE / "reference-v4.json")
    args = parser.parse_args()
    output = args.output.resolve()
    require(not output.exists(), f"Refusing to overwrite existing output: {output}")
    reference = build()  # Every validation completes before output creation.
    encoded = (json.dumps(reference, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    with output.open("xb") as handle:  # Exclusive creation also prevents a check/write race.
        handle.write(encoded)
    print(json.dumps({"output": str(output), "sha256": sha256(encoded).hexdigest(),
                      "summary": reference["summary"]}, indent=2))


if __name__ == "__main__":
    main()
