@echo off
chcp 65001 >nul
rem Windows dev setup: prepend tools to PATH for this window only, no system changes.
rem   tools\env\win.cmd                 apply to the current cmd window, then use pnpm / git
rem   tools\env\win.cmd pnpm dev:web    apply and run one command (also works from PowerShell)
rem Tools dir defaults to the shared env folder below; override with set PD_ENV_DIR=...
rem Keep comments ASCII: after chcp 65001, cmd misparses lines with multi-byte text.

if not defined PD_ENV_DIR set "PD_ENV_DIR=C:\Data\Project\环境"

if not exist "%PD_ENV_DIR%\node\node.exe" (
  echo Not found: "%PD_ENV_DIR%\node\node.exe". Run: set PD_ENV_DIR=your tools dir
  exit /b 1
)

set "PATH=%PD_ENV_DIR%\node;%PD_ENV_DIR%\git\cmd;%PATH%"

rem Reuse the pnpm store node_modules was installed with, so a store change does not force a full reinstall
if exist "%~dp0..\..\node_modules\.modules.yaml" (
  for /f "tokens=1,*" %%a in ('findstr /b "storeDir:" "%~dp0..\..\node_modules\.modules.yaml"') do (
    for %%I in ("%%b") do set "npm_config_store_dir=%%~dpI"
  )
)

if "%~1"=="" (
  node -v
  call pnpm -v
  git --version
  exit /b 0
)
call %*
