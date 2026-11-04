@echo off
chcp 65001 >nul
rem Windows 开工脚本：只在当前命令行窗口里临时加 PATH，不改系统设置。
rem   tools\env\win.cmd                 当前 cmd 窗口生效，之后直接敲 pnpm / git
rem   tools\env\win.cmd pnpm dev:web    设置后直接运行一条命令（PowerShell 里也能这样用）
rem 工具目录默认 C:\Data\Project\环境，放在别处时先 set PD_ENV_DIR=其他目录

if not defined PD_ENV_DIR set "PD_ENV_DIR=C:\Data\Project\环境"

if not exist "%PD_ENV_DIR%\node\node.exe" (
  echo 找不到 "%PD_ENV_DIR%\node\node.exe"，请先 set PD_ENV_DIR=工具目录
  exit /b 1
)

set "PATH=%PD_ENV_DIR%\node;%PD_ENV_DIR%\git\cmd;%PATH%"

rem 沿用 node_modules 安装时用的 pnpm store，避免换 store 后整个重装
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
