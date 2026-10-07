/**
 * ============================================================================
 * 檔案名稱 (File): riskLevel.ts
 * 模組功能 (Description): 把風險數值（0~1）換算成 L1／L2／L3 三級，供 Step4 畫面與合規報告共用。
 * ============================================================================
 * ★ 2026-10-06 QA 回饋：CAP、三攻擊只有百分比，使用者看不出高低，改以等級圖示呈現。
 *   門檻為前端自訂（目前無官方標準），要調整只改 RISK_LEVEL_THRESHOLDS 即可，畫面與報告會一起變。
 */

export type RiskLevelNumber = 1 | 2 | 3;

export interface RiskLevelInfo {
    level: RiskLevelNumber;
    /** 等級代號，例如 L1 */
    code: string;
    /** 中文名稱，例如 低風險 */
    labelText: string;
    /** 主色（文字、圖示、長條） */
    color: string;
    /** 淺底色（徽章背景，PDF 白底也看得清楚） */
    backgroundColor: string;
}

/** 分級門檻（比例）：< low 為 L1；low ~ < high 為 L2；≥ high 為 L3 */
export const RISK_LEVEL_THRESHOLDS = { low: 0.05, high: 0.2 } as const;

const RISK_LEVEL_TABLE: Record<RiskLevelNumber, Omit<RiskLevelInfo, 'level'>> = {
    1: { code: 'L1', labelText: '低風險', color: '#16a34a', backgroundColor: '#dcfce7' },
    2: { code: 'L2', labelText: '中風險', color: '#d97706', backgroundColor: '#fef3c7' },
    3: { code: 'L3', labelText: '高風險', color: '#dc2626', backgroundColor: '#fee2e2' },
};

/** 風險值（0~1）→ 等級；非有限數值或負數（後端 -1 表示未評估）回傳 null */
export const classifyRiskLevel = (riskRatio: number | null | undefined): RiskLevelInfo | null => {
    if (typeof riskRatio !== 'number' || !Number.isFinite(riskRatio) || riskRatio < 0) return null;
    const level: RiskLevelNumber = riskRatio < RISK_LEVEL_THRESHOLDS.low ? 1 : riskRatio < RISK_LEVEL_THRESHOLDS.high ? 2 : 3;
    return { level, ...RISK_LEVEL_TABLE[level] };
};

export const getRiskLevelInfo = (level: RiskLevelNumber): RiskLevelInfo => ({ level, ...RISK_LEVEL_TABLE[level] });

/** 分級說明文字，例如「L1 低風險 < 5%｜L2 中風險 5%～20%｜L3 高風險 ≥ 20%」 */
export const describeRiskLevelScale = (): string => {
    const lowPct = `${RISK_LEVEL_THRESHOLDS.low * 100}%`;
    const highPct = `${RISK_LEVEL_THRESHOLDS.high * 100}%`;
    return `L1 低風險 < ${lowPct}｜L2 中風險 ${lowPct}～${highPct}｜L3 高風險 ≥ ${highPct}`;
};

export interface RiskMetricItem {
    /** 指標名稱，例如「CAP 處理後」 */
    label: string;
    /** 風險值（0~1）；未評估傳 null 或負數 */
    value: number | null | undefined;
}

export interface OverallRiskSummary {
    info: RiskLevelInfo;
    /** 決定整體等級的那一項（數值最高者） */
    driver: { label: string; value: number };
}

/**
 * ★ 2026-10-06 使用者要求：等級只給一個統一結果，不要每個數字各自標等級。
 *   整體等級＝已評估指標（三攻擊＋CAP 處理後）中數值最高者的等級（最保守）；全部未評估回傳 null。
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
