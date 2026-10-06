#!/usr/bin/env bash
# Isolated native-Linux verification. Never copies application data or credentials.
set -euo pipefail
umask 077

source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
verification_root="${RELAY_LINUX_VERIFY_ROOT:-/tmp/relay-linux-verification}"
case "$verification_root" in /tmp/relay-linux-verification*) ;; *) echo 'Verification root must stay within /tmp/relay-linux-verification*' >&2; exit 2;; esac
mkdir -p -- "$verification_root"
verification_root="$(realpath -- "$verification_root")"
case "$verification_root" in /tmp/relay-linux-verification*) ;; *) echo 'Resolved verification root escaped /tmp' >&2; exit 2;; esac

node_version=v24.11.1
case "$(uname -m)" in x86_64) node_arch=x64 ;; aarch64|arm64) node_arch=arm64 ;; *) echo 'Unsupported Node verification architecture' >&2; exit 2;; esac
node_archive="node-${node_version}-linux-${node_arch}.tar.xz"
runtime_dir="$verification_root/node-${node_version}-linux-${node_arch}"
if ! test -x "$runtime_dir/bin/node"; then
  curl --fail --location --proto '=https' --tlsv1.2 --retry 2 "https://nodejs.org/dist/${node_version}/${node_archive}" -o "$verification_root/$node_archive"
  curl --fail --location --proto '=https' --tlsv1.2 --retry 2 "https://nodejs.org/dist/${node_version}/SHASUMS256.txt" -o "$verification_root/SHASUMS256.txt"
  (cd "$verification_root" && grep "  ${node_archive}$" SHASUMS256.txt | sha256sum --check --strict)
  tar -xJf "$verification_root/$node_archive" -C "$verification_root"
fi
export PATH="$runtime_dir/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export npm_config_cache="$verification_root/npm-cache"

run_dir="$(mktemp -d "$verification_root/run-XXXXXXXX")"
mkdir -- "$run_dir/source"
git -c "safe.directory=$source_dir" -C "$source_dir" ls-files --cached --others --exclude-standard -z > "$run_dir/source-files.nul"
# Git's index/ignore rules exclude .data, credentials, outputs and node_modules.
# Reject accidental inclusion explicitly as an additional boundary.
while IFS= read -r -d '' file; do
  case "$file" in .data/*|node_modules/*|output/*|release/*|.env|.env.*|.git/*)
    if test "$file" != '.env.example'; then echo 'Refusing private/generated source snapshot member' >&2; exit 2; fi;;
  esac
done < "$run_dir/source-files.nul"
tar -C "$source_dir" --null -T "$run_dir/source-files.nul" -cf "$run_dir/source.tar"
tar -C "$run_dir/source" -xf "$run_dir/source.tar"
sha256sum "$run_dir/source.tar" > "$run_dir/source.sha256"
printf '%s\n' "$run_dir" > "$verification_root/latest-run"
printf 'Verification directory: %s\n' "$run_dir"
cd "$run_dir/source"
node --version
npm --version
uname -a
printf 'Installing locked native Linux dependencies...\n'
npm ci --no-fund --audit=false > "$run_dir/install.log" 2>&1
printf 'Running strict types and deterministic tests...\n'
npm run check > "$run_dir/check.log" 2>&1
tail -n 12 "$run_dir/check.log"
printf 'Building browser and compiled host...\n'
npm run build > "$run_dir/build.log" 2>&1
tail -n 12 "$run_dir/build.log"
node scripts/linux-verify.mjs "$run_dir"
mkdir -p -- "$source_dir/output"
cp -- "$run_dir/host-smoke.json" "$source_dir/output/linux-validation.json"
printf 'Linux verification passed. Evidence: %s\n' "$run_dir"
