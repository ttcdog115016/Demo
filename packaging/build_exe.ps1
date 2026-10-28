# ============================================================================
# Open-PETs 單機版執行檔建置（Windows）
# 用法：在 Demo 資料夾雙擊 packaging\build_exe.bat，或在 PowerShell：
#   powershell -ExecutionPolicy Bypass -File .\packaging\build_exe.ps1
#   可選參數：-BackendSrc <後端 01_程式原始碼 路徑> -Python <python.exe 路徑> -Version 2.0.0
# 產出：packaging\dist\OpenPETs\（資料夾版）與 packaging\dist\OpenPETs_<版本>_<日期>.zip
# 需要：Node.js（已裝好 node_modules）、Python 3.12（後端所附 wheel 為 CPython 3.12）、可連網安裝 PyInstaller
# ============================================================================
param(
    [string]$BackendSrc = (Join-Path $env:USERPROFILE 'Desktop\TTC-隱私強化技術實證委託採購案-期末-20261027T012822Z-1-001\TTC-隱私強化技術實證委託採購案-期末\open-pets_3.1_完整交付套件_v2.0.0\3.1_完整交付套件\01_程式原始碼'),
    [string]$Python = '',
    [string]$Version = '2.0.0'
)
$ErrorActionPreference = 'Stop'
$PackDir  = $PSScriptRoot
$Root     = Split-Path $PackDir -Parent              # Demo 資料夾
$BuildDir = Join-Path $PackDir 'build'
$DistDir  = Join-Path $PackDir 'dist'
$FrontOut = Join-Path $BuildDir 'frontend'
$VenvDir  = Join-Path $BuildDir 'venv'
$Wheels   = Join-Path (Split-Path $BackendSrc -Parent) '06_離線安裝\wheels\windows'

function Step($msg) { Write-Host ''; Write-Host "== $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "[失敗] $msg" -ForegroundColor Red; exit 1 }

if (-not (Test-Path (Join-Path $BackendSrc 'app\api\server.py'))) { Fail "找不到後端原始碼：$BackendSrc（以 -BackendSrc 指定 01_程式原始碼 資料夾）" }

# ---------------------------------------------------------------- 1. 前端
Step '1/4 建置前端（單機版模式：不顯示 Demo 帳號、不送錯誤到 Google 表單）'
Push-Location $Root
try {
    if (-not (Test-Path 'node_modules')) { npm ci; if ($LASTEXITCODE) { Fail 'npm ci 失敗' } }
    npx tsc -b;                                                        if ($LASTEXITCODE) { Fail '型別檢查失敗' }
    $env:VITE_BUILD_TARGET = 'desktop'   # 同 .env.desktop（.env* 被 .gitignore 排除，這裡直接設定以免新 clone 漏掉）
    npx vite build --mode desktop --outDir $FrontOut --emptyOutDir;    if ($LASTEXITCODE) { Fail '前端建置失敗' }
} finally { Pop-Location }

# ---------------------------------------------------------------- 2. Python 3.12
Step '2/4 準備 Python 3.12 建置環境'
function Test-Py312([string]$exe, [string[]]$pre) {
    try { $v = & $exe @pre -c 'import sys;print(sys.version_info[0]*100+sys.version_info[1])' 2>$null; return ([string]$v).Trim() -eq '312' } catch { return $false }
}
$pyExe = $null; $pyPre = @()
if ($Python) { $pyExe = $Python }
elseif (Test-Py312 'py' @('-3.12')) { $pyExe = 'py'; $pyPre = @('-3.12') }
elseif (Test-Py312 'python' @()) { $pyExe = 'python' }
if (-not $pyExe -or -not (Test-Py312 $pyExe $pyPre)) {
    Fail ('找不到 Python 3.12。請安裝 python.org 的 Python 3.12（64 位元），' +
          '或用 Anaconda：conda create -n openpets-build python=3.12，再以 -Python <該環境的 python.exe> 指定。')
}
$VenvPy = Join-Path $VenvDir 'Scripts\python.exe'
if (-not (Test-Path $VenvPy)) {
    & $pyExe @pyPre -m venv $VenvDir; if ($LASTEXITCODE) { Fail '建立虛擬環境失敗' }
}
& $VenvPy -m pip install --upgrade pip --quiet
# 依後端 pyproject.toml 的 dependencies（只裝執行必要套件；版本已鎖定）
$req = Join-Path $BuildDir 'requirements-runtime.txt'
& $VenvPy (Join-Path $PackDir 'write_requirements.py') (Join-Path $BackendSrc 'pyproject.toml') $req; if ($LASTEXITCODE) { Fail '讀取後端 pyproject.toml 失敗' }
$pipArgs = @('-m', 'pip', 'install', '-r', $req, 'pyinstaller>=6.10,<7', '--quiet')
if (Test-Path $Wheels) { $pipArgs += @('--find-links', $Wheels) }   # 優先用交付包所附 wheel
& $VenvPy @pipArgs; if ($LASTEXITCODE) { Fail '安裝 Python 套件失敗' }

# ---------------------------------------------------------------- 3. PyInstaller
Step '3/4 打包（PyInstaller，約 2~5 分鐘）'
$env:OPEN_PETS_BACKEND_SRC = $BackendSrc
$env:OPEN_PETS_FRONTEND_DIST = $FrontOut
& $VenvPy -m PyInstaller --noconfirm --clean --distpath $DistDir --workpath (Join-Path $BuildDir 'pyi') (Join-Path $PackDir 'OpenPETs.spec')
if ($LASTEXITCODE) { Fail 'PyInstaller 打包失敗' }

$AppDir = Join-Path $DistDir 'OpenPETs'
Copy-Item (Join-Path $PackDir '使用說明.txt') $AppDir -Force

# ---------------------------------------------------------------- 4. 壓縮
Step '4/4 壓縮成 zip'
$zip = Join-Path $DistDir ("OpenPETs_{0}_{1}.zip" -f $Version, (Get-Date -Format 'yyyyMMdd'))
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path $AppDir -DestinationPath $zip -CompressionLevel Optimal

Write-Host ''
Write-Host "完成。" -ForegroundColor Green
Write-Host "  資料夾：$AppDir"
Write-Host "  壓縮檔：$zip"
Write-Host '  測試：執行 OpenPETs.exe，第一次會要求建立管理員帳號，之後自動開啟瀏覽器。'
Write-Host '  注意：測試產生的 .env 與 data\ 在 dist\OpenPETs 內；發布請用 zip（建置當下打包，不含測試資料）。'
