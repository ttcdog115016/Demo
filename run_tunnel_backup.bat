@echo off
cd /d %~dp0
cloudflared.exe tunnel --protocol http2 --url http://localhost:5173 >> C:\Users\TTCWEI\Desktop\Demo\cloudflared.log 2>&1
