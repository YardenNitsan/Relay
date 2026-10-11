"""Provision published Vela assets; never import model code or run inference.

The default downloads only small review files. --include-weights additionally
downloads the original FP32 ONNX graph and tokenizer for a later coordinated run.
"""
import argparse
import hashlib
import json
from pathlib import Path

from huggingface_hub import snapshot_download


ROOT = Path(__file__).resolve().parents[2]
MODEL = "vllm-sr/Vela-2.0-0.3B"
REVISION = "d6f03aa9baca4f9017fa8f8e9c2764d3bed3f409"
SMALL_PATTERNS = [
    "*.py", "*.md", "config.json", "calibration.json",
    "special_tokens_map.json", "tokenizer_config.json", "pii_calibration_fit.json",
    "LICENSE", "LICENSES/*", "NOTICE", "NOTICE_SOURCES.json",
]
LARGE_FILES = {
    "onnx/model.onnx": "5096731c509b3462ade7d4e304a457de4722d12c2d833ca4d4ea52f6c11ec66a",
    "tokenizer.json": "e4b670c5ab72158f35de150792133e8c92adb4ba677d26b99d22c77f34c63faf",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--include-weights", action="store_true",
                        help="Explicitly download the ~1.24 GB ONNX graph and tokenizer")
    args = parser.parse_args()
    directory = ROOT / "output/semantic-models/vela-2.0-0.3b"
    patterns = SMALL_PATTERNS + (list(LARGE_FILES) if args.include_weights else [])
    snapshot_download(MODEL, revision=REVISION, local_dir=directory,
                      allow_patterns=patterns)
    assets = []
    for path in sorted(directory.rglob("*")):
        relative = path.relative_to(directory)
        if not path.is_file() or ".cache" in relative.parts:
            continue
        # A small-only review does not read pre-existing large assets.
        if not args.include_weights and relative.as_posix() in LARGE_FILES:
            continue
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        sha = digest.hexdigest()
        expected = LARGE_FILES.get(relative.as_posix())
        if expected is not None and sha != expected:
            raise ValueError(f"Published asset hash mismatch: {relative}")
        assets.append({"name": relative.as_posix(), "bytes": path.stat().st_size,
                       "sha256": sha})
    if args.include_weights and not set(LARGE_FILES).issubset(a["name"] for a in assets):
        raise ValueError("Required ONNX inference assets are missing")
    manifest = {
        "model": MODEL, "revision": REVISION, "path": str(directory),
        "purpose": "Published pretrained inference only; no Relay training",
        "scope": "onnx-inference-assets" if args.include_weights else "small-review-files",
        "license": "Apache-2.0 contributions; inherited MIT and Gemma tokenizer terms",
        "assets": assets,
    }
    scope = "onnx" if args.include_weights else "review"
    output = ROOT / f"output/final-evolution/vela-{scope}-assets.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"model": MODEL, "revision": REVISION, "scope": manifest["scope"],
                      "files": len(assets), "bytes": sum(a["bytes"] for a in assets)}))


if __name__ == "__main__":
    main()
