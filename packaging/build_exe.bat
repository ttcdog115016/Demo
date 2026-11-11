@echo off
REM Open-PETs standalone build. See README_build.md
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_exe.ps1" %*
echo.
pause
