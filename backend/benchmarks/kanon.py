"""K-匿名化壓力測試：500 萬筆規模的分階段耗時／記憶體量測與風險評估。

風險評估走兩支門面：三攻擊為 `run_attacks`（引擎自行
切分並產生 syn），CAP 前後對比為 `run_cap`（吃處理前後兩份現成資料）。

設定一律取自 `benchmarks/config_kanon_5m.json`（與交付給整合方相同的大包格式），
壓測與正式用法因此走同一條解析路徑，改參數不必動程式。

★該設定檔的泛化設定不可任意調整：數值與日期型 QI 若泛化不足，等價類會細到幾乎
每列自成一組，k-匿名只能整批抑制，量到的耗時也就失去意義。以 20 萬筆樣本量測：
年齡以 rounding 10 分箱、生日僅泛化到「月」時抑制率為 88.98%，泛化到「年」
（層級 3）抑制率為 0，故本設定檔採後者。
注意數值型 QI 不吃 `qi_generalization_levels`，其切法一律寫在
`generalization_hierarchies`（rounding 或 bins）；層級只對日期型的粒度階梯有意義。
類別型 QI 需搭配階層矩陣才可泛化，故維持層級 0。

用法（於專案根目錄執行）：
    python -m benchmarks.kanon                   # 使用 scratch/test_data_5000k.csv
    python -m benchmarks.kanon <資料集路徑>       # 指定其他資料集（小資料可用於驗證流程）
"""
import json
import os
import sys
from pathlib import Path

import pandas as pd

from app.core.config import parse_bundled_config
from app.core.dataset_io import export_result
from app.core.defaults import resolve_kanon_defaults
from app.core.settings import get_default_salt
from app.engines.anonymization import run_k_anonymity
from app.engines.risk import run_attacks, run_cap
from app.governance.report import generate_pdf_report
from benchmarks.utils import SCRATCH_DIR, StageRecorder, describe_environment

DEFAULT_DATASET = str(SCRATCH_DIR / "test_data_5000k.csv")
CONFIG_PATH = str(Path(__file__).resolve().parent / "config_kanon_5m.json")


def benchmark_full(file_path: str = DEFAULT_DATASET):
    if not os.path.exists(file_path):
        print(f"[!] 找不到資料集: {file_path}")
        return

    # 鹽值只讀部署環境的 .env；未設定時不加鹽，照常執行（同 CLI／API）
    salt_key = get_default_salt()

    # 一份大包設定檔同時描述「怎麼去識別」與「用哪些欄位評風險」，與 CLI 的
    # risk-k-anonymity 走同一個端點解析，壓測因此驗到的是整合方實際會用的那條路。
    cfgs = parse_bundled_config(CONFIG_PATH, "risk_k_anonymity")
    config = cfgs.kanon
    rc = cfgs.risk
    qi_cols = rc.qi_columns()
    s_cols = rc.sensitive_columns()

    # 未填的抑制旋鈕由邊界層決議預設值，與 CLI／API 共用同一份（app.core.defaults）
    d = resolve_kanon_defaults(
        config.k,
        config.suppression_limit_percent,
        config.limit_exceeded_action,
        config.suppression_method,
        config.cell_fill,
    )
    deid_params = {
        "k": d.k,
        "l": config.l,
        "t": config.t,
        "suppression_limit_percent": d.suppression_limit_percent,
        "limit_exceeded_action": d.limit_exceeded_action,
        "salt_key": salt_key,
        "suppression_method": d.suppression_method,
        "cell_fill": d.cell_fill,
    }

    recorder = StageRecorder()
    print(f"[*] K-匿名化壓力測試開始，資料集：{file_path}")

    with recorder.measure("讀取資料集"):
        df = pd.read_csv(file_path)
    print(f"    資料規模：{len(df):,} 筆 × {len(df.columns)} 欄")

    with recorder.measure("K-匿名化處理"):
        df_out, report = run_k_anonymity(df, config, **deid_params)

    # 三攻擊：只吃原始資料與去識別方法／參數，引擎自行切 80/20 並對 train
    # 重跑一次完整 K-匿名產生 syn，故本階段耗時包含一次去識別，與上一階段不可混計。
    with recorder.measure("三攻擊評估（內含引擎自產 syn）"):
        attack_report = run_attacks(
            original_df=df,
            qi_cols=qi_cols,
            sensitive_cols=s_cols,
            method="k-anon",
            deid_config=config,
            deid_params=deid_params,
        )

    with recorder.measure("CAP 前後對比"):
        cap_report = run_cap(df, df_out, qi_cols, s_cols)

    with recorder.measure("輸出去識別化結果 CSV"):
        out_csv = export_result(df_out, str(SCRATCH_DIR / "anonymized_result.csv"))
    print(f"    去識別化資料已輸出至: {out_csv}")

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
        "deid_params": {k: v for k, v in deid_params.items() if k != "salt_key"},
        "performance": perf,
        "suppression_rate_percent": report.suppression_rate_percent,
        "suppression_unit": report.suppression_unit,
        "suppressed_count": report.suppressed_count,
        "suppression_total_count": report.suppression_total_count,
        "k_passed": report.k_passed,
        "l_passed": report.l_passed,
        "t_passed": report.t_passed,
        "attack_report": attack_report.to_dict(),
        "cap_report": cap_report.to_dict(),
    }
    results_path = SCRATCH_DIR / "last_test_results.json"
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    pdf_path = generate_pdf_report(
        task_id="PERF_5M_K_ANONYMITY",
        attack_report=attack_report.to_dict(),
        cap_report=cap_report.to_dict(),
        out_path=str(SCRATCH_DIR / "performance_report.pdf"),
    )

    print(
        f"[OK] 全部階段合計 {perf['total_seconds'] / 60:.2f} 分鐘，"
        f"整體記憶體峰值 {perf['peak_rss_mb']:.1f} MB。"
    )
    print(f"[OK] 量測數據：{results_path}；風險報告 PDF：{pdf_path}")


if __name__ == "__main__":
    benchmark_full(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DATASET)
