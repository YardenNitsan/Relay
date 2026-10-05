# Optional per-user login task; run only after reviewing the installation path.
param([Parameter(Mandatory=$true)][string]$InstallDirectory)
$ErrorActionPreference = 'Stop'
$relayInstall = (Resolve-Path -LiteralPath $InstallDirectory).Path
$relayEntry = Join-Path $relayInstall 'dist-server/main.js'
if (-not (Test-Path -LiteralPath $relayEntry)) { throw 'Built Relay installation not found.' }
$relayNode = (Get-Command node -ErrorAction Stop).Source
$relayLauncher = Join-Path $relayInstall 'launch.mjs'
if (-not (Test-Path -LiteralPath $relayLauncher)) { throw 'Package launcher not found.' }
$relayAction = New-ScheduledTaskAction -Execute $relayNode -Argument ('"' + $relayLauncher + '"') -WorkingDirectory $relayInstall
$relayTrigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$relaySettings = New-ScheduledTaskSettingsSet -Hidden -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'Relay Local Host' -Action $relayAction -Trigger $relayTrigger -Settings $relaySettings -Description 'Relay local AI host (current user, no elevation)'
