"""差分隱私壓力測試：500 萬筆規模的分階段耗時／記憶體量測與風險評估。

風險評估走兩支門面：三攻擊為 `run_attacks`（引擎自行
切分並對 train 加噪產生 syn），CAP 前後對比為 `run_cap`。

設定一律取自 `benchmarks/config_dp_5m.json`（與交付給整合方相同的大包格式），
壓測與正式用法因此走同一條解析路徑，改參數不必動程式。

★設定檔裡的 `sensitivity` 是「據實申報」的值域上界，申報值小於真實極差會使報告
揭露的 ε 不成立。測試資料由 `generate_data.py` 以固定值域產生（薪資 25000–149999、
就醫次數 0–19），故取足以涵蓋該值域的申報值，不隨資料筆數變動。
風險評估的準識別符取加噪欄位：DP 只改動這些欄位的值，攻擊者能利用的差異也在此；
取兩欄（而非單欄）方能執行連結性攻擊，量到 KNN 建索引樹的記憶體佔用。

用法（於專案根目錄執行）：
    python -m benchmarks.dp                  # 使用 scratch/test_data_5000k.csv
    python -m benchmarks.dp <資料集路徑>      # 指定其他資料集（小資料可用於驗證流程）
"""
import json
import os
import sys
from pathlib import Path

import pandas as pd

from app.core.config import parse_bundled_config
from app.core.dataset_io import export_result
from app.engines.dp import run_dp
from app.engines.risk import run_attacks, run_cap
from app.governance.report import generate_pdf_report
from benchmarks.utils import SCRATCH_DIR, StageRecorder, describe_environment

DEFAULT_DATASET = str(SCRATCH_DIR / "test_data_5000k.csv")
CONFIG_PATH = str(Path(__file__).resolve().parent / "config_dp_5m.json")


def benchmark_dp_full(file_path: str = DEFAULT_DATASET):
    if not os.path.exists(file_path):
        print(f"[!] 找不到資料集: {file_path}")
        return

    # 一份大包設定檔同時描述「怎麼加噪」與「用哪些欄位評風險」，與 CLI 的 risk-dp
    # 走同一個端點解析，壓測因此驗到的是整合方實際會用的那條路。
    cfgs = parse_bundled_config(CONFIG_PATH, "risk_dp")
    dp_config = cfgs.dp
    rc = cfgs.risk
    qi_cols = rc.qi_columns()
    s_cols = rc.sensitive_columns()

    recorder = StageRecorder()
    print(f"[*] 差分隱私壓力測試開始，資料集：{file_path}")

    with recorder.measure("讀取資料集"):
        df = pd.read_csv(file_path)
    print(f"    資料規模：{len(df):,} 筆 × {len(df.columns)} 欄")

    with recorder.measure("差分隱私加噪處理"):
        df_out, report = run_dp(df, dp_config)

    # 三攻擊：引擎自行切 80/20 並對 train 重跑一次完整 DP 產生 syn，
    # 故本階段耗時包含一次加噪，與上一階段不可混計。
    with recorder.measure("三攻擊評估（內含引擎自產 syn）"):
        attack_report = run_attacks(
            original_df=df,
            qi_cols=qi_cols,
            sensitive_cols=s_cols,
            method="dp",
            deid_config=dp_config,
        )

    with recorder.measure("CAP 前後對比"):
        cap_report = run_cap(df, df_out, qi_cols, s_cols)

    with recorder.measure("輸出加噪結果 CSV"):
        out_csv = export_result(df_out, str(SCRATCH_DIR / "dp_result.csv"))
    print(f"    加噪後資料已輸出至: {out_csv}")

    perf = recorder.to_dict()
    results = {
        "dataset": file_path,
        "num_rows": len(df),
        "num_columns": len(df.columns),
        # 效能報告要交代「這組數字是哪一版程式、哪一份設定、在什麼機器上量的」，
        # 故量測當下就一併記下，事後不必回頭考證。
        "environment": describe_environment(),
        "config_path": CONFIG_PATH,
        "config_version": cfgs.version,
        "column_budgets": {
            col: budget.model_dump()
            for col, budget in dp_config.column_budgets.items()
        },
        "performance": perf,
        "consumed_epsilon": report.consumed_epsilon,
        "attack_report": attack_report.to_dict(),
        "cap_report": cap_report.to_dict(),
    }
    results_path = SCRATCH_DIR / "last_dp_results.json"
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    pdf_path = generate_pdf_report(
        task_id="PERF_5M_DP",
        attack_report=attack_report.to_dict(),
        cap_report=cap_report.to_dict(),
        out_path=str(SCRATCH_DIR / "dp_performance_report.pdf"),
    )

    print(
        f"[OK] 全部階段合計 {perf['total_seconds'] / 60:.2f} 分鐘，"
        f"整體記憶體峰值 {perf['peak_rss_mb']:.1f} MB。"
    )
    print(f"[OK] 量測數據：{results_path}；風險報告 PDF：{pdf_path}")


if __name__ == "__main__":
    benchmark_dp_full(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DATASET)
