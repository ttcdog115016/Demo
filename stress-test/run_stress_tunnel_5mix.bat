@echo off
chcp 65001 >nul
cd /d %~dp0..
echo === Demo 壓力測試：cloudflared 通道 + input_test.csv，5 人混合（2K + 3DP）===
echo 目標 https://interference-profession-five-manual.trycloudflare.com
echo.
node stress-test\stress_demo.mjs --base https://interference-profession-five-manual.trycloudflare.com --csv stress-test\data\input_test.csv --users kanon,kanon,dp,dp,dp
pause