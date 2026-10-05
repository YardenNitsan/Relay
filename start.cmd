@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS before starting Relay.
  exit /b 1
)
if not exist "node_modules\fastify\package.json" (
  echo Run npm ci --omit=dev in this directory before the first start.
  exit /b 1
)
node launch.mjs
exit /b %errorlevel%
