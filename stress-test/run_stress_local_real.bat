@echo off
chcp 65001 >nul
cd /d %~dp0..
echo === Demo 壓力測試：本機 + input_test.csv，4 組同時 (2 K匿名 + 2 DP) ===
echo 請確認已啟動後端 Docker 與 run_preview.bat
echo.
node stress-test\stress_demo.mjs --csv stress-test\data\input_test.csv %*
echo.
pause
