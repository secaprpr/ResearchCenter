@echo off
setlocal
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_START_URL="
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is missing. Run npm ci first.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  call npm run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0." "--user-data-dir=%~dp0.local-profile"
