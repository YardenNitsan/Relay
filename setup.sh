#!/bin/sh
set -eu
setup_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
cd "$setup_root"
if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' >/dev/null 2>&1; then
  exec node scripts/setup.mjs "$@"
fi
case "$(uname -s)" in Linux) setup_os=linux ;; Darwin) setup_os=darwin ;; *) echo 'Setup supports Linux and macOS. Use setup.cmd on Windows.' >&2; exit 1 ;; esac
case "$(uname -m)" in x86_64|amd64) setup_arch=x64 ;; arm64|aarch64) setup_arch=arm64 ;; *) echo 'Official Node bootstrap supports x64 and ARM64.' >&2; exit 1 ;; esac
setup_name="node-v24.21.0-$setup_os-$setup_arch"
setup_node="$setup_root/.tools/$setup_name/bin/node"
if test ! -x "$setup_node"; then
  for setup_arg in "$@"; do
    case "$setup_arg" in
      --help) echo 'Usage: sh setup.sh [--no-browser | --check | --stop | --help]'; echo 'See docs/setup.md. Missing Node is downloaded locally after SHA-256 verification.'; exit 0 ;;
      --check|--stop) echo 'Node 24+ is unavailable. Run setup without --check or --stop to bootstrap it locally.' >&2; exit 1 ;;
    esac
  done
  command -v curl >/dev/null 2>&1 || { echo 'curl is required for the official Node bootstrap; install it with your OS package manager.' >&2; exit 1; }
  command -v tar >/dev/null 2>&1 || { echo 'tar is required for the official Node bootstrap.' >&2; exit 1; }
  mkdir -p .tools
  setup_archive="$setup_root/.tools/$setup_name.tar.gz"
  setup_manifest="$setup_root/.tools/node-v24.21.0-SHASUMS256.txt"
  echo "Downloading official Node 24.21.0 into $setup_root/.tools..."
  curl --fail --location --proto '=https' --tlsv1.2 --max-time 120 "https://nodejs.org/dist/v24.21.0/$setup_name.tar.gz" -o "$setup_archive"
  curl --fail --location --proto '=https' --tlsv1.2 --max-time 30 'https://nodejs.org/dist/v24.21.0/SHASUMS256.txt' -o "$setup_manifest"
  setup_expected=$(awk -v name="$setup_name.tar.gz" '$2==name {print $1}' "$setup_manifest")
  if command -v sha256sum >/dev/null 2>&1; then setup_actual=$(sha256sum "$setup_archive" | awk '{print $1}');
  elif command -v shasum >/dev/null 2>&1; then setup_actual=$(shasum -a 256 "$setup_archive" | awk '{print $1}');
  else echo 'sha256sum or shasum is required. No runtime was extracted.' >&2; exit 1; fi
  test -n "$setup_expected" && test "$setup_expected" = "$setup_actual" || { echo 'Official Node checksum mismatch; no runtime was extracted.' >&2; exit 1; }
  tar -xzf "$setup_archive" -C "$setup_root/.tools"
  test -f "$setup_root/.tools/$setup_name/LICENSE" || { echo 'Official Node license is missing.' >&2; exit 1; }
fi
exec "$setup_node" scripts/setup.mjs "$@"
