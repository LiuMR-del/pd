@echo off
chcp 65001 >nul
rem Local MySQL for apps/server on Windows, instead of docker compose (same port, users, databases).
rem   tools\env\mysql.cmd start    first run: initialize data dir + run mysql-init.sql; then start in background
rem   tools\env\mysql.cmd stop
rem   tools\env\mysql.cmd status
rem MySQL 8.4 unzipped to %PD_ENV_DIR%\mysql with my.ini next to bin\ (port 3307, 127.0.0.1 only).
rem Not a Windows service: nothing is registered on the machine; start it again after a reboot.
rem Keep comments ASCII: after chcp 65001, cmd misparses lines with multi-byte text.

if not defined PD_ENV_DIR set "PD_ENV_DIR=C:\Data\Project\环境"
set "MY_HOME=%PD_ENV_DIR%\mysql"
set "MY_BIN=%MY_HOME%\bin"
set "MY_CONN=--protocol=TCP -h 127.0.0.1 -P 3307"

if not exist "%MY_BIN%\mysqld.exe" (
  echo Not found: "%MY_BIN%\mysqld.exe". Unzip MySQL 8.4 there, or set PD_ENV_DIR.
  exit /b 1
)
if not exist "%MY_HOME%\my.ini" (
  echo Not found: "%MY_HOME%\my.ini"
  exit /b 1
)

if /i "%~1"=="start" goto start
if /i "%~1"=="stop" goto stop
if /i "%~1"=="status" goto status
echo Usage: tools\env\mysql.cmd start ^| stop ^| status
exit /b 1

:status
call :ping && (echo MySQL is running on 127.0.0.1:3307) || (echo MySQL is not running)
exit /b %errorlevel%

:start
call :ping && (echo MySQL is already running on 127.0.0.1:3307& exit /b 0)
set "MY_FRESH="
if not exist "%MY_HOME%\data\mysql" (
  echo Initializing data dir "%MY_HOME%\data" ...
  pushd "%MY_HOME%"
  bin\mysqld.exe --defaults-file=my.ini --initialize-insecure || (popd & echo Initialize failed, see data\*.err & exit /b 1)
  popd
  set "MY_FRESH=1"
)
rem Launch by RELATIVE path from MY_HOME on purpose: mysqld garbles non-ASCII paths (in my.ini, and the
rem install dir it derives from a full exe path), but resolves relative ones correctly.
powershell -NoProfile -Command "Start-Process -FilePath cmd.exe -ArgumentList '/c bin\mysqld.exe --defaults-file=my.ini' -WorkingDirectory $env:MY_HOME -WindowStyle Hidden"
for /l %%i in (1,1,30) do (
  call :ping && goto started
  ping -n 2 127.0.0.1 >nul
)
echo MySQL did not start within 30 seconds, see "%MY_HOME%\data\*.err"
exit /b 1
:started
if defined MY_FRESH (
  "%MY_BIN%\mysql.exe" %MY_CONN% -u root < "%~dp0mysql-init.sql" || (echo mysql-init.sql failed & exit /b 1)
  echo Created databases pd / pd_shadow / pd_test and users pd, root ^(see apps\server\.env.example^)
)
echo MySQL is running on 127.0.0.1:3307
exit /b 0

:stop
call :ping || (echo MySQL is not running& exit /b 0)
"%MY_BIN%\mysqladmin.exe" %MY_CONN% -u root --password=pd_root_dev shutdown 2>nul || (echo Shutdown failed & exit /b 1)
echo MySQL stopped
exit /b 0

rem mysqladmin ping exits 0 whenever the server answers, even with "Access denied".
:ping
"%MY_BIN%\mysqladmin.exe" %MY_CONN% -u ping --connect-timeout=2 ping >nul 2>&1
exit /b %errorlevel%
