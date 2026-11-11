"""再識別風險量化公式（單一真相來源，三攻擊共用）。"""


def risk_score(s_ori: float, s_ctrl: float, s_base: float) -> float:
    """規格的風險量化公式（單一真相來源，三攻擊共用）。

    最終風險 = max(0, (S_ori − max(S_ctrl, S_base)) / (1 − max(S_ctrl, S_base)))
    ＝主要攻擊「超出」控制組與瞎猜的那一截，標準化到 0~1。
    """
    baseline = max(s_ctrl, s_base)
    return max(0.0, (s_ori - baseline) / (1.0 - baseline + 1e-9))
