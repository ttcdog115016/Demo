"""前置驗證（RiskInputValidator）。

比照 K-匿名 ConfigValidator／DP BudgetValidator：資料層對不上就擋（fail fast）。
此處只驗「需比對資料」的項目——QI／敏感欄位必須同時存在於原始與處理後資料，
缺欄直接擋，避免攻擊流程深處拋不可讀的 KeyError。

QI／敏感清單「為空」不在此擋：該情境回降級收據（-1.0＋警告訊息），行為留在 pipeline。
設定檔多出的 identifier／non_sensitive 欄位，與資料多出的未定義欄位，皆屬合法
（角色萃取時本就不選、未指定角色＝不參與評估）。

推斷性攻擊的目標欄位另有可行性前置（check_inference_feasible）：相異值數量接近資料
筆數的欄位不具評估意義，該項回降級收據而非拋錯，故亦不在 RiskInputValidator 內。
"""

import pandas as pd

from app.core.errors import PetsError

# ── 推斷性攻擊目標欄位的可行性判準 ────────────────────────────────────────────
# 森林規模常數必須與 attacks/inference.py 的
# RandomForestClassifier(n_estimators=50, max_depth=10, n_jobs=-1) 同步；
# 那裡改參數，這裡要跟著改，否則估算值與實際建出來的模型對不上。
_MAX_NODES = 2047  # 2**11-1＝max_depth=10 的滿樹節點數上界（實測 4M 筆最大 1893）
_N_TREES = 50  # ＝n_estimators
_BYTES_PER_CELL = 8  # 每節點每類別存一格 float64
_MARGIN = 1.3  # 估算值的安全邊際（業界慣例：limit＝峰值×1.3）
_CLASS_RATIO = 0.5  # 相異值佔筆數的上限比例（同 sklearn 對分類目標欄位的判準）
_MIN_SAMPLES_FOR_RATIO = 20  # 比例判準的最小樣本數（樣本太少時比例無意義，同 sklearn）


def check_scalar_params(seed: int | None = None, n_repeats: int | None = None) -> None:
    """純參數前置檢查（免資料）：擋「沒有合理降級語意」的 seed 負值與 n_repeats 非正整數。

    n_iter／n_subset 的退化值不在此擋：它們有可解讀的降級結果（攻擊回 0）；
    ctrl_ratio 由 RepeatedSplitter 建構時檢查。seed 則無降級語意，且 np.random.default_rng 對負值直接 ValueError，故前置擋、給清楚訊息。
    n_repeats（重複實驗輪數）同理無降級語意可言（0 輪或負輪不構成一次評估），
    且 RepeatedSplitter.splits() 本就會擋，前置到此處只是讓錯誤在建構當下就出現。
    """
    if seed is not None and seed < 0:
        raise PetsError(
            "ERR_INVALID_PARAM",
            f"seed 須為非負整數（供結果可重現），收到 {seed}。",
        )
    if n_repeats is not None and n_repeats < 1:
        raise PetsError(
            "ERR_INVALID_PARAM",
            f"n_repeats 須為正整數（重複實驗輪數），收到 {n_repeats}。",
        )


def _read_cgroup_bytes(path: str) -> int | None:
    """讀 cgroup 的位元組數檔；讀不到或值代表「無限制」皆回 None（交給下一層來源）。"""
    try:
        with open(path, encoding="utf-8") as handle:
            raw = handle.read().strip()
    except OSError:
        return None
    if raw == "max":  # cgroup v2 表示無限制的寫法
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    # cgroup v1 的無限制是一個貼著 int64 上限的哨兵值，不是真的有這麼多可用
    return None if value >= 2**62 else value


def available_memory_bytes() -> int | None:
    """本次執行環境目前可用的量；三層來源皆取不到回 None（＝不套用估算判準）。

    容器內要看 cgroup 而非整台機器：先 v2、再 v1，兩者都取不到（未容器化或非
    Linux）才退回 psutil 的行程視角。取不到時不套用此判準，不做假設。

    psutil 是選用相依（pyproject 的 scripts 群組），交付映像檔以 --no-default-groups
    建置並不含它，故在函式內載入而非模組層：容器內本就走 cgroup 取值，缺了不影響判準，
    且不因此把選用相依變成核心相依。
    """
    for limit_path, usage_path in (
        ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current"),
        (
            "/sys/fs/cgroup/memory/memory.limit_in_bytes",
            "/sys/fs/cgroup/memory/memory.usage_in_bytes",
        ),
    ):
        limit = _read_cgroup_bytes(limit_path)
        usage = _read_cgroup_bytes(usage_path)
        if limit is not None and usage is not None:
            return max(limit - usage, 0)
    try:
        import psutil
    except ImportError:
        return None
    return int(psutil.virtual_memory().available)


