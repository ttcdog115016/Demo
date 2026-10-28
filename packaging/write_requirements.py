"""由後端 pyproject.toml 的 [project] dependencies 產生執行用 requirements（build_exe.ps1 呼叫）。

只取執行必要套件（不含 dev／test／scripts 群組），版本照後端鎖定值。
用法：python write_requirements.py <pyproject.toml> <輸出 requirements.txt>
"""
import sys
import tomllib

with open(sys.argv[1], "rb") as f:
    deps = tomllib.load(f)["project"]["dependencies"]
with open(sys.argv[2], "w", encoding="utf-8") as f:
    f.write("\n".join(deps) + "\n")
print(f"{len(deps)} 個套件 -> {sys.argv[2]}")
