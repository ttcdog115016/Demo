"""由後端 uv.lock 產生執行用 requirements（build_exe.ps1 呼叫）。

只取執行必要套件（不含 dev／test／scripts 群組），連同所有間接相依一律照 uv.lock 的版本鎖定，
與後端 Docker 映像（uv sync --locked --no-default-groups）裝到同一組版本。
★ 2026-10-30：原本只列 pyproject.toml 的 20 個直接相依，間接相依由 pip 現場解析，
  桌面版因此比後端多出 19 個不同版本（pillow 13、python-dateutil 3 等）。

用法：python write_requirements.py <uv.lock> <輸出 requirements.txt>
"""
import sys
import tomllib

with open(sys.argv[1], "rb") as f:
    packages = tomllib.load(f)["package"]

by_name: dict[str, list[dict]] = {}
for pkg in packages:
    by_name.setdefault(pkg["name"], []).append(pkg)


def find(dep: dict) -> dict:
    candidates = by_name[dep["name"]]
    if "version" in dep:
        candidates = [p for p in candidates if p["version"] == dep["version"]]
    if len(candidates) != 1:
        raise SystemExit(f"uv.lock 中 {dep['name']} 的版本無法唯一決定：{[p['version'] for p in candidates]}")
    return candidates[0]


root = next(p for p in packages if p.get("source", {}).get("virtual") == ".")
# 套件 -> 進入它的條件（None 表示無條件）；任一路徑無條件即無條件
markers: dict[tuple[str, str], set | None] = {}
queue = [(dep, dep.get("marker")) for dep in root["dependencies"]]
while queue:
    dep, marker = queue.pop()
    pkg = find(dep)
    key = (pkg["name"], pkg["version"])
    seen = key in markers
    if marker is None:
        if seen and markers[key] is None:
            continue
        markers[key] = None
    else:
        if seen and (markers[key] is None or marker in markers[key]):
            continue
        markers.setdefault(key, set()).add(marker)
    children = list(pkg.get("dependencies", []))
    for extra in dep.get("extra", []):
        children += pkg.get("optional-dependencies", {}).get(extra, [])
    queue += [(child, child.get("marker")) for child in children]

lines = []
for (name, version), conds in sorted(markers.items()):
    line = f"{name}=={version}"
    if conds:
        line += " ; " + " or ".join(f"({c})" for c in sorted(conds))
    lines.append(line)
with open(sys.argv[2], "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
print(f"{len(lines)} 個套件（含間接相依，版本照 uv.lock）-> {sys.argv[2]}")
