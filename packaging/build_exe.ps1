# ============================================================================
# Open-PETs 單機版執行檔建置（Windows）
# 用法：在 Demo 資料夾雙擊 packaging\build_exe.bat，或在 PowerShell：
#   powershell -ExecutionPolicy Bypass -File .\packaging\build_exe.ps1
#   可選參數：-BackendSrc <後端 01_程式原始碼 路徑> -Python <python.exe 路徑> -Version 2.0.0
# 產出：packaging\dist\OpenPETs_Setup_<版本>.exe（安裝程式，發布用）與 packaging\dist\OpenPETs\（安裝內容）
# 需要：Node.js（已裝好 node_modules）、Python 3.12（後端所附 wheel 為 CPython 3.12）、可連網安裝 PyInstaller／pywebview、
#       Inno Setup 6（winget install JRSoftware.InnoSetup）
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
$pipArgs = @('-m', 'pip', 'install', '-r', $req, 'pyinstaller>=6.10,<7', 'pywebview>=6.2,<7', '--quiet')   # pywebview：App 視窗（WebView2）
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

# ---------------------------------------------------------------- 4. 安裝程式
Step '4/4 製作安裝程式（Inno Setup）'
$iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
    $iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $iscc) { Fail '找不到 Inno Setup 6（ISCC.exe）。請先安裝：winget install JRSoftware.InnoSetup' }
& $iscc /Qp "/DAppVersion=$Version" "/DSourceDir=$AppDir" "/DOutputDir=$DistDir" (Join-Path $PackDir 'OpenPETs.iss')
if ($LASTEXITCODE) { Fail 'Inno Setup 製作安裝程式失敗' }
$setup = Join-Path $DistDir ("OpenPETs_Setup_{0}.exe" -f $Version)

Write-Host ''
Write-Host "完成。" -ForegroundColor Green
Write-Host "  安裝程式：$setup"
Write-Host "  安裝內容：$AppDir"
Write-Host '  測試：執行安裝程式，從開始功能表開啟 Open-PETs；第一次會在 App 視窗內建立管理員帳號。'
Write-Host '  資料（.env、帳號、稽核紀錄）在 %LOCALAPPDATA%\OpenPETs，解除安裝不會刪除。'
