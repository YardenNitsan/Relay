"""Measure the shipped GLiNER2 Classifier on consumed heldout-v2 only.

No training, custom head/decoder, prompt examples, or fresh-evaluation access.
"""
import argparse
import ast
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
import os
import platform
import statistics
import threading
import time
from pathlib import Path

for key, value in {
    "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
    "HF_HUB_DISABLE_TELEMETRY": "1", "TOKENIZERS_PARALLELISM": "false",
    "CUDA_VISIBLE_DEVICES": "", "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2",
}.items():
    os.environ[key] = value

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def literal(path, name):
    assignments = [node for node in ast.parse(Path(path).read_text(encoding="utf-8")).body
                   if isinstance(node, ast.Assign) and any(
                       isinstance(target, ast.Name) and target.id == name for target in node.targets)]
    if len(assignments) != 1:
        raise ValueError("Expected one frozen literal: " + name)
    return ast.literal_eval(assignments[0].value)


def validate_scores(raw_scores, raw_selected, reverse):
    if set(raw_scores) != set(reverse):
        raise ValueError("Vendor returned incomplete or unexpected score labels")
    scores = {reverse[label]: float(score) for label, score in raw_scores.items()}
    if not all(math.isfinite(score) and 0 <= score <= 1 for score in scores.values()):
        raise ValueError("Vendor returned invalid probabilities")
    if not isinstance(raw_selected, (list, tuple)) or any(label not in reverse for label in raw_selected):
        raise ValueError("Vendor returned invalid selected labels")
    if len(set(raw_selected)) != len(raw_selected):
        raise ValueError("Vendor returned duplicate labels")
    return scores, [reverse[label] for label in raw_selected]


def summary(rows):
    successful = [row for row in rows if "error" not in row]
    return {
        "satisfied": sum(row["satisfied"] for row in rows), "total": len(rows),
        "errors": len(rows) - len(successful),
        "missingRequired": sum(len(row["missing"]) for row in successful),
        "forbiddenLabels": sum(len(row["forbidden"]) for row in successful),
        "uncertain": sum(row["uncertain"] for row in successful),
    }


