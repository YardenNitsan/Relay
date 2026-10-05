param([switch]$InstallDependencies)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 LTS before starting Relay.' }
$relayNodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($relayNodeMajor -lt 24) { throw 'Relay requires Node.js 24 or newer.' }
if ($InstallDependencies) { npm.cmd ci --omit=dev; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } }
if (-not (Test-Path -LiteralPath 'dist-server/main.js')) { throw 'Run npm ci and npm run build in a source checkout first.' }
$env:RELAY_PACKAGED = '1'
node launch.mjs
