# -*- mode: python ; coding: utf-8 -*-
# PyInstaller 設定：Open-PETs 單機版（資料夾版 onedir）
# 由 build_exe.ps1 呼叫；兩個路徑以環境變數傳入：
#   OPEN_PETS_BACKEND_SRC   後端原始碼（含 app/ 的 01_程式原始碼 資料夾）
#   OPEN_PETS_FRONTEND_DIST 前端 vite build --mode desktop 的輸出資料夾
import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

backend_src = os.path.abspath(os.environ["OPEN_PETS_BACKEND_SRC"])
frontend_dist = os.path.abspath(os.environ["OPEN_PETS_FRONTEND_DIST"])
icon_file = os.path.join(SPECPATH, "app.ico")

hiddenimports = (
    collect_submodules("app")            # 後端各路由、引擎由 factory 依名稱載入，全部帶上
    + collect_submodules("uvicorn")      # uvicorn 的 loops／protocols 以字串動態載入
    + collect_submodules("diffprivlib")
    + collect_submodules("sklearn.ensemble")
    + ["python_multipart", "multipart", "openpyxl", "yaml", "jwt", "dotenv"]
)

datas = [(frontend_dist, "frontend")]
# 後端非 .py 資源：合規 PDF 報告用的中文字型（app/governance/fonts）
datas += [
    (os.path.join(backend_src, "app", "governance", "fonts"), os.path.join("app", "governance", "fonts")),
]
datas += collect_data_files("fpdf")
datas += collect_data_files("diffprivlib")

a = Analysis(
    [os.path.join(SPECPATH, "launcher.py")],
    pathex=[backend_src],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    # 執行時用不到、但會被間接拉進來的大型套件
    excludes=["tkinter", "matplotlib", "IPython", "pytest", "notebook", "jupyter", "PyQt5", "PySide6"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="OpenPETs",
    console=True,           # 需要主控台：第一次建立管理員、顯示網址、關視窗即停止服務
    icon=icon_file if os.path.exists(icon_file) else None,
    upx=False,              # UPX 壓縮容易被防毒誤判，不用
    disable_windowed_traceback=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="OpenPETs",
)
