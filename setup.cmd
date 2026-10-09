@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 goto localnode
node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)" >nul 2>nul
if errorlevel 1 goto localnode
node.exe scripts\setup.mjs %*
exit /b %errorlevel%

:localnode
set "RELAY_BOOTSTRAP_ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "RELAY_BOOTSTRAP_ARCH=arm64"
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "RELAY_BOOTSTRAP_ARCH=arm64"
set "RELAY_LOCAL_NODE=%CD%\.tools\node-v24.21.0-win-%RELAY_BOOTSTRAP_ARCH%\node.exe"
if exist "%RELAY_LOCAL_NODE%" goto launchlocal
set "RELAY_SETUP_DIAGNOSTIC="
set "RELAY_SETUP_HELP="
for %%A in (%*) do (
  if /i "%%~A"=="--help" set "RELAY_SETUP_HELP=1"
  if /i "%%~A"=="--check" set "RELAY_SETUP_DIAGNOSTIC=1"
  if /i "%%~A"=="--stop" set "RELAY_SETUP_DIAGNOSTIC=1"
)
if defined RELAY_SETUP_HELP goto help
if defined RELAY_SETUP_DIAGNOSTIC goto missing
echo Downloading official Node 24.21.0 into this project's .tools directory...
rem Fixed inline PowerShell commands do not change execution policy or require administrator access.
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $toolsRoot=Join-Path (Get-Location) '.tools'; New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null; $name='node-v24.21.0-win-'+$env:RELAY_BOOTSTRAP_ARCH; $file=$name+'.zip'; $archive=Join-Path $toolsRoot $file; $base='https://nodejs.org/dist/v24.21.0/'; Invoke-WebRequest -UseBasicParsing -Uri ($base+$file) -OutFile $archive -TimeoutSec 120; $manifest=(Invoke-WebRequest -UseBasicParsing -Uri ($base+'SHASUMS256.txt') -TimeoutSec 30).Content; $match=[regex]::Match($manifest,'(?m)^([a-f0-9]{64})  '+[regex]::Escape($file)+'\r?$'); if (-not $match.Success) { throw 'Runtime is absent from the official checksum manifest' }; $actual=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant(); if ($actual -cne $match.Groups[1].Value) { throw 'Official Node checksum mismatch' }; Expand-Archive -LiteralPath $archive -DestinationPath $toolsRoot -Force; if (-not (Test-Path -LiteralPath (Join-Path (Join-Path $toolsRoot $name) 'LICENSE'))) { throw 'Official Node license is missing' }"
if errorlevel 1 exit /b 1
:launchlocal
"%RELAY_LOCAL_NODE%" scripts\setup.mjs %*
exit /b %errorlevel%
:missing
echo Node 24 or newer is not installed. Run setup.cmd without --check or --stop to bootstrap it locally.
exit /b 1
:help
echo Usage: setup.cmd [--no-browser ^| --check ^| --stop ^| --help]
echo Prepares Relay and opens its browser. Missing Node is downloaded locally after SHA-256 verification.
echo --check diagnoses only. --stop gracefully stops a host started by setup. See docs/setup.md.
exit /b 0
