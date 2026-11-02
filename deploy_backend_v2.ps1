# ============================================================================
# 升級後端為期末版 open-pets 2.0.0，並建立登入頁的 Demo 測試帳號
# 用法：在 PowerShell 執行  powershell -ExecutionPolicy Bypass -File .\deploy_backend_v2.ps1
# 步驟依交付套件「02_部署腳本\建置與啟動說明.md」：
#   1. 建置映像檔 open-pets:2.0.0
#   2. 建立 C:\open-pets-data（帳號資料庫、稽核日誌）與 C:\open-pets\.env（已存在則沿用）
#      舊容器若有設定鹽值 OPEN_PETS_DEFAULT_SALT，沿用同一個值（換鹽值會讓雜湊結果與先前不同）
#   3. 舊容器 open-pets（1.2.0）停止並改名為 open-pets-old，保留作為退回用，不刪除
#   4. 以 2.0.0 啟動新容器 open-pets（埠 8000）
#   5. 建立 Demo 帳號 owner@test.com（User，密碼 Owner@123456）、admin@test.com（Admin，密碼 Admin@123456）
# ============================================================================
$ErrorActionPreference = 'Stop'

$SourceDir = Join-Path $env:USERPROFILE 'Desktop\TTC-隱私強化技術實證委託採購案-期末-20261027T012822Z-1-001\TTC-隱私強化技術實證委託採購案-期末\open-pets_3.1_完整交付套件_v2.0.0\3.1_完整交付套件\01_程式原始碼'
$Image     = 'open-pets:2.0.0'
$DataDir   = 'C:\open-pets-data'
$EnvDir    = 'C:\open-pets'
$EnvFile   = Join-Path $EnvDir '.env'

if (-not (Test-Path (Join-Path $SourceDir 'Dockerfile'))) { throw "找不到原始碼：$SourceDir" }

Write-Host '== 1. 建置映像檔 open-pets:2.0.0（第一次約需數分鐘）'
docker build -t $Image $SourceDir
if ($LASTEXITCODE -ne 0) { throw '建置失敗' }

Write-Host '== 2. 準備資料目錄與 .env'
New-Item -ItemType Directory -Force $DataDir, $EnvDir | Out-Null
if (Test-Path $EnvFile) {
    Write-Host "   沿用既有的 $EnvFile"
} else {
    $oldSalt = $null
    $oldExists = (docker ps -a --filter 'name=^open-pets$' --format '{{.Names}}') -eq 'open-pets'
    if ($oldExists) {
        $oldEnv = docker inspect open-pets --format '{{range .Config.Env}}{{println .}}{{end}}'
        $saltLine = $oldEnv | Where-Object { $_ -like 'OPEN_PETS_DEFAULT_SALT=*' } | Select-Object -First 1
        if ($saltLine) { $oldSalt = $saltLine.Substring('OPEN_PETS_DEFAULT_SALT='.Length) }
    }
    function New-Secret { (docker run --rm $Image python -c "import secrets; print(secrets.token_hex(32))").Trim() }
    $salt = if ($oldSalt) { Write-Host '   沿用舊容器的鹽值'; $oldSalt } else { New-Secret }
    $content = @(
        '# 假名化與雜湊之鹽值（設定後不要再變更）'
        "OPEN_PETS_DEFAULT_SALT=$salt"
        '# 稽核日誌簽章金鑰'
        "OPEN_PETS_SYSTEM_MASTER_KEY=$(New-Secret)"
        '# 登入 token 簽章金鑰（會員系統必要）'
        "OPEN_PETS_JWT_SECRET=$(New-Secret)"
    )
    # 以無 BOM 的 UTF-8 寫入，避免第一行變數名稱前多出 BOM
    [System.IO.File]::WriteAllLines($EnvFile, $content, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "   已建立 $EnvFile"
}

Write-Host '== 3. 停止舊容器並改名為 open-pets-old（保留可退回）'
if ((docker ps -a --filter 'name=^open-pets$' --format '{{.Names}}') -eq 'open-pets') {
    if ((docker ps -a --filter 'name=^open-pets-old$' --format '{{.Names}}') -eq 'open-pets-old') { docker rm -f open-pets-old | Out-Null }
    docker stop open-pets | Out-Null
    docker rename open-pets open-pets-old
}

Write-Host '== 4. 啟動 2.0.0'
$a = 'run', '-d', '--name', 'open-pets', '--restart', 'unless-stopped',
  # ★ 2026-10-30：只綁本機；外部一律經 Vite（5173）/ 通道代理，不直接以明文 HTTP 開放後端
  '-p', '127.0.0.1:8000:8000',
  '-v', "${DataDir}:/data",
  '-v', "${EnvFile}:/srv/.env:ro",
  $Image
docker @a | Out-Null
if ($LASTEXITCODE -ne 0) { throw '啟動失敗' }
Start-Sleep -Seconds 6
$root = curl.exe -s http://127.0.0.1:8000/
Write-Host "   後端回應：$root"

Write-Host '== 5. 建立 Demo 測試帳號（已存在會顯示「已經存在」，可忽略）'
docker exec open-pets python -m app.cli.main create-user -u owner@test.com -p Owner@123456 -r user
# ★ 2026-10-28：後端改為密碼至少 12 字，owner 的 Demo 密碼由 password 改為 Owner@123456；既有帳號一併重設
docker exec open-pets python -c "from app.governance.auth import get_auth_manager as g; g().reset_password('owner@test.com', 'Owner@123456'); print('owner@test.com 密碼已設為 Owner@123456')"
docker exec open-pets python -m app.cli.main create-user -u admin@test.com -p Admin@123456 -r admin

Write-Host ''
Write-Host '完成。回應中 version 應為 2.0.0。'
Write-Host '若要退回舊版：docker rm -f open-pets; docker rename open-pets-old open-pets; docker start open-pets'
