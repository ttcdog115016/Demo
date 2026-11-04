/**
 * ============================================================================
 * 檔案名稱 (File): riskLevel.ts
 * 模組功能 (Description): 把風險數值（0~1）判定為「通過／不通過」，供 Step4 畫面、合規報告與處理紀錄共用。
 * ============================================================================
 * ★ 2026-10-06 QA 回饋：CAP、三攻擊只有百分比，使用者看不出高低，改以等級圖示呈現。
 * ★ 2026-11-04：原本 L1／L2／L3 三級（門檻 5%／20% 為前端自訂、無出處）改為依 Anonymeter 與 PETsARD
 *   「保護力參數設定—風險分數解讀」判定「通過／不通過」：
 *   - 三項風險（指認性、連結性、推論性）皆為 Anonymeter 的「超額風險」：主要攻擊成功率扣除基線（隨機猜測）後標準化為 0~1，
 *     後端 app/engines/risk/formula.py 同此算法（Giomi et al., 2023, PoPETs 2023(2)）。
 *   - 門檻 risk < 0.09：PETsARD 參考新加坡 PDPC《Guide on Synthetic Data Generation》（2023），三種攻擊皆適用。
 *   - 已評估的每一項都 < 0.09 才通過，任一項 ≥ 0.09 即不通過；未評估者不列入。
 *     「能否猜出敏感資料」沿用推論性攻擊與扣除亂猜基線後 CAP 的較高者（較保守，見 complianceReport.ts）。
 *   門檻要調整只改 RISK_PASS_THRESHOLD，畫面與報告會一起變。
 */

/** 1＝通過、2＝不通過 */
export type RiskLevelNumber = 1 | 2;

export interface RiskLevelInfo {
    level: RiskLevelNumber;
    /** 代號（測試、data-testid 用），PASS／FAIL */
    code: string;
    /** 顯示文字：通過／不通過 */
    labelText: string;
    /** 主色（文字、圖示、長條） */
    color: string;
    /** 淺底色（徽章背景，PDF 白底也看得清楚） */
    backgroundColor: string;
}

/** 通過門檻（比例）：各項風險 < 此值為通過 */
export const RISK_PASS_THRESHOLD = 0.09;

const RISK_LEVEL_TABLE: Record<RiskLevelNumber, Omit<RiskLevelInfo, 'level'>> = {
    1: { code: 'PASS', labelText: '通過', color: '#16a34a', backgroundColor: '#dcfce7' },
    2: { code: 'FAIL', labelText: '不通過', color: '#dc2626', backgroundColor: '#fee2e2' },
};

/** 風險值（0~1）→ 通過／不通過；非有限數值或負數（後端 -1 表示未評估）回傳 null */
export const classifyRiskLevel = (riskRatio: number | null | undefined): RiskLevelInfo | null => {
    if (typeof riskRatio !== 'number' || !Number.isFinite(riskRatio) || riskRatio < 0) return null;
    const level: RiskLevelNumber = riskRatio < RISK_PASS_THRESHOLD ? 1 : 2;
    return { level, ...RISK_LEVEL_TABLE[level] };
};

export const getRiskLevelInfo = (level: RiskLevelNumber): RiskLevelInfo => ({ level, ...RISK_LEVEL_TABLE[level] });

/** 門檻百分比文字，例如「9%」 */
export const formatRiskPassThreshold = (): string => `${Math.round(RISK_PASS_THRESHOLD * 1000) / 10}%`;

/** 判定說明文字，例如「通過：各項風險皆 < 9%｜不通過：任一項 ≥ 9%」 */
export const describeRiskLevelScale = (): string => {
    const thresholdPct = formatRiskPassThreshold();
    return `通過：各項風險皆 < ${thresholdPct}｜不通過：任一項 ≥ ${thresholdPct}`;
};

export interface RiskMetricItem {
    /** 指標名稱，例如「CAP 處理後」 */
    label: string;
    /** 風險值（0~1）；未評估傳 null 或負數 */
    value: number | null | undefined;
}

export interface OverallRiskSummary {
    info: RiskLevelInfo;
    /** 決定整體結果的那一項（數值最高者） */
    driver: { label: string; value: number };
}

/**
 * ★ 2026-10-06 使用者要求：只給一個統一結果，不要每個數字各自判定。
 *   整體結果＝已評估指標中數值最高者的判定：最高者 < 門檻＝全部 < 門檻＝通過；全部未評估回傳 null。
 */
export const computeOverallRiskLevel = (metricItems: RiskMetricItem[]): OverallRiskSummary | null => {
    let driver: { label: string; value: number } | null = null;
    for (const item of metricItems) {
        if (!classifyRiskLevel(item.value)) continue;
        const value = item.value as number;
        if (!driver || value > driver.value) driver = { label: item.label, value };
    }
    if (!driver) return null;
    return { info: classifyRiskLevel(driver.value)!, driver };
};
