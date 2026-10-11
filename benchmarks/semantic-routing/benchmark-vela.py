"""Measure the pinned upstream Vela2 ONNX implementation, without training."""
import argparse
import ast
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
import platform
import statistics
import time
from pathlib import Path

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                  HF_HUB_DISABLE_TELEMETRY="1", TOKENIZERS_PARALLELISM="false", CUDA_VISIBLE_DEVICES="")
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def digest(path):
    sha = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output)
    if output.exists():
        raise FileExistsError("Preserve prior results")
    import psutil
    if psutil.virtual_memory().available < 5 * 1024 ** 3:
        raise RuntimeError("Insufficient free RAM for isolated CPU benchmark")
    descriptions = next(ast.literal_eval(node.value) for node in
        ast.parse((HERE / "candidates.py").read_text(encoding="utf-8")).body
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "DESCRIPTIONS" for target in node.targets))
    cases_path = HERE / "heldout-v2.json"
    cases = json.loads(cases_path.read_text(encoding="utf-8"))["cases"]
    manifest_path = ROOT / "output/final-evolution/vela-onnx-assets.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    snapshot = Path(manifest["path"])
    for asset in manifest["assets"]:
        if digest(snapshot / asset["name"]) != asset["sha256"]:
            raise ValueError("Changed asset: " + asset["name"])
    required = {"vela2_inference.py", "config.json", "calibration.json", "tokenizer.json", "onnx/model.onnx"}
    if not required.issubset(asset["name"] for asset in manifest["assets"]):
        raise ValueError("Incomplete inference manifest")

    process = psutil.Process()
    before = process.memory_info().rss
    start = time.perf_counter()
    spec = importlib.util.spec_from_file_location("pinned_vela2", snapshot / "vela2_inference.py")
    upstream = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(upstream)
    engine = upstream.Vela2.from_pretrained(str(snapshot), backend="onnx",
        providers=["CPUExecutionProvider"], threads=2, batch_size=1)
    initialization_ms = (time.perf_counter() - start) * 1000

    def classify(objective):
        if len(objective) > 16384:
            raise ValueError("Objective exceeds character bound")
        row = {"parts": [{"role": "user", "text": objective}], "questions": [{
            "id": "task_intents", "type": "set", "over": "user",
            "text": "Which labels apply to this user request?", "options": descriptions}]}
        prepared = engine._prep(row)
        assembled = engine._assemble(prepared)
        tokens = len(assembled["ids"])
        if tokens > 1024 or assembled["seg_lens"]["user"] != len(prepared["parts"][0][1]):
            raise ValueError("Complete schema and objective exceed benchmark token bound")
        result = engine.predict_generic([row])[0]
        if result["meta"]["windows"] != 0:
            raise ValueError("Unexpected windowed inference")
        answer = result["answers"][0]
        scores = answer["probabilities"]
        if set(scores) != set(descriptions) or not all(math.isfinite(value) and 0 <= value <= 1 for value in scores.values()):
            raise ValueError("Invalid upstream scores")
        return scores, answer["answer"], answer["threshold"], tokens

    start = time.perf_counter()
    classify("Hello")
    warmup_ms = (time.perf_counter() - start) * 1000
    rows = []
    for index, case in enumerate(cases):
        start = time.perf_counter()
        try:
            scores, predicted, threshold, tokens = classify(case["objective"])
            missing = sorted(set(case["required"]) - set(predicted))
            forbidden = sorted(set(case["forbidden"]) & set(predicted))
            result = {"scores": scores, "predicted": predicted, "threshold": threshold, "tokens": tokens,
                "missing": missing, "forbidden": forbidden, "uncertain": not predicted,
                "satisfied": not missing and not forbidden}
        except Exception as error:
            result = {"error": f"{type(error).__name__}: {error}", "satisfied": False}
        rows.append({"id": case["id"], "language": case["language"],
                     "latencyMs": (time.perf_counter() - start) * 1000, **result})
        if (index + 1) % 16 == 0:
            print(json.dumps({"processed": index + 1, "total": len(cases)}), flush=True)
    successful = [row for row in rows if "error" not in row]
    latencies = sorted(row["latencyMs"] for row in successful)
    metrics = {"satisfied": sum(row["satisfied"] for row in rows), "total": len(rows),
        "errors": len(rows) - len(successful),
        "missingRequired": sum(len(row["missing"]) for row in successful),
        "forbiddenLabels": sum(len(row["forbidden"]) for row in successful),
        "uncertain": sum(row["uncertain"] for row in successful),
        "languages": {lang: {"satisfied": sum(row["satisfied"] for row in rows if row["language"] == lang),
                              "total": sum(row["language"] == lang for row in rows)} for lang in ["en", "he"]}}
    report = {"candidate": "vela-2.0-0.3b", "model": {key: manifest[key] for key in ["model", "revision"]},
        "mode": "consumed-data-development-only", "training": "None; published upstream weights/calibration/implementation",
        "hashes": {"cases": digest(cases_path), "labelSource": digest(HERE / "candidates.py"),
                   "evaluator": digest(__file__), "assetManifest": digest(manifest_path)},
        "runtime": {"os": platform.platform(), "python": platform.python_version(),
            "packages": {name: importlib.metadata.version(name) for name in ["numpy", "tokenizers", "onnxruntime"]},
            "threads": 2, "device": "cpu", "dtype": "float32", "vramBytes": 0,
            "initializationMs": initialization_ms, "warmupMs": warmup_ms,
            "rssBytes": process.memory_info().rss, "rssIncreaseBytes": process.memory_info().rss - before,
            "peakWorkingSetBytes": getattr(process.memory_info(), "peak_wset", None),
            "medianMs": statistics.median(latencies) if latencies else None,
            "p95Ms": latencies[math.ceil(len(latencies) * .95) - 1] if latencies else None},
        "metrics": metrics, "outcomes": rows,
        "limits": "Consumed synthetic partial labels; no unseen/precision/exact-accuracy/downstream-task-success claim. CPU provider configured; VRAM not independently sampled. Inherited Gemma tokenizer terms retained; no redistribution decision."}
    with output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps({"candidate": report["candidate"], "metrics": metrics, "runtime": report["runtime"]}), flush=True)


if __name__ == "__main__":
    main()
