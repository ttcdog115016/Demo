# ============================================================================
# Open-PETs 單一 Docker 映像檔建置＋離線交付包輸出
# 用法：powershell -ExecutionPolicy Bypass -File .\docker\build_image.ps1 [-Version 2.0.2]
# 產出：docker\dist\open-pets-app_<版本>\
#         open-pets-app_<版本>.tar   映像檔（docker load 匯入）
#         docker-compose.yml         啟動設定（離線／本機）
#         docker-compose.online.yml  線上模式（與上一個疊加使用）
#         SHA256SUMS.txt             完整性檢查碼（交付時另以安全管道傳遞一份）
#         README_Docker部署.md       安裝、升級、備份說明
#         Caddyfile.example、nginx.conf.example  線上模式的反向代理範例（HTTPS）
#         LICENSE、THIRD_PARTY_NOTICES.txt、FRONTEND_THIRD_PARTY_LICENSES.md  授權聲明（取自映像檔）
#         REBUILD.md、open-pets-source_<版本>.zip  重新建置與替換第三方元件（含前端與 backend/）
#         image-sbom.cdx.json        映像檔 SBOM
# 需要：Docker Desktop（含 buildx）、可連網（建置時下載基底映像與前後端相依套件；交付後的安裝端不需要）。
#       後端原始碼在 repo 的 backend/，不需要外部路徑。
# ============================================================================
param(
    [string]$Version = '2.0.2'
)
$ErrorActionPreference = 'Stop'
$DockerDir = $PSScriptRoot
$Root      = Split-Path $DockerDir -Parent
$Image     = "open-pets-app:$Version"
$OutDir    = Join-Path $DockerDir "dist\open-pets-app_$Version"

function Step($msg) { Write-Host ''; Write-Host "== $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "[失敗] $msg" -ForegroundColor Red; exit 1 }

if (-not (Test-Path (Join-Path $Root 'backend\app\api\server.py'))) { Fail "找不到 backend\（後端原始碼應在 repo 根目錄的 backend\）" }

Step "1/3 建置映像檔 $Image"
$Revision = (git -C $Root rev-parse HEAD).Trim()   # 寫入映像檔 label，之後可由映像檔對應到原始碼的 commit
docker buildx build -f (Join-Path $DockerDir 'Dockerfile') `
    --build-arg "OPEN_PETS_VERSION=$Version" --build-arg "OPEN_PETS_REVISION=$Revision" -t $Image --load $Root
if ($LASTEXITCODE) { Fail '映像檔建置失敗' }

Step '2/3 輸出離線交付包'
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$Tar = Join-Path $OutDir "open-pets-app_$Version.tar"
docker save -o $Tar $Image
if ($LASTEXITCODE) { Fail 'docker save 失敗' }
foreach ($f in 'docker-compose.yml', 'docker-compose.online.yml', 'README_Docker部署.md', 'REBUILD.md') {
    Copy-Item (Join-Path $DockerDir $f) $OutDir
}
# 反向代理範例（交付包內不放子資料夾，所以改成 .example 檔名）
Copy-Item (Join-Path $DockerDir 'proxy-examples\Caddyfile') (Join-Path $OutDir 'Caddyfile.example')
Copy-Item (Join-Path $DockerDir 'proxy-examples\nginx.conf') (Join-Path $OutDir 'nginx.conf.example')
"OPEN_PETS_VERSION=$Version" | Set-Content (Join-Path $OutDir '.env.example') -Encoding ascii

# 授權聲明：取自映像檔本身（與映像檔內 /licenses 完全一致），二進位散布時隨交付包附上
$tmpContainer = "open-pets-licenses-$PID"
docker create --name $tmpContainer $Image | Out-Null
if ($LASTEXITCODE) { Fail 'docker create 失敗' }
try {
    foreach ($f in 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'FRONTEND_THIRD_PARTY_LICENSES.md') {
        docker cp "${tmpContainer}:/licenses/$f" (Join-Path $OutDir $f)
        if ($LASTEXITCODE) { Fail "取不出 /licenses/$f（映像檔缺少授權聲明）" }
    }
} finally { docker rm $tmpContainer | Out-Null }

# 原始碼（前端＋backend/，供依 REBUILD.md 重新建置、替換第三方元件）。只放建置與說明所需的路徑，不含內部報告與工具
$dirty = git -C $Root status --porcelain -- backend src public docker packaging sbom e2e index.html package.json package-lock.json
if ($dirty) { Write-Host '[警告] 有尚未 commit 的變更；原始碼壓縮檔只含已 commit 的內容，請先 commit 再建置。' -ForegroundColor Yellow }
$SourceZip = Join-Path $OutDir "open-pets-source_$Version.zip"
# core.autocrlf=false：Windows 預設會把文字檔轉成 CRLF；這裡固定輸出 repo 內的 LF，與 GitHub Actions 產出的壓縮檔一致
git -c core.autocrlf=false -C $Root archive --format=zip --prefix=open-pets/ -o $SourceZip HEAD -- `
    backend src public e2e docker packaging sbom scripts api-docs index.html package.json package-lock.json `
    tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts eslint.config.js playwright.config.ts LICENSE README.md
if ($LASTEXITCODE) { Fail 'git archive 失敗' }

# 映像檔 SBOM（CycloneDX）：需要 Trivy 映像檔（首次要連網拉取）；失敗只警告，不中斷
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache -v "${OutDir}:/out" `
    aquasec/trivy:latest image -q --format cyclonedx -o /out/image-sbom.cdx.json $Image
if ($LASTEXITCODE) { Write-Host '[警告] 映像檔 SBOM 產生失敗（需要連網拉取 aquasec/trivy），交付包不含 image-sbom.cdx.json' -ForegroundColor Yellow }

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
