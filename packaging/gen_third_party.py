"""產生單機版的第三方授權聲明與 SBOM（build_exe.ps1 呼叫）。

以「授權工具專用 venv」的 Python 執行（內含 pip-licenses、cyclonedx-bom），
掃描「建置 venv」實際安裝的套件，連同前端 SBOM 列出的 npm 套件與 Python 以外的二進位元件，輸出：
  THIRD_PARTY_NOTICES.txt  每個元件的名稱、版本、授權與授權全文
  desktop-sbom.cdx.json    CycloneDX 1.5（Python 套件 ＋ 前端 ＋ 手動列出的二進位元件）
用法：python gen_third_party.py <建置 venv 的 python.exe> <前端 SBOM> <node_modules> <輸出資料夾>
★ 2026-10-30 新增：單機版原本沒有任何第三方授權聲明或 SBOM。
"""
import json
import os
import subprocess
import sys
from pathlib import Path

target_python, frontend_sbom, node_modules, out_dir = sys.argv[1:5]
target_python = str(Path(target_python).resolve())  # pip-licenses --python 只認絕對路徑
out = Path(out_dir)
out.mkdir(parents=True, exist_ok=True)
tools = Path(sys.executable).parent

# 只在建置時使用、不會進安裝檔的套件（pyinstaller 本身例外：其 bootloader 內嵌於 OpenPETs.exe）
BUILD_ONLY = {"pip", "pyinstaller-hooks-contrib", "altgraph", "pefile", "pywin32-ctypes"}

# 套件中繼資料沒寫授權、但所附授權檔可確認者
LICENSE_OVERRIDES = {"clr_loader": "MIT（依套件所附 LICENSE 檔）"}

# 不是 Python 套件、pip-licenses 掃不到，但隨安裝檔散布的元件
# ★ 2026-10-31：最後一欄為是否開源；非開源者在聲明檔開頭另列一段
BINARY_COMPONENTS = [
    ("Python runtime (python312.dll 及標準函式庫)", "3.12", "PSF-2.0", "https://docs.python.org/3/license.html", True),
    ("OpenSSL (libcrypto-3, libssl-3)", "3.x", "Apache-2.0", "https://www.openssl.org/source/license.html", True),
    ("SQLite (sqlite3.dll)", "3.x", "blessing (public domain)", "https://www.sqlite.org/copyright.html", True),
    ("Microsoft Visual C++ Runtime (vcruntime140*.dll 等)", "14.x", "Microsoft Visual C++ Redistributable 授權",
     "https://visualstudio.microsoft.com/license-terms/", False),
    ("Microsoft WebView2 SDK (Microsoft.Web.WebView2.*.dll, WebView2Loader.dll)", "pywebview 6.2.1 所附", "Microsoft WebView2 SDK 授權",
     "https://www.nuget.org/packages/Microsoft.Web.WebView2/", False),
]

LGPL_NOTE = """\
fpdf2 以 LGPL-3.0 授權。本程式以原始碼檔形式存放（安裝目錄 _internal\\fpdf\\*.py，未封入執行檔），
您可依 LGPL 自行以相容版本的 fpdf2 原始碼替換該資料夾。fpdf2 原始碼：https://github.com/py-pdf/fpdf2
（本程式使用版本見上表），亦可向本程式提供者索取。
LGPL-3.0 以 GPL-3.0 為基礎，GPL-3.0 全文見 https://www.gnu.org/licenses/gpl-3.0.txt"""

NON_OSS_NOTE = """下列元件不是開源軟體，屬 Microsoft 授權可隨應用程式再散布的閉源元件；單機版的 App 視窗（WebView2）
與 Python／numpy／scikit-learn 執行時必須使用，無開源替代。除此之外，本程式所含元件皆為開源授權。"""

PYINSTALLER_NOTE = """\
OpenPETs.exe 內嵌 PyInstaller bootloader。PyInstaller 以 GPL-2.0-or-later 授權，並附「bootloader 例外」：
以 PyInstaller 產生的執行檔可依任何授權散布，不受 GPL 約束。"""


def run_json(args: list[str]):
    return json.loads(subprocess.run(
        args, check=True, capture_output=True, text=True, encoding="utf-8",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    ).stdout)


# ── Python 套件 ──────────────────────────────────────────────────────────
py_pkgs = run_json([
    str(tools / "pip-licenses"), "--python", target_python, "--from=mixed", "--with-system",
    "--with-urls", "--with-license-file", "--no-license-path", "--with-notice-file", "--format=json",
])
py_pkgs = [p for p in py_pkgs if p["Name"].lower().replace("_", "-") not in BUILD_ONLY]
for p in py_pkgs:
    p["License"] = LICENSE_OVERRIDES.get(p["Name"], p["License"])
