"""三攻擊評估流程（AttackAssessor）。

規格 §3(1)A：輸入原始資料、去識別方法與該方法的 config，系統自行「切 80/20 →
只對 80%（train）去識別產 syn → 20%（holdout）為 ctrl → 跑三攻擊」。
ctrl 未參與 syn 的產生，為真正的 holdout。
"""
from typing import Any

import numpy as np
import pandas as pd

from app.core.config import DPColumnConfig
from app.core.errors import PetsError
from app.engines.dp import BudgetAccountant
from app.core.cancellation import check_cancelled

from .types import AttackReport, ProcessingConfig
from .validation import RiskInputValidator, check_inference_feasible, check_scalar_params
from .splitter import RepeatedSplitter
from .attacks import SinglingOutAttack, LinkabilityAttack, InferenceAttack
from .deid_bridge import DeidBridge
from .formula import risk_score


class AttackAssessor:
    """三攻擊評估器（無狀態：只吃輸入，不留存）。

    去識別方法與 config 於建構時帶入（比照 qi_cols/sensitive_cols 走建構參數）；
    工人（validator/splitter/各攻擊/bridge）未提供則用預設，讓直接建構也能運作。
    """

    def __init__(
        self,
        qi_cols: list[str],
        sensitive_cols: list[str],
        method: str,
        deid_config: Any,
        deid_params: dict[str, Any] | None = None,
        n_iter: int = 500,
        ctrl_ratio: float = 0.2,
        seed: int = 42,
        n_subset: int = 500,
        link_cols_a: list[str] | None = None,
        link_cols_b: list[str] | None = None,
        n_repeats: int = 1,
        overlap_ratio: float = 0.0,
        *,
        validator=None,
        splitter=None,
        singling_out=None,
        linkability=None,
        inference=None,
        bridge=None,
    ):
        # 純參數前置擋（免資料）：seed 負值使 RNG 拋錯、n_repeats<1 不構成一次評估，
        # 皆無降級語意，於入口 fail fast（反覆分割/處理/評估→平均風險分數）
        check_scalar_params(seed, n_repeats)
        self.qi_cols = qi_cols
        self.sensitive_cols = sensitive_cols
        self.method = method
        self.deid_config = deid_config
        self.deid_params = deid_params or {}
        self.n_iter = n_iter
        self.ctrl_ratio = ctrl_ratio
        self.seed = seed
        self.n_subset = n_subset
        self.link_cols_a = link_cols_a
        self.link_cols_b = link_cols_b
        self.n_repeats = n_repeats
        self.overlap_ratio = overlap_ratio

        self._validator = validator if validator is not None else RiskInputValidator()
        # 單輪與多輪統一走同一顆切分器（n_repeats=1 為多輪的特例，非另一套邏輯）；
        # ctrl_ratio/overlap_ratio 因此在建構當下就驗證（不合理值直接擋，不論輪數）。
        self._splitter = splitter if splitter is not None else RepeatedSplitter(
            ctrl_ratio=ctrl_ratio, overlap_ratio=overlap_ratio, seed=seed
        )
        self._singling_out = singling_out if singling_out is not None else SinglingOutAttack()
        self._linkability = linkability if linkability is not None else LinkabilityAttack()
        self._inference = inference if inference is not None else InferenceAttack()
        self._bridge = bridge if bridge is not None else DeidBridge()

    @staticmethod
    def _require_columns_in_syn(
        syn: pd.DataFrame, qi_cols: list[str], sensitive_cols: list[str]
    ) -> None:
        """去識別後的資料須留有評估要用的欄位，缺欄即中止並指名是哪幾欄。

        與前置欄位比對（`RiskInputValidator`）用同一個錯誤碼，處置方式都是「改設定檔」。
        """
        missing = [c for c in list(qi_cols) + list(sensitive_cols) if c not in syn.columns]
        if missing:
            raise PetsError(
                "ERR_CONFIG_DATA_MISMATCH",
                f"欄位 {sorted(set(missing))} 在去識別化後的資料中已不存在，"
                f"無法用於再識別風險評估。這些欄位在去識別化設定中採用了移除整欄的"
                f"策略；請改用保留欄位的處理方式，或將其自風險設定的欄位清單移除。",
            )

    def _processing_config(self) -> ProcessingConfig:
        """回填本次的處理配置供報告揭露；deid_params 剔除 salt_key（機密不得入報告）。

        列抑制不使用值抑制填法，cell_fill 不列入，以免報告揭露未生效之參數。
        """
        safe_deid = {k: v for k, v in self.deid_params.items() if k != "salt_key"}
        if safe_deid.get("suppression_method") == "row_suppression":
            safe_deid.pop("cell_fill", None)
        if self.method == "dp" and isinstance(self.deid_config, DPColumnConfig):
            # 自產 syn 時實際加噪一次，本次消耗與累計後之值以同一套記帳算出並揭露
            consumed_eps, consumed_del, total_eps, total_del = BudgetAccountant().account(
                self.deid_config,
                default_delta=safe_deid.get("default_delta"),
                accumulated_epsilon=safe_deid.get("accumulated_epsilon") or 0.0,
                accumulated_delta=safe_deid.get("accumulated_delta") or 0.0,
            )
            safe_deid.update(
                consumed_epsilon=consumed_eps,
                consumed_delta=consumed_del,
                total_epsilon=total_eps,
                total_delta=total_del,
            )
        return ProcessingConfig(
            method=self.method,
            deid_params=safe_deid,
            risk_params={
                "n_iter": self.n_iter,
                "ctrl_ratio": self.ctrl_ratio,
                "seed": self.seed,
                "n_subset": self.n_subset,
                "n_repeats": self.n_repeats,
                "overlap_ratio": self.overlap_ratio,
            },
        )

    def run(self, original_df: pd.DataFrame) -> AttackReport:
        qi_cols = self.qi_cols
        sensitive_cols = self.sensitive_cols

        # ── Step 0：降級檢查（QI／敏感欄為空 → 回 -1.0 報告，不拋錯）──────────────
        if len(qi_cols) == 0 or len(sensitive_cols) == 0:
            if len(qi_cols) == 0 and len(sensitive_cols) > 0:
                msg = "警告：配置存在特徵缺陷。您已指定敏感欄位，但準識別符 (QI) 數量為 0，導致模型缺乏評估特徵線索，顯示之 -1.0 僅代表無法評估。請指派至少一個 QI 欄位。"
            elif len(sensitive_cols) == 0 and len(qi_cols) > 0:
                msg = "警告：配置存在特徵缺陷。您已指定準識別符 (QI)，但敏感欄位數量為 0，導致推斷性攻擊缺乏目標答案，顯示之 -1.0 僅代表無法評估。請指派至少一個敏感欄位。"
            else:
                msg = "警告：配置存在嚴重缺陷。設定檔中準識別符與敏感欄位數量皆為 0，無法執行風險評估任務，顯示之 -1.0 僅代表無法評估。"
            return self._degraded_report(original_df, msg)

        # ── Step 1：前置驗證（欄位存在於原始資料；缺欄 fail fast）─────────────────
        # 此時只有原始資料；syn 由原始資料產生、欄名不變（泛化只改值不改欄名），
        # 故以原始資料驗證即足夠。驗證器簽名為 (原始, 處理後)，此處兩者皆傳原始資料。
        self._validator.validate(
            original_df,
            original_df,
            qi_cols,
            sensitive_cols,
            link_cols_a=self.link_cols_a,
            link_cols_b=self.link_cols_b,
        )

        # ── Step 2：請求級單一亂數源（同輸入同 seed 必同分數，橫跨所有輪次不重設）──
        rng = np.random.default_rng(self.seed)

        # ── Step 3：切 train/holdout（n_repeats=1 是多輪切分器跑 1 輪的
        #    特例，與 n_repeats>1 同一套邏輯，不是兩條分岔的路徑）──────────────
        eval_ori = original_df
        sample_size = len(eval_ori)
        round_pairs = self._splitter.splits(eval_ori, n_repeats=self.n_repeats)

        has_custom_ab = bool(self.link_cols_a) and bool(self.link_cols_b)
        run_linkability = has_custom_ab or len(qi_cols) >= 2
        s_col = sensitive_cols[0]

        # ── Step 4：逐輪「產 syn → 三攻擊」，全部輪次跑完才平均（禁止邊跑邊丟）───
        so_scores = []
        link_scores = []
        inf_scores = []
        link_evaluated_list = []
        inf_block_note = ""
        for ori, ctrl in round_pairs:
            check_cancelled()  # ★ TTC 2026-10-31：每輪、每個攻擊之間可取消
            syn = self._bridge.produce_syn(
                self.method, ori, self.deid_config, self.deid_params
            )
            # syn 是引擎現產的，欄位可能因去識別設定採「移除整欄」而少於原始資料；
            # Step 1 當時只有原始資料可驗，驗不到這件事，此處是最早能發現的時機。
            # 不擋就會在攻擊工人取值時撞 KeyError，外顯成無從判讀的內部錯誤。
            self._require_columns_in_syn(syn, qi_cols, sensitive_cols)

            s_ori, s_ctrl, s_base = self._singling_out.run(
                syn, ori, ctrl, qi_cols, n_iter=self.n_iter, rng=rng
            )
            so_scores.append(risk_score(s_ori, s_ctrl, s_base))

            check_cancelled()
            if run_linkability:
                sl_ori, sl_ctrl, sl_base, n_evaluated = self._linkability.run(
                    syn,
                    ori,
                    ctrl,
                    qi_cols,
                    # 傳原始 n；夾範圍（不超過 ori/ctrl/syn 實際筆數）交由攻擊內部統一負責
                    n_subset=self.n_subset,
                    rng=rng,
                    cols_A=self.link_cols_a,
                    cols_B=self.link_cols_b,
                )
                link_scores.append(risk_score(sl_ori, sl_ctrl, sl_base))
                link_evaluated_list.append(n_evaluated)

            # 推斷性以敏感欄為分類目標，目標欄位須是可列舉的類別；相異值數量接近筆數
            # 的欄位（未分組的連續數值、時間戳記、識別碼）評不出東西來，此處於呼叫前
            # 判定，不可執行就整項降級，連 fit() 都不進。指認性／連結性不受影響。
            check_cancelled()
            if not inf_block_note:
                inf_block_note = check_inference_feasible(syn, s_col) or ""
            if not inf_block_note:
                sinf_ori, sinf_ctrl, sinf_base = self._inference.run(
                    syn, ori, ctrl, qi_cols, s_col, rng=rng
                )
                inf_scores.append(risk_score(sinf_ori, sinf_ctrl, sinf_base))

        risk_so = sum(so_scores) / len(so_scores)
        # 任一輪判定不可執行，整項即不成立——已收集到的輪次不足以代表整次評估
        risk_inf = -1.0 if inf_block_note else sum(inf_scores) / len(inf_scores)

        link_note = ""
        if run_linkability:
            risk_link = sum(link_scores) / len(link_scores)
            link_evaluated = round(sum(link_evaluated_list) / len(link_evaluated_list))
            # 如實揭露：要求的 n_subset 受資料量所限，實際評估筆數可能較少（多輪取平均）
            if self.n_subset >= 1 and link_evaluated < self.n_subset:
                qualifier = "平均" if self.n_repeats > 1 else ""
                link_note = (
                    f" 連結性：要求評估 {self.n_subset} 筆，"
                    f"受資料量限制{qualifier}實際評估 {link_evaluated} 筆。"
                )
        else:
            risk_link = 0.0
            link_evaluated = 0
            link_note = " 連結性未執行（QI 不足 2 個且未自訂 A／B），其 0 僅代表未評估。"

        round_note = ""
        if self.n_repeats > 1:
            round_note = (
                f" 本次執行 {self.n_repeats} 輪重複實驗（重疊比例 {self.overlap_ratio}），"
                f"三指標為跨輪平均風險分數。"
            )

        # ── Step 5：產出報告（三指標平行；不含 CAP）──────────────────────────────
        msg = (
            f"三攻擊風險評估完成。"
            f"指認性風險: {risk_so:.2f}, 連結性風險: {risk_link:.2f}, 推斷性風險: {risk_inf:.2f}。"
            + round_note
            + link_note
            + inf_block_note
        )
        return AttackReport(
            singling_out_risk=round(risk_so, 4),
            linkability_risk=round(risk_link, 4),
            inference_risk=round(risk_inf, 4),
            sample_size=sample_size,
            linkability_evaluated=link_evaluated,
            n_repeats=self.n_repeats,
            overlap_ratio=self.overlap_ratio,
            processing_config=self._processing_config(),
            message=msg,
        )

    def _degraded_report(self, original_df: pd.DataFrame, msg: str) -> AttackReport:
        """降級收據：無法評估時三指標回 -1.0（僅代表無法評估，非風險值）。"""
        return AttackReport(
            singling_out_risk=-1.0,
            linkability_risk=-1.0,
            inference_risk=-1.0,
            sample_size=len(original_df),
            n_repeats=self.n_repeats,
            overlap_ratio=self.overlap_ratio,
            processing_config=self._processing_config(),
            message=msg,
        )
