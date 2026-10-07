@echo off
cd /d %~dp0
call npm run build
if errorlevel 1 goto fail
powershell -NoProfile -Command "Stop-ScheduledTask -TaskName 'npm-preview-openpets'; Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; Start-Sleep 2; Start-ScheduledTask -TaskName 'npm-preview-openpets'; Start-Sleep 5; 'HTTP ' + (Invoke-WebRequest http://localhost:5173 -UseBasicParsing).StatusCode; Get-Process node | Select-Object Id,SI"
goto end
:fail
echo Build failed. Preview was not restarted.
:end
pause