@echo off
chcp 65001 >nul
cd /d %~dp0..
echo === Privacy Toolkit Demo 壓力測試：4 組同時使用 (2 K匿名 + 2 DP) ===
echo 請確認已啟動後端 Docker 與 run_preview.bat
echo.
node stress-test\stress_demo.mjs %*
echo.
pause
