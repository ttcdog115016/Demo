@echo off
chcp 65001 >nul
cd /d %~dp0..
echo === Demo 壓力測試：cloudflared 通道 + input_test_20k.csv（2 萬筆），2 組 DP 同時 ===
echo.
node stress-test\stress_demo.mjs --base https://maps-reload-writing-indicating.trycloudflare.com --csv stress-test\data\input_test_20k.csv --users dp,dp %*
echo.
pause
