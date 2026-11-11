@echo off
chcp 65001 >nul
cd /d %~dp0..
echo === Demo 壓力測試：cloudflared 通道 + input_test.csv，4 組同時 (2 K匿名 + 2 DP) ===
set /p TUNNEL=請貼上 trycloudflare 網址（直接 Enter 使用 https://maps-reload-writing-indicating.trycloudflare.com）： 
if "%TUNNEL%"=="" set TUNNEL=https://maps-reload-writing-indicating.trycloudflare.com
node stress-test\stress_demo.mjs --base %TUNNEL% --csv stress-test\data\input_test.csv %*
echo.
pause
