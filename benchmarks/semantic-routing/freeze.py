"""Create an exclusive experiment manifest without displaying test objectives."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FILES = ["benchmarks/semantic-routing/" + name for name in
         ["candidates.py", "benchmark.py", "baseline.ts", "protocol.md", "development-v1.json", "heldout-v1.json", "freeze.py"]]
FILES += ["benchmarks/task-intent/development-v1.json", "server/models/intent-phrases.ts"]


def hash_file(path):
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def main():
    development = {name: json.loads((ROOT / f"output/final-evolution/semantic-{name}-development.json").read_text(encoding="utf-8"))
                   for name in ["minilm", "e5", "nli"]}
    manifest = {"protocol": "relay-semantic-comparison-v1", "frozenAt": datetime.now(timezone.utc).isoformat(),
                "selectedOnDevelopment": "minilm", "hashEncoding": "bytes with CRLF normalized to LF",
                "hashes": {name: hash_file(ROOT / name) for name in FILES},
                "candidates": {name: {"threshold": report["threshold"], "model": report["model"],
                                      "packages": report["runtime"]["packages"]} for name, report in development.items()},
                "gate": {"minimumSatisfiedImprovement": 8, "noLanguageRegression": True,
                         "maximumExtraForbidden": 2, "p95LimitMs": 250, "rssLimitBytes": 1610612736,
                         "initializationLimitMs": 30000},
                "disclosure": "Synthetic test authored by independent reviewer without candidate/corpus/results access. Root froze candidates before reading or evaluating test objectives. No downstream task success inferred."}
    with (ROOT / "benchmarks/semantic-routing/freeze-v1.json").open("x", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")
    print("Frozen candidate, thresholds, evaluator and dataset hashes. Selected on development: minilm.")


if __name__ == "__main__":
    main()
