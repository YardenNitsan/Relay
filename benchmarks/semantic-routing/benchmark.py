"""Run sequential CPU candidates. Development chooses thresholds; test never does."""
import argparse
import hashlib
import importlib.metadata
import json
import platform
import statistics
import time
from pathlib import Path
import psutil

ROOT = Path(__file__).resolve().parents[2]
TRAIN = ROOT / "benchmarks/task-intent/development-v1.json"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def metrics(cases, rows, threshold):
    outcomes = []
    for case, row in zip(cases, rows):
        predicted = [key for key, score in row["scores"].items() if score >= threshold]
        missing = sorted(set(case["required"]) - set(predicted))
        forbidden = sorted(set(case["forbidden"]) & set(predicted))
        outcomes.append({"id": case["id"], "language": case["language"], "predicted": predicted,
                         "missing": missing, "forbidden": forbidden, "satisfied": not missing and not forbidden,
                         "uncertain": not predicted, "latencyMs": row["latencyMs"], "scores": row["scores"]})
    return {"satisfied": sum(row["satisfied"] for row in outcomes), "total": len(cases),
            "missingRequired": sum(len(row["missing"]) for row in outcomes),
            "forbiddenLabels": sum(len(row["forbidden"]) for row in outcomes),
            "uncertain": sum(row["uncertain"] for row in outcomes),
            "languages": {lang: {"satisfied": sum(row["satisfied"] for row in outcomes if row["language"] == lang),
                                    "total": sum(row["language"] == lang for row in outcomes)} for lang in ["en", "he"]},
            "outcomes": outcomes}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", choices=["minilm", "e5", "nli"], required=True)
    parser.add_argument("--cases", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--threshold", type=float)
    parser.add_argument("--development", action="store_true")
    args = parser.parse_args()
    if args.development == (args.threshold is not None):
        parser.error("Choose development calibration OR an explicitly frozen threshold")
    cases = json.loads(Path(args.cases).read_text(encoding="utf-8"))["cases"]
    if not cases or len(cases) > 512:
        raise ValueError("Expected 1–512 bounded cases")
    if psutil.virtual_memory().available < 3 * 1024 ** 3:
        raise RuntimeError("Insufficient free RAM for isolated CPU experiment")
    process = psutil.Process()
    before = process.memory_info().rss
    start = time.perf_counter()
    from candidates import SemanticCandidate, NliCandidate
    models = json.loads((ROOT / "output/final-evolution/router-model-paths.json").read_text(encoding="utf-8"))
    model = models[["minilm", "e5", "nli"].index(args.candidate)]
    candidate = NliCandidate(model["path"]) if args.candidate == "nli" else SemanticCandidate(model["path"], str(TRAIN), args.candidate == "e5")
    initialization_ms = (time.perf_counter() - start) * 1000
    candidate.scores("Hello")
    rows = []
    for case in cases:
        begin = time.perf_counter()
        scores = candidate.scores(case["objective"])
        rows.append({"scores": scores, "latencyMs": (time.perf_counter() - begin) * 1000})
    threshold = args.threshold
    trials = []
    if args.development:
        for value in range(10, 96, 5):
            trial = metrics(cases, rows, value / 100)
            trials.append({key: trial[key] for key in ["satisfied", "missingRequired", "forbiddenLabels"]} | {"threshold": value / 100})
        threshold = max(trials, key=lambda trial: (trial["satisfied"], -trial["forbiddenLabels"], -trial["missingRequired"], trial["threshold"]))["threshold"]
    latencies = sorted(row["latencyMs"] for row in rows)
    output = {"candidate": args.candidate, "model": {k: model[k] for k in ["model", "revision"]},
              "mode": "development" if args.development else "frozen-test", "threshold": threshold,
              "hashes": {"cases": sha(args.cases), "training": sha(TRAIN), "adapter": sha(Path(__file__).with_name("candidates.py")), "evaluator": sha(__file__)},
              "runtime": {"os": platform.platform(), "python": platform.python_version(),
                          "packages": {name: importlib.metadata.version(name) for name in ["semantic-router", "transformers", "torch"]},
                          "threads": 2, "device": "cpu", "vramBytes": 0, "initializationMs": initialization_ms,
                          "rssBytes": process.memory_info().rss, "rssIncreaseBytes": process.memory_info().rss - before,
                          "peakWorkingSetBytes": getattr(process.memory_info(), "peak_wset", None),
                          "medianMs": statistics.median(latencies), "p95Ms": latencies[int((len(latencies) - 1) * .95)]},
              "metrics": metrics(cases, rows, threshold), "developmentTrials": trials,
              "limits": "Synthetic intent labels only; partial labels do not establish precision. No downstream model task success measured."}
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"candidate": args.candidate, "threshold": threshold, "satisfied": output["metrics"]["satisfied"], "total": len(cases), "runtime": output["runtime"]}))


if __name__ == "__main__":
    main()
