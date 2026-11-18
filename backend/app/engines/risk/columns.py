"""三攻擊實際用到的欄位：讀檔時只讀這些，省下大資料沒用到的欄位所佔的記憶體。

三攻擊只用風險角色宣告的準識別／敏感欄位（加上連結性 A／B 與子群體條件的欄位）；
但自產 syn 時，去識別設定也要求它宣告的欄位存在於資料中：
  - K-匿名：block 內的欄位。role 為 identifier 的欄位（編號、車牌、證號…）只會被雜湊或移除，
    不參與任何攻擊，是大資料最大的浪費（雜湊後每格 64 字元），故可以不讀、並從設定中去掉；
  - 差分隱私：column_budgets 的欄位全部要留——預算會算進報告的 ε，不能因為欄位不是風險角色就裁掉。

讀檔與設定須成對處理：只裁資料、不裁設定，驗證器會因「設定宣告了資料裡沒有的欄位」而報錯。
"""
from typing import Any

import pandas as pd

from app.core.config import ColumnConfig, DPColumnConfig, RiskConfig
from app.core.dataset_io import OMITTED_COLUMNS_ATTR


def required_attack_columns(rc: RiskConfig, deid_cfg: Any) -> set[str]:
    """三攻擊需要讀進來的欄位集合（見模組說明）。

    deid_cfg：自產 syn 用的去識別設定（K-匿名 ColumnConfig 或 DP DPColumnConfig）。
    """
    needed: set[str] = set(rc.columns)  # 風險角色只有準識別與敏感兩種
    link_a, link_b = rc.linkability_pair()
    needed.update(link_a or [])
    needed.update(link_b or [])
    needed.update(rc.subgroup_conditions() or {})
    if isinstance(deid_cfg, ColumnConfig):
        needed.update(
            name for name, info in deid_cfg.columns.items() if info.role != "identifier"
        )
    elif isinstance(deid_cfg, DPColumnConfig):
        needed.update(deid_cfg.column_budgets)
    return needed


def drop_omitted_identifiers(deid_cfg: Any, df: pd.DataFrame) -> Any:
    """K-匿名設定去掉「檔案裡有、但讀檔時刻意沒讀」的 identifier 欄位。

    只去掉讀檔時被省略的欄位（df.attrs 有記錄）；檔案裡根本沒有的欄位照舊留著，
    由驗證器報原本的錯誤——設定與資料對不上不會因為省欄位而被悄悄放過。
    非 K-匿名設定、或沒有省略任何欄位時原樣回傳。
    """
    omitted = set(df.attrs.get(OMITTED_COLUMNS_ATTR, ()))
    if not omitted or not isinstance(deid_cfg, ColumnConfig):
        return deid_cfg
    drop = {
        name
        for name, info in deid_cfg.columns.items()
        if info.role == "identifier" and name in omitted
    }
    if not drop:
        return deid_cfg
    kept = {name: info for name, info in deid_cfg.columns.items() if name not in drop}
    return deid_cfg.model_copy(update={"columns": kept})
