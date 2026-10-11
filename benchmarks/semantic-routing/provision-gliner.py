"""Stage the unchanged, pinned Fastino multilingual classifier; never load it."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODEL = "fastino/GLiNER2.5-multi-Decide"
REVISION = "e173bca1f0c4217d7a55b3b0c705d5ece8a0218d"
LIBRARY_VERSION = "2.1.0"
ASSETS = {
    "config.json": (4106, "aa29cd584316b61b0bfed94d03ee1cfdaf28b46a37686293742929c49b8bd2f7"),
    "encoder_config/config.json": (858, "d0ebbcb8b458e285a39e12cc315cbaf3d1c6f631e7281e6b22dd5b4071183f83"),
    "model.safetensors": (1149461028, "9efe0f88c99f2aa794452e9559dc60e98d60d9fa2bf1b60cf2710411b6da5b4e"),
    "tokenizer.json": (16035853, "c62446df87ae18ec98b133f8f84fc449a07cc89bbf8ef192a4cb5f9c53777a7a"),
    "tokenizer_config.json": (646, "fd4a31dc2f1f17e31638c5f0e783b81cdb2fbe6bddd116a8d9e5d50d78148cf1"),
    "README.md": (17030, "55531b81804b6c8160d41de57ff9559ca20b2f3779ab6e36e471dcd51127d92b"),
}
DIRECTORY = ROOT / "output/semantic-models/GLiNER2.5-multi-Decide"
MANIFEST = ROOT / "output/final-evolution/gliner-assets.json"


def digest(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def verified_assets(directory):
    assets = []
    for name, (size, sha256) in ASSETS.items():
        path = directory / name
        if not path.resolve().is_relative_to(directory.resolve()):
            raise ValueError("Asset escapes staged directory: " + name)
        if not path.is_file() or path.stat().st_size != size or digest(path) != sha256:
            raise ValueError("Missing or changed pinned asset: " + name)
        assets.append({"name": name, "bytes": size, "sha256": sha256})
    return assets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true", help="No network access; verify staged assets")
    args = parser.parse_args()
    if not DIRECTORY.resolve().is_relative_to((ROOT / "output").resolve()):
        raise ValueError("Staged directory escapes output")
    if not args.verify_only:
        from huggingface_hub import snapshot_download
        snapshot_download(
            MODEL, revision=REVISION, local_dir=DIRECTORY,
            allow_patterns=list(ASSETS), max_workers=2,
        )
    assets = verified_assets(DIRECTORY)
    if "license: apache-2.0" not in (DIRECTORY / "README.md").read_text(encoding="utf-8"):
        raise ValueError("Pinned model card does not declare expected license")
    manifest = {
        "schemaVersion": 1, "candidate": "gliner2.5-multi-decide",
        "model": MODEL, "revision": REVISION, "path": str(DIRECTORY.resolve()),
        "purpose": "Existing pretrained inference only; no Relay training or custom classifier",
        "library": {"name": "gliner2", "version": LIBRARY_VERSION,
                    "wheelSha256": "0c242c5de53f37020df835788fc4eb820e1673b5212c202cd90e9234a7e786bc"},
        "licenses": {
            "model": "Apache-2.0", "library": "Apache-2.0", "encoder": "MIT",
            "modelSource": f"https://huggingface.co/{MODEL}/blob/{REVISION}/README.md",
            "librarySource": "https://github.com/fastino-ai/GLiNER2/blob/b86d35c02f2c1a4d9840ea50197bd1b6d13b031e/LICENSE",
            "encoderSource": "https://huggingface.co/microsoft/mdeberta-v3-base",
        },
        "assets": assets,
    }
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    if MANIFEST.exists():
        if json.loads(MANIFEST.read_text(encoding="utf-8")) != manifest:
            raise FileExistsError("Preserve existing different asset manifest: " + str(MANIFEST))
    else:
        with MANIFEST.open("x", encoding="utf-8") as stream:
            json.dump(manifest, stream, indent=2)
            stream.write("\n")
    print(json.dumps({"model": MODEL, "revision": REVISION, "files": len(assets),
                      "bytes": sum(asset["bytes"] for asset in assets),
                      "manifest": str(MANIFEST), "verifiedOnly": args.verify_only}), flush=True)


if __name__ == "__main__":
    main()