def measure():
    import psutil
    if psutil.virtual_memory().available < 4 * 1024 ** 3:
        raise RuntimeError("Insufficient free RAM for isolated CPU measurement")
    provision = HERE / "provision-gliner.py"
    model_id = literal(provision, "MODEL")
    revision = literal(provision, "REVISION")
    library_version = literal(provision, "LIBRARY_VERSION")
    expected_assets = literal(provision, "ASSETS")
    if importlib.metadata.version("gliner2") != library_version:
        raise RuntimeError("This benchmark requires pinned gliner2==" + library_version)
    descriptions = literal(HERE / "candidates.py", "DESCRIPTIONS")
    if (not isinstance(descriptions, dict) or len(descriptions) != 16 or
            any(not isinstance(key, str) or not isinstance(value, str) or not value
                for key, value in descriptions.items())):
        raise ValueError("Expected sixteen frozen label descriptions")
    label_strings = list(descriptions.values())
    reverse = {description: key for key, description in descriptions.items()}
    if len(reverse) != 16:
        raise ValueError("Label descriptions must be unique")
    cases_path = HERE / "heldout-v2.json"
    cases = json.loads(cases_path.read_text(encoding="utf-8"))["cases"]
    if not cases or len({case["id"] for case in cases}) != len(cases):
        raise ValueError("Missing or duplicate consumed case IDs")
    for case in cases:
        if (case["language"] not in {"en", "he"} or not isinstance(case["objective"], str) or
                not set(case["required"]) <= descriptions.keys() or
                not set(case["forbidden"]) <= descriptions.keys() or
                set(case["required"]) & set(case["forbidden"])):
            raise ValueError("Invalid consumed case: " + case["id"])

    manifest_path = ROOT / "output/final-evolution/gliner-assets.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["model"] != model_id or manifest["revision"] != revision:
        raise ValueError("Unexpected model identity in asset manifest")
    model_path = Path(manifest["path"])
    expected_path = ROOT / "output/semantic-models/GLiNER2.5-multi-Decide"
    if not model_path.is_dir() or model_path.resolve() != expected_path.resolve():
        raise ValueError("Expected complete staged local model directory")
    if len(manifest["assets"]) != len(expected_assets):
        raise ValueError("Unexpected asset manifest length")
    if {item["name"] for item in manifest["assets"]} != set(expected_assets):
        raise ValueError("Unexpected asset manifest filenames")
    for asset in manifest["assets"]:
        name = asset["name"]
        size, sha256 = expected_assets[name]
        path = model_path / name
        if (not path.resolve().is_relative_to(model_path.resolve()) or
                (asset["bytes"], asset["sha256"]) != (size, sha256) or
                not path.is_file() or path.stat().st_size != size or digest(path) != sha256):
            raise ValueError("Missing or changed pinned model asset: " + name)

    process = psutil.Process()
    before_rss = process.memory_info().rss
    peak_rss = [before_rss]
    stop_sampling = threading.Event()

    def sample_memory():
        while not stop_sampling.wait(0.01):
            peak_rss[0] = max(peak_rss[0], process.memory_info().rss)

    sampler = threading.Thread(target=sample_memory, daemon=True)
    sampler.start()
    try:
        initialization_started = time.perf_counter()
        import torch
        torch.set_num_threads(2)
        torch.set_num_interop_threads(1)
        from gliner2.classification import Classifier, ClassificationSchema, ClassificationConfig
        # A local directory and offline environment are both needed: 2.1.0 does
        # not forward every Hub option through AutoExtractor/tokenizer loading.
        router = Classifier.from_pretrained(
            str(model_path), device="cpu", dtype=torch.float32, map_location="cpu",
            attention_backend="standard", quantize=False, compile=False,
            local_files_only=True,
        ).eval()
        if any(parameter.device.type != "cpu" or parameter.dtype != torch.float32
               for parameter in router.model.parameters()):
            raise ValueError("Model is not entirely CPU float32")
        schema = ClassificationSchema().multi("task", label_strings, min_labels=0, threshold=0.5)
        compiled = router.compile_schema(schema)
        config = ClassificationConfig(
            decoder="independent", batch_size=1, max_len=None,
            candidate_threshold=0.5, include_confidence=True,
        )
        initialization_ms = (time.perf_counter() - initialization_started) * 1000

        def classify(objective):
            if len(objective) > 16384:
                raise ValueError("Objective exceeds 16384-character bound")
            # max_len is a word bound, not a subword-token bound. Preflight the
            # exact shipped processor including the full schema; never truncate.
            record = router.model.processor.transform_record(objective, compiled.build(), max_len=None)
            tokens = len(record.input_ids)
            if tokens > 512:
                raise ValueError(f"Complete objective and schema exceed 512 tokens: {tokens}")
            with torch.inference_mode():
                result = router.classify(objective, compiled, config=config)
            if not result.feasible or result.decoder != "independent" or set(result.tasks) != {"task"}:
                raise ValueError("Unexpected vendor classification result")
            scores, predicted = validate_scores(dict(result.probabilities("task")), result.value("task"), reverse)
            # Predictions are the released library's decisions, not reimplemented
            # threshold logic. Preserve raw output, including genuine empty sets.
            effective_hash = hashlib.sha256(record.text.encode("utf-8")).hexdigest()
            input_ids_hash = hashlib.sha256(json.dumps(record.input_ids, separators=(",", ":")).encode()).hexdigest()
            return scores, predicted, tokens, result.to_dict(), effective_hash, input_ids_hash

        warm_started = time.perf_counter()
        classify("Hello")
        warmup_ms = (time.perf_counter() - warm_started) * 1000
        rows = []
        for index, case in enumerate(cases):
            started = time.perf_counter()
            try:
                scores, predicted, tokens, raw, effective_hash, input_ids_hash = classify(case["objective"])
                missing = sorted(set(case["required"]) - set(predicted))
                forbidden = sorted(set(case["forbidden"]) & set(predicted))
                row = {
                    "scores": scores, "tokens": tokens, "predicted": predicted,
                    "missing": missing, "forbidden": forbidden, "uncertain": not predicted,
                    "satisfied": not missing and not forbidden, "vendorResult": raw,
                    "effectiveTextSha256": effective_hash, "encodedInputSha256": input_ids_hash,
                }
            except Exception as error:
                row = {"error": f"{type(error).__name__}: {error}", "satisfied": False}
            rows.append({"id": case["id"], "language": case["language"],
                         "latencyMs": (time.perf_counter() - started) * 1000, **row})
            peak_rss[0] = max(peak_rss[0], process.memory_info().rss)
            if (index + 1) % 16 == 0:
                print(json.dumps({"processed": index + 1, "total": len(cases)}), flush=True)
        latencies = sorted(row["latencyMs"] for row in rows if "error" not in row)
        metrics = summary(rows)
        metrics["languages"] = {language: summary([row for row in rows if row["language"] == language])
                                for language in ["en", "he"]}
        memory = process.memory_info()
        return {
            "status": "completed", "candidate": "gliner2.5-multi-decide",
            "model": {"model": model_id, "revision": revision},
            "mode": "consumed-data-development-only", "threshold": 0.5, "minLabels": 0,
            "training": "None; unchanged vendor weights, Classifier, schema and independent decoder; no custom classifier",
            "labelSchema": {"task": "task", "labels": label_strings, "idMapping": reverse},
            "hashes": {"cases": digest(cases_path), "labelSource": digest(HERE / "candidates.py"),
                       "evaluator": digest(__file__), "provisioner": digest(provision),
                       "assetManifest": digest(manifest_path)},
            "runtime": {
                "os": platform.platform(), "python": platform.python_version(),
                "packages": {name: importlib.metadata.version(name) for name in
                             ["gliner2", "transformers", "torch", "tokenizers", "huggingface-hub", "safetensors"]},
                "threads": 2, "interopThreads": 1, "device": "cpu", "dtype": "float32",
                "vramBytes": 0, "initializationMs": initialization_ms, "warmupMs": warmup_ms,
                "rssBytes": memory.rss, "rssIncreaseBytes": memory.rss - before_rss,
                "sampledPeakRssBytes": max(peak_rss[0], memory.rss), "rssSampleIntervalMs": 10,
                "peakWorkingSetBytes": getattr(memory, "peak_wset", None),
                "medianMs": statistics.median(latencies) if latencies else None,
                "p95Ms": latencies[math.ceil(len(latencies) * .95) - 1] if latencies else None,
            },
            "metrics": metrics, "outcomes": rows,
            "preprocessing": {"maxCharacters": 16384, "maxFullEncodedTokens": 512,
                              "truncation": "none; over-bound rows are errors", "normalization": "shipped GLiNER2 processor",
                              "includesSchemaTokens": True},
            "limits": "Consumed synthetic v2 tasks with partial constraints; not precision/exact accuracy, unseen evidence, Hebrew certification, downstream selection or end-to-end success. CPU parameters verified; VRAM not independently sampled. RSS peak polling can miss brief transients. Latency includes input-bound verification and output validation.",
        }
    finally:
        stop_sampling.set()
        sampler.join(timeout=2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output_path = Path(args.output).resolve()
    if not output_path.is_relative_to((ROOT / "output").resolve()):
        raise ValueError("Benchmark result must be under ignored output/")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    start = time.perf_counter()
    started_at = datetime.now(timezone.utc).isoformat()
    # Reserve before loading: failures and concurrent invocations cannot overwrite
    # old measurements. Fatal setup/load failures remain reviewable as their own run.
    with output_path.open("x", encoding="utf-8") as stream:
        try:
            report = measure()
        except Exception as error:
            json.dump({"status": "failed", "candidate": "gliner2.5-multi-decide",
                       "mode": "consumed-data-development-only", "startedAt": started_at,
                       "error": f"{type(error).__name__}: {error}",
                       "elapsedMs": (time.perf_counter() - start) * 1000}, stream, indent=2)
            stream.write("\n")
            raise
        report["startedAt"] = started_at
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        report["runtime"]["totalRunMs"] = (time.perf_counter() - start) * 1000
        json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
    print(json.dumps({"candidate": report["candidate"], "metrics": report["metrics"],
                      "runtime": report["runtime"]}), flush=True)


if __name__ == "__main__":
    main()
