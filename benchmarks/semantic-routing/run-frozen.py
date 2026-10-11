"""Verify the freeze, then run every candidate in isolated sequential processes."""
import json
import subprocess
import sys
from pathlib import Path
from freeze import hash_file

ROOT = Path(__file__).resolve().parents[2]
manifest = json.loads((ROOT / "benchmarks/semantic-routing/freeze-v1.json").read_text(encoding="utf-8"))
for name, expected in manifest["hashes"].items():
    if hash_file(ROOT / name) != expected:
        raise RuntimeError(f"Frozen input changed: {name}")
output = ROOT / "output/final-evolution"
corpus = ROOT / "benchmarks/semantic-routing/heldout-v1.json"
subprocess.run(["node", "--import", "tsx", "benchmarks/semantic-routing/baseline.ts", str(corpus),
                str(output / "semantic-baseline-heldout.json")], cwd=ROOT, check=True)
for name, config in manifest["candidates"].items():
    subprocess.run([sys.executable, str(ROOT / "benchmarks/semantic-routing/benchmark.py"),
                    "--candidate", name, "--threshold", str(config["threshold"]), "--cases", str(corpus),
                    "--output", str(output / f"semantic-{name}-heldout.json")], cwd=ROOT, check=True)
selected = json.loads((output / f"semantic-{manifest['selectedOnDevelopment']}-heldout.json").read_text(encoding="utf-8"))
baseline = json.loads((output / "semantic-baseline-heldout.json").read_text(encoding="utf-8"))["metrics"]
metrics, runtime, gate = selected["metrics"], selected["runtime"], manifest["gate"]
checks = {
    "satisfiedImprovement": metrics["satisfied"] - baseline["satisfied"] >= gate["minimumSatisfiedImprovement"],
    "noLanguageRegression": all(metrics["languages"][lang]["satisfied"] >= baseline["languages"][lang]["satisfied"] for lang in ["en", "he"]),
    "forbiddenBound": metrics["forbiddenLabels"] <= baseline["forbiddenLabels"] + gate["maximumExtraForbidden"],
    "warmLatency": runtime["p95Ms"] < gate["p95LimitMs"],
    "residentMemory": runtime["rssBytes"] < gate["rssLimitBytes"],
    "initialization": runtime["initializationMs"] < gate["initializationLimitMs"],
}
report = {"selectedOnDevelopment": manifest["selectedOnDevelopment"], "passed": all(checks.values()), "checks": checks,
          "baselineSatisfied": baseline["satisfied"], "selectedSatisfied": metrics["satisfied"],
          "baselineForbidden": baseline["forbiddenLabels"], "selectedForbidden": metrics["forbiddenLabels"],
          "total": metrics["total"], "limits": "Intent experiment only; downstream/live acceptance remains separate."}
(output / "semantic-gate-heldout.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report))
sys.exit(0 if report["passed"] else 2)
