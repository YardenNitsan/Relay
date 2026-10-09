# Optional PowerShell convenience wrapper. setup.cmd also works when the existing
# PowerShell policy does not allow unsigned script files. No policy is changed.
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'setup.cmd') @args
exit $LASTEXITCODE
