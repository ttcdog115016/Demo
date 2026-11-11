"""依序執行三種實務應用情境的測試，並輸出彙總結果。

每個情境跑七步：
    1. preprocess         資料前處理
    2. k-anonymity        K-匿名化（隱私強化技術功能驗證）
    3. dp                 差分隱私（隱私強化技術功能驗證）
    4. risk-k-anonymity   再識別攻擊模擬（K-匿名 syn）
    5. risk-dp            再識別攻擊模擬（DP syn）
    6. risk-cap           CAP 前後對比（K-匿名化結果）
    7. risk-cap           CAP 前後對比（差分隱私結果）

用法：
    python scenarios/run_scenarios.py                     # 三情境全跑
    python scenarios/run_scenarios.py --scenario 醫療研究  # 只跑一種
    python scenarios/run_scenarios.py --skip-risk         # 只跑前三步
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "scenarios" / "data"
CONFIG_DIR = ROOT / "scenarios" / "configs"
OUT_DIR = ROOT / "scenarios" / "out"
SCENARIOS = ["醫療研究", "金融分析", "交通流分析"]


def run(step: str, args: list[str]) -> dict:
    started = time.perf_counter()
    completed = subprocess.run(
        [sys.executable, "-m", "app.cli.main", *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    elapsed = round(time.perf_counter() - started, 2)
    ok = completed.returncode == 0
    print(f"  {step:<18} {'OK ' if ok else '失敗'} {elapsed:>8.2f}s")
    if not ok:
        print(completed.stdout[-1500:])
        print(completed.stderr[-1500:])
    return {
        "step": step,
        "ok": ok,
        "seconds": elapsed,
        "stdout": completed.stdout,
        "stderr": completed.stderr[-2000:],
    }


def run_scenario(name: str, skip_risk: bool) -> list[dict]:
    src = DATA_DIR / f"{name}.csv"
    pre = OUT_DIR / f"{name}_前處理.csv"
    kanon = OUT_DIR / f"{name}_K匿名.csv"
    dp = OUT_DIR / f"{name}_DP.csv"
    conf = lambda suffix: str(CONFIG_DIR / f"{name}_{suffix}.json")  # noqa: E731

    print(f"\n[{name}]")
    results = [
        run("前處理", ["preprocess", "-i", str(src), "-c", conf("preprocess"), "-o", str(pre)]),
        run("K-匿名化", ["k-anonymity", "-i", str(pre), "-c", conf("k"), "-o", str(kanon)]),
        run("差分隱私", ["dp", "-i", str(pre), "-c", conf("dp"), "-o", str(dp)]),
    ]
    if skip_risk:
        return results
    results += [
        run("三攻擊_K匿名", ["risk-k-anonymity", "-i", str(pre), "-c", conf("risk_k")]),
        run("三攻擊_DP", ["risk-dp", "-i", str(pre), "-c", conf("risk_dp")]),
        run(
            "CAP_K匿名",
            ["risk-cap", "-i", str(pre), "-p", str(kanon), "-c", conf("cap")],
        ),
        run(
            "CAP_DP",
            ["risk-cap", "-i", str(pre), "-p", str(dp), "-c", conf("cap")],
        ),
    ]
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="執行實務應用情境測試")
    parser.add_argument("--scenario", choices=SCENARIOS, help="只跑指定情境")
    parser.add_argument("--skip-risk", action="store_true", help="只跑前三步")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    targets = [args.scenario] if args.scenario else SCENARIOS
    summary: dict[str, list[dict]] = {}
    for name in targets:
        summary[name] = run_scenario(name, args.skip_risk)

    (OUT_DIR / "執行結果.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    failed = [(s, r["step"]) for s, rs in summary.items() for r in rs if not r["ok"]]
    print(f"\n完成：{sum(len(v) for v in summary.values())} 步，失敗 {len(failed)} 步")
    for scenario, step in failed:
        print(f"  失敗：{scenario} / {step}")


if __name__ == "__main__":
    main()
