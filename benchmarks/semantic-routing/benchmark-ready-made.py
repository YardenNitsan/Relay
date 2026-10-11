"""Measure externally pretrained GLiClass, without training or hidden truncation.

Consumed v2 cases are development evidence, never a new held-out result.
This adapter only runs the vendor pipeline; it cannot select/load an LLM.
"""
import argparse
import ast
import hashlib
import importlib.metadata
import json
import math
import os
import platform
import statistics
import time
from pathlib import Path

for key, value in {
    "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
    "HF_HUB_DISABLE_TELEMETRY": "1", "TOKENIZERS_PARALLELISM": "false",
    "CUDA_VISIBLE_DEVICES": "",
}.items():
    os.environ[key] = value

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", choices=["mini", "edge"], required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output_path = Path(args.output)
    if output_path.exists():
        raise FileExistsError("Preserve prior outcomes; choose a new result path")
    import psutil
    if psutil.virtual_memory().available < 4 * 1024 ** 3:
        raise RuntimeError("Insufficient free RAM for isolated CPU measurement")

    # Read the already-frozen literal without importing old candidates/dependencies.
    descriptions = next(ast.literal_eval(node.value) for node in
        ast.parse((HERE / "candidates.py").read_text(encoding="utf-8")).body
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "DESCRIPTIONS" for target in node.targets))
    label_strings = list(descriptions.values())
    reverse = {description: key for key, description in descriptions.items()}
    cases_path = HERE / "heldout-v2.json"
    cases = json.loads(cases_path.read_text(encoding="utf-8"))["cases"]
    manifest_path = ROOT / f"output/final-evolution/gliclass-{args.candidate}-assets.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    model_path = Path(manifest["path"])
    for asset in manifest["assets"]:
        if digest(model_path / asset["name"]) != asset["sha256"]:
            raise ValueError("Model asset changed: " + asset["name"])

    process = psutil.Process()
    before_rss = process.memory_info().rss
    started = time.perf_counter()
    import torch
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    from gliclass import GLiClassModel, ZeroShotClassificationPipeline
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True, trust_remote_code=False)
    model = GLiClassModel.from_pretrained(model_path, local_files_only=True,
        trust_remote_code=False, use_safetensors=True, dtype=torch.float32)
    pipeline = ZeroShotClassificationPipeline(model, tokenizer, classification_type="multi-label",
        device=torch.device("cpu"), max_length=512, progress_bar=False)
    initialization_ms = (time.perf_counter() - started) * 1000

    def classify(objective):
        if len(objective) > 16384:
            raise ValueError("Objective exceeds character bound")
        assembled = pipeline.pipe.prepare_input(objective, label_strings)
        tokens = len(tokenizer(assembled, truncation=False)["input_ids"])
        if tokens > 512:
            raise ValueError(f"Complete objective and labels exceed 512 tokens: {tokens}")
        with torch.inference_mode():
            raw = pipeline(objective, label_strings, threshold=0.5, batch_size=1,
                           return_hierarchical=True)[0]
        scores = {reverse[label]: float(score) for label, score in raw.items()}
        if set(scores) != set(descriptions) or not all(math.isfinite(score) and 0 <= score <= 1 for score in scores.values()):
            raise ValueError("Vendor returned incomplete or invalid scores")
        return scores, tokens

    warm_started = time.perf_counter()
    classify("Hello")
    warmup_ms = (time.perf_counter() - warm_started) * 1000
    rows = []
    for index, case in enumerate(cases):
        started = time.perf_counter()
        try:
            scores, tokens = classify(case["objective"])
            predicted = [key for key in descriptions if scores[key] >= 0.5]
            missing = sorted(set(case["required"]) - set(predicted))
            forbidden = sorted(set(case["forbidden"]) & set(predicted))
            row = {"scores": scores, "tokens": tokens, "predicted": predicted,
                   "missing": missing, "forbidden": forbidden, "uncertain": not predicted,
                   "satisfied": not missing and not forbidden}
        except Exception as error:
            row = {"error": f"{type(error).__name__}: {error}", "satisfied": False}
        rows.append({"id": case["id"], "language": case["language"],
                     "latencyMs": (time.perf_counter() - started) * 1000, **row})
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
    report = {"candidate": f"gliclass-multilang-{args.candidate}",
        "model": {key: manifest[key] for key in ["model", "revision"]},
        "mode": "consumed-data-development-only", "threshold": 0.5,
        "training": "None; unchanged vendor weights; no examples or custom classifier",
        "hashes": {"cases": digest(cases_path), "labelSource": digest(HERE / "candidates.py"),
                   "evaluator": digest(__file__), "assetManifest": digest(manifest_path)},
        "runtime": {"os": platform.platform(), "python": platform.python_version(),
            "packages": {name: importlib.metadata.version(name) for name in ["gliclass", "transformers", "torch"]},
            "threads": 2, "device": "cpu", "dtype": "float32", "vramBytes": 0,
            "initializationMs": initialization_ms, "warmupMs": warmup_ms,
            "rssBytes": process.memory_info().rss, "rssIncreaseBytes": process.memory_info().rss - before_rss,
            "peakWorkingSetBytes": getattr(process.memory_info(), "peak_wset", None),
            "medianMs": statistics.median(latencies) if latencies else None,
            "p95Ms": latencies[math.ceil(len(latencies) * .95) - 1] if latencies else None},
        "metrics": metrics, "outcomes": rows,
        "limits": "Consumed synthetic tasks with partial constraints; not precision/exact accuracy, unseen evidence, downstream model selection or end-to-end task success. CPU configuration implies no GPU use; VRAM not separately sampled."}
    with output_path.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps({"candidate": report["candidate"], "metrics": metrics, "runtime": report["runtime"]}), flush=True)


if __name__ == "__main__":
    main()
