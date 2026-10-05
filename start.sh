#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
command -v node >/dev/null 2>&1 || { echo 'Install Node.js 24 LTS first.' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)' || { echo 'Relay requires Node.js 24 or newer.' >&2; exit 1; }
if [ "${1:-}" = '--install-dependencies' ]; then npm ci --omit=dev; fi
test -f dist-server/main.js || { echo 'Run npm ci and npm run build in a source checkout first.' >&2; exit 1; }
export RELAY_PACKAGED=1
exec node launch.mjs
