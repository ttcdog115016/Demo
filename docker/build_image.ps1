# ============================================================================
# Open-PETs 單一 Docker 映像檔建置＋離線交付包輸出
# 用法：powershell -ExecutionPolicy Bypass -File .\docker\build_image.ps1 [-BackendSrc <01_程式原始碼>] [-Version 2.0.2]
# 產出：docker\dist\open-pets-app_<版本>\
#         open-pets-app_<版本>.tar   映像檔（docker load 匯入）
#         docker-compose.yml         啟動設定
#         SHA256SUMS.txt             完整性檢查碼（交付時另以安全管道傳遞一份）
#         README_Docker部署.md       安裝、升級、備份說明
# 需要：Docker Desktop（含 buildx）、可連網（建置時下載基底映像與前後端相依套件；交付後的安裝端不需要）
# ============================================================================
param(
    [string]$BackendSrc = (Join-Path $env:USERPROFILE 'Desktop\TTC-隱私強化技術實證委託採購案-期末-20261027T012822Z-1-001\TTC-隱私強化技術實證委託採購案-期末\open-pets_3.1_完整交付套件_v2.0.0\3.1_完整交付套件\01_程式原始碼'),
    [string]$Version = '2.0.2'
)
$ErrorActionPreference = 'Stop'
$DockerDir = $PSScriptRoot
$Root      = Split-Path $DockerDir -Parent
$Image     = "open-pets-app:$Version"
$OutDir    = Join-Path $DockerDir "dist\open-pets-app_$Version"

function Step($msg) { Write-Host ''; Write-Host "== $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "[失敗] $msg" -ForegroundColor Red; exit 1 }

if (-not (Test-Path (Join-Path $BackendSrc 'app\api\server.py'))) { Fail "找不到後端原始碼：$BackendSrc（以 -BackendSrc 指定 01_程式原始碼 資料夾）" }

Step "1/3 建置映像檔 $Image"
docker buildx build -f (Join-Path $DockerDir 'Dockerfile') --build-context "backend=$BackendSrc" `
    --build-arg "OPEN_PETS_VERSION=$Version" -t $Image --load $Root
if ($LASTEXITCODE) { Fail '映像檔建置失敗' }

Step '2/3 輸出離線交付包'
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$Tar = Join-Path $OutDir "open-pets-app_$Version.tar"
docker save -o $Tar $Image
if ($LASTEXITCODE) { Fail 'docker save 失敗' }
Copy-Item (Join-Path $DockerDir 'docker-compose.yml') $OutDir
Copy-Item (Join-Path $DockerDir 'README_Docker部署.md') $OutDir
"OPEN_PETS_VERSION=$Version" | Set-Content (Join-Path $OutDir '.env.example') -Encoding ascii

Step '3/3 計算 SHA256'
$lines = Get-ChildItem $OutDir -File | Where-Object { $_.Name -ne 'SHA256SUMS.txt' } | ForEach-Object {
    '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name
}
# 一律用 LF 換行：Linux 的 sha256sum -c 遇到 CRLF 會找不到檔案
[System.IO.File]::WriteAllText((Join-Path $OutDir 'SHA256SUMS.txt'), (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
$lines | ForEach-Object { Write-Host "   $_" }

Write-Host ''
Write-Host "完成：$OutDir" -ForegroundColor Green
Write-Host ("   映像檔大小：{0:N0} MB" -f ((Get-Item $Tar).Length / 1MB))