def estimate_forest_bytes(n_classes: int) -> int:
    """估算森林的類別機率表規模：每棵樹每節點對每個類別各存一格。

    節點數取 max_depth 的滿樹上界（非隨樣本數成長的實際值），估算才不會低估。
    """
    return n_classes * _MAX_NODES * _N_TREES * _BYTES_PER_CELL


def check_inference_feasible(df: pd.DataFrame, sensitive_col: str) -> str | None:
    """推斷性攻擊能否以此欄位為目標；可執行回 None，否則回要寫進報告的說明句。

    兩層判準都只看資料本身與本次執行環境，不綁特定規格：
      第一層 相異值數量超過筆數之半 → 該欄不構成可列舉的分類目標（判準同 sklearn
              對分類目標欄位的認定），即使跑得完，「完全相等」的命中率亦不具評估意義。
      第二層 依相異值數量估算的模型規模超出本次執行環境可支援的評估規模 → 不執行。
    宣告的 type 不參與判斷：三攻擊一律以實際資料判定，相異值數量才是事實。
    """
    n_classes = int(df[sensitive_col].nunique())
    n_samples = len(df)

    if n_samples > _MIN_SAMPLES_FOR_RATIO and n_classes > round(_CLASS_RATIO * n_samples):
        return (
            f" 推斷性未執行：欄位 '{sensitive_col}' 之相異值數量（{n_classes:,}）"
            f"超過資料筆數（{n_samples:,}）之半數，不符合分類模型對目標欄位之要求，"
            f"所得結果不具評估意義，其 -1.0 僅代表無法評估。"
            f"連續數值欄位先分組為級距後，再以級距欄位宣告為 sensitive。"
        )

    available = available_memory_bytes()
    if available is not None and estimate_forest_bytes(n_classes) * _MARGIN > available:
        return (
            f" 推斷性未執行：欄位 '{sensitive_col}' 之相異值數量（{n_classes:,}）"
            f"超出本次執行環境可支援之評估規模，其 -1.0 僅代表無法評估。"
            f"連續數值欄位先分組為級距後，再以級距欄位宣告為 sensitive。"
        )
    return None


class RiskInputValidator:
    """檢查評估所需欄位存在於前後兩份資料，並擋角色重疊與自訂 A/B 的畸形輸入。"""

    def validate(
        self,
        original_df: pd.DataFrame,
        processed_df: pd.DataFrame,
        qi_cols: list[str],
        sensitive_cols: list[str],
        link_cols_a: list[str] | None = None,
        link_cols_b: list[str] | None = None,
    ) -> None:
        # QI 與 sensitive 不可重疊。config 路徑因一欄一角色不會觸發；此處防的是
        # 直接呼叫引擎、自行傳入重疊清單者（推斷性會變成拿欄位預測它自己）。
        overlap = set(qi_cols) & set(sensitive_cols)
        if overlap:
            raise PetsError(
                "ERR_RISK_ROLE_OVERLAP",
                f"欄位 {sorted(overlap)} 同時被列為 QI 與 sensitive，兩者不可重疊。",
            )

        for col in list(qi_cols) + list(sensitive_cols):
            if col not in original_df.columns:
                raise PetsError(
                    "ERR_CONFIG_DATA_MISMATCH",
                    f"設定檔引用了原始資料中不存在的欄位 '{col}'，請檢查欄位名稱。",
                )
            if col not in processed_df.columns:
                raise PetsError(
                    "ERR_CONFIG_DATA_MISMATCH",
                    f"設定檔引用了處理後資料中不存在的欄位 '{col}'，請檢查欄位名稱。",
                )

        # 自訂連結性 A/B（給了才驗）：須成對、各非空、互斥、且存在於前後資料。
        if link_cols_a is not None or link_cols_b is not None:
            if not link_cols_a or not link_cols_b:
                raise PetsError(
                    "ERR_LINK_AB_INCOMPLETE",
                    "自訂連結性 A／B 欄位須成對提供，且各至少一欄。",
                )
            ab_overlap = set(link_cols_a) & set(link_cols_b)
            if ab_overlap:
                raise PetsError(
                    "ERR_LINK_AB_OVERLAP",
                    f"連結性 A、B 欄位不可重疊（{sorted(ab_overlap)}）；"
                    f"垂直切割要求一欄只能在一邊。",
                )
            for col in list(link_cols_a) + list(link_cols_b):
                if col not in original_df.columns or col not in processed_df.columns:
                    raise PetsError(
                        "ERR_CONFIG_DATA_MISMATCH",
                        f"自訂連結性欄位 '{col}' 不存在於前後資料，請檢查欄位名稱。",
                    )