py_pkgs.sort(key=lambda p: p["Name"].lower())

# ── 前端 npm 套件（前端 SBOM 已列出執行期套件；授權全文取自 node_modules） ─────────
frontend = json.load(open(frontend_sbom, encoding="utf-8"))
npm_pkgs = []
for comp in frontend.get("components", []):
    full = f"{comp['group']}/{comp['name']}" if comp.get("group") else comp["name"]
    lic = ", ".join(
        l.get("license", {}).get("id") or l.get("license", {}).get("name") or l.get("expression", "")
        for l in comp.get("licenses", [])
    ) or "UNKNOWN"
    text = ""
    pkg_dir = Path(node_modules, *full.split("/"))
    for cand in sorted(pkg_dir.glob("*")) if pkg_dir.is_dir() else []:
        if cand.is_file() and cand.name.upper().startswith(("LICENSE", "LICENCE", "COPYING")):
            text = cand.read_text(encoding="utf-8", errors="replace")
            break
    npm_pkgs.append({"Name": full, "Version": comp.get("version", ""), "License": lic, "LicenseText": text})

# ── THIRD_PARTY_NOTICES.txt ───────────────────────────────────────────────
lines = [
    "Open-PETs 單機版 第三方元件授權聲明",
    "=" * 60,
    "本程式包含以下第三方元件，各依其授權條款散布。完整清單亦見 desktop-sbom.cdx.json。",
    "",
    "【非開源元件】",
    NON_OSS_NOTE,
    *[f"  {name}  {ver}  [{lic}]  {url}" for name, ver, lic, url, oss in BINARY_COMPONENTS if not oss],
    "",
    "【特別說明】",
    LGPL_NOTE,
    "",
    PYINSTALLER_NOTE,
    "",
    "【元件一覽】",
]
for name, ver, lic, url, oss in BINARY_COMPONENTS:
    lines.append(f"  {name}  {ver}  [{lic}{'' if oss else '，非開源'}]  {url}")
for p in py_pkgs:
    lines.append(f"  {p['Name']}  {p['Version']}  [{p['License']}]  (Python)")
for p in npm_pkgs:
    lines.append(f"  {p['Name']}  {p['Version']}  [{p['License']}]  (前端)")
lines += ["", "【授權全文】"]
for p in py_pkgs:
    lines += ["", "-" * 60, f"{p['Name']} {p['Version']}  [{p['License']}]", "-" * 60]
    lines.append(p.get("LicenseText", "").strip() or f"（套件未附授權檔，授權：{p['License']}；{p.get('URL', '')}）")
    notice = p.get("NoticeText", "").strip()
    if notice and notice != "UNKNOWN":
        lines += ["", notice]
for p in npm_pkgs:
    lines += ["", "-" * 60, f"{p['Name']} {p['Version']}  [{p['License']}]", "-" * 60]
    lines.append(p["LicenseText"].strip() or f"（套件未附授權檔，授權：{p['License']}）")
(out / "THIRD_PARTY_NOTICES.txt").write_text("\n".join(lines) + "\n", encoding="utf-8-sig")

# ── desktop-sbom.cdx.json ────────────────────────────────────────────────
sbom_path = out / "desktop-sbom.cdx.json"
subprocess.run(
    [str(tools / "cyclonedx-py"), "environment", target_python, "--sv", "1.5", "--of", "JSON",
     "--output-reproducible", "-o", str(sbom_path)],
    check=True,
)
sbom = json.load(open(sbom_path, encoding="utf-8"))
sbom["components"] = [
    c for c in sbom.get("components", []) if c["name"].lower().replace("_", "-") not in BUILD_ONLY
]
sbom["components"] += [
    {"type": "library", "name": name, "version": ver, "bom-ref": f"binary:{name}",
     "licenses": [{"license": {"name": lic}}], "externalReferences": [{"type": "license", "url": url}]}
    for name, ver, lic, url, _ in BINARY_COMPONENTS
]
sbom["components"] += [{**c, "bom-ref": f"frontend:{c.get('bom-ref', c['name'])}"} for c in frontend.get("components", [])]
sbom.pop("dependencies", None)  # 過濾後部分參照已不存在，相依關係以各自來源（uv.lock、package-lock.json）為準
json.dump(sbom, open(sbom_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

unknown = [p["Name"] for p in py_pkgs + npm_pkgs if p["License"] in ("UNKNOWN", "")]
print(f"Python {len(py_pkgs)}、前端 {len(npm_pkgs)}、二進位 {len(BINARY_COMPONENTS)} 個元件 -> {out}")
if unknown:
    print(f"[注意] 授權未知：{', '.join(unknown)}")
