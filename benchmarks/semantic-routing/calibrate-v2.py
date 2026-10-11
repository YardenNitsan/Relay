"""Calibrate library route thresholds using explicitly consumed v1 data only.

No encoder weights are trained. Never read heldout-v2 here.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output/final-evolution"
LABELS = list(json.loads((OUT / "semantic-minilm-development.json").read_text(encoding="utf-8"))["metrics"]["outcomes"][0]["scores"])
cases = sum([json.loads((ROOT / f"benchmarks/semantic-routing/{name}-v1.json").read_text(encoding="utf-8"))["cases"] for name in ["development", "heldout"]], [])
reports = []
for candidate in ["minilm", "e5", "nli"]:
    rows = sum([json.loads((OUT / f"semantic-{candidate}-{name}.json").read_text(encoding="utf-8"))["metrics"]["outcomes"] for name in ["development", "heldout"]], [])
    assert len(cases) == len(rows) and all(c["id"] == r["id"] for c, r in zip(cases, rows))
    thresholds = {}
    insufficient = []
    for label in LABELS:
        # Unknown labels are not negative examples. Balance positive/negative
        # constraints so rare intents are not optimized away by class prevalence.
        positives = [r["scores"].get(label, -1) for c, r in zip(cases, rows) if label in c["required"]]
        negatives = [r["scores"].get(label, -1) for c, r in zip(cases, rows) if label in c["forbidden"]]
        if len(positives) < 2 or len(negatives) < 2:
            thresholds[label] = {'minilm': .4, 'e5': .85, 'nli': .45}[candidate]
            insufficient.append(label)
            continue
        def objective(t):
            fn = sum(s < t for s in positives) / len(positives)
            fp = sum(s >= t for s in negatives) / len(negatives)
            return (fn + fp, fp, -t)
        thresholds[label] = min([x / 100 for x in range(10, 96, 5)], key=objective)
    outcomes = []
    for case, row in zip(cases, rows):
        predicted = [label for label in LABELS if row["scores"].get(label, -1) >= thresholds[label]]
        missing = sorted(set(case["required"]) - set(predicted))
        forbidden = sorted(set(case["forbidden"]) & set(predicted))
        outcomes.append({"id": case["id"], "missing": missing, "forbidden": forbidden, "satisfied": not missing and not forbidden})
    reports.append({"candidate": candidate, "thresholds": thresholds, "uncalibrated": insufficient, "satisfied": sum(row["satisfied"] for row in outcomes),
                    "forbidden": sum(len(row["forbidden"]) for row in outcomes), "total": len(cases), "outcomes": outcomes})
selected = max(reports, key=lambda r: (r["satisfied"], -r["forbidden"]))
result = {"mode": "consumed-v1-development-only", "selected": selected["candidate"], "thresholds": selected["thresholds"], "reports": reports}
(OUT / "semantic-calibration-v2.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"selected": result["selected"], "reports": [{k: r[k] for k in ["candidate", "satisfied", "forbidden", "total"]} for r in reports]}))
