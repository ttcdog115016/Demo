/**
 * ============================================================================
 * 檔案名稱 (File): plainResultSummary.ts
 * 模組功能 (Description): Step4 結果的白話化工具：資料可用性分級、「每 100 筆約幾筆」說法、欄位處理方式分類。
 * ============================================================================
 * ★ 2026-10-06 使用者要求：以「沒有相關背景的公務員」能看懂為目標，保護程度與可用性都要有一句結論。
 *   可用性門檻為前端草案（無官方標準），調整只改 UTILITY_LEVEL_THRESHOLDS 即可。
 */

import { FIDELITY_PASS_THRESHOLD, formatFidelityPercent } from './kAnonymityFidelity';
export type UtilityLevelNumber = 1 | 2 | 3;

export interface UtilityLevelInfo {
    level: UtilityLevelNumber;
    /** 高／中／低 */
    labelText: string;
    color: string;
    /** 一句白話結論 */
    verdictText: string;
}

/**
 * 可用性分級門檻（草案，待確認）：
 * - K-匿名（2026-10-14 使用者決定）：只看資料釋出率＝保留筆數 ÷ 原始筆數（實務目標 95% 以上）：
 *   抑制比例 < 5% 高、5%～20% 中、≥ 20% 低（儲存格抑制時以被遮蔽格數比例計）。
 *   失真程度（LM，utils/kAnonymityLossMetric.ts）為前端自算、門檻無依據，同日決定先不顯示也不納入等級；
 *   classifyKAnonymityUtility 的 informationLossRatio 參數保留供日後使用（目前呼叫端不傳）。
 * - 差分隱私：總消耗 ε > 10 雜訊少（高）、1～10 中、≤ 1 雜訊多（低），與 Step3「當前保護強度」三級對應（方向相反）。
 */
// TODO【待後端確認：資料可用性報告】（2026-10-13）目前後端沒有效用指標：K-匿名只有抑制率，差分隱私只有 ε 用量，
//   因此 DP 可用性只能用 ε 合計判斷，可能高估（ε 合計大但每欄分到的 ε 小、敏感度大時偏差仍大）。
//   下一版後端若提供每欄誤差或資訊損失指標，改用後端數值；否則考慮在 Step4 以處理前後資料自行比對。
//   未啟用的逐欄估算見 utils/dpColumnNoise.ts。詳見專案文件「【待後端確認】資料可用性報告」。
export const UTILITY_LEVEL_THRESHOLDS = {
    suppressionRatio: { high: 0.05, low: 0.2 },
    informationLoss: { high: 0.2, low: 0.5 },
    epsilon: { high: 10, low: 1 },
} as const;

const UTILITY_LEVEL_TABLE: Record<UtilityLevelNumber, Omit<UtilityLevelInfo, 'level'>> = {
    1: { labelText: '高', color: '#16a34a', verdictText: '資料筆數大致完整保留，資料效用較佳。' }, // ★ 2026-10-15：原「資料大致完整保留，適合做統計分析」未考慮泛化造成的精細度下降，改為只描述筆數
    2: { labelText: '中', color: '#d97706', verdictText: '有部分資料被刪除、遮蔽、改成區間或加入雜訊，分析結果可能略有偏差。' },
    3: { labelText: '低', color: '#dc2626', verdictText: '大量資料被刪除、遮蔽、改成區間或加入雜訊，分析結果可能不準確。' },
};

export const getUtilityLevelInfo = (level: UtilityLevelNumber): UtilityLevelInfo => ({ level, ...UTILITY_LEVEL_TABLE[level] });

/**
 * K-匿名結論文字（2026-10-15 使用者要求以「資料效用」描述，不寫「統計分析」）：直接寫出分級標準，讓使用者看得出「保留 97.9% 是高、94.0% 是中」的原因（2026-10-15）。
 * 與 UTILITY_LEVEL_THRESHOLDS.suppressionRatio 對應：抑制 < 5%（保留超過 95%）高、5%～20% 中、≥ 20%（保留 80% 以下）低。
 */
const K_ANONYMITY_UTILITY_VERDICT_TEXT: Record<UtilityLevelNumber, string> = {
    1: '資料保留超過 95%，資料效用較佳。',
    2: '資料保留 80%～95%（未達 95%），資料效用可能略受影響。',
    3: '資料保留 80% 以下，資料效用可能明顯降低。',
};

/** K-匿名：抑制比例（0~1，＝1 − 資料釋出率）與失真程度 LM（0~1，可省略）→ 可用性，取兩者較差的一級 */
export const classifyKAnonymityUtility = (suppressionRatio: number | null | undefined, informationLossRatio?: number | null): UtilityLevelInfo | null => {
    if (typeof suppressionRatio !== 'number' || !Number.isFinite(suppressionRatio) || suppressionRatio < 0) return null;
    const { high, low } = UTILITY_LEVEL_THRESHOLDS.suppressionRatio;
    const releaseLevel: UtilityLevelNumber = suppressionRatio < high ? 1 : suppressionRatio < low ? 2 : 3;
    if (typeof informationLossRatio !== 'number' || !Number.isFinite(informationLossRatio) || informationLossRatio < 0) {
        return { ...getUtilityLevelInfo(releaseLevel), verdictText: K_ANONYMITY_UTILITY_VERDICT_TEXT[releaseLevel] };
    }
    const lossThresholds = UTILITY_LEVEL_THRESHOLDS.informationLoss;
    const lossLevel: UtilityLevelNumber = informationLossRatio < lossThresholds.high ? 1 : informationLossRatio < lossThresholds.low ? 2 : 3;
    return getUtilityLevelInfo(Math.max(releaseLevel, lossLevel) as UtilityLevelNumber);
};

/**
 * ★ 2026-10-15：K-匿名資料實用性改依《合成資料技術指引 v1.5》保真度三項指標（見 utils/kAnonymityFidelity.ts）：
 *   三項皆 ≥ 0.75 為「達標」，否則「未達標」（指引只有 0.75 一條建議值，不再分高／中／低，也不再用 95%／80% 保留筆數門檻）。
 *   沿用 UtilityLevelInfo 結構：達標＝level 1（綠）、未達標＝level 3（紅），頂部建議依此判斷。
 */
export const classifyKAnonymityFidelity = (
    fidelity: { isPassed: boolean; columnShapes?: number; columnPairTrends?: number | null; overall?: number } | null | undefined
): UtilityLevelInfo | null => {
    if (!fidelity) return null;
    if (fidelity.isPassed) return { level: 1, labelText: '達標', color: '#16a34a', verdictText: '處理後資料的統計特性與原始資料相近，資料效用良好。' };
    // ★ 2026-10-29：三項須各自達 75%，只看綜合分數會誤以為達標（例：綜合 76%、欄位搭配 69%）——寫出是哪一項沒達到
    const failedItemTexts = [
        typeof fidelity.columnShapes === 'number' && fidelity.columnShapes < FIDELITY_PASS_THRESHOLD ? `欄位分布 ${formatFidelityPercent(fidelity.columnShapes)}` : null,
        typeof fidelity.columnPairTrends === 'number' && fidelity.columnPairTrends < FIDELITY_PASS_THRESHOLD ? `欄位搭配 ${formatFidelityPercent(fidelity.columnPairTrends)}` : null,
        typeof fidelity.overall === 'number' && fidelity.overall < FIDELITY_PASS_THRESHOLD ? `綜合 ${formatFidelityPercent(fidelity.overall)}` : null,
    ].filter((itemText): itemText is string => itemText !== null);
    const isShapesFailed = typeof fidelity.columnShapes === 'number' && fidelity.columnShapes < FIDELITY_PASS_THRESHOLD;
    const isPairsFailed = typeof fidelity.columnPairTrends === 'number' && fidelity.columnPairTrends < FIDELITY_PASS_THRESHOLD;
    const reasonText = isShapesFailed && isPairsFailed ? '部分欄位的分布與欄位之間的關聯都改變較多'
        : isPairsFailed ? '部分欄位之間的關聯（一起出現的組合）改變較多'
        : isShapesFailed ? '部分欄位的值分布改變較多'
        : '部分欄位的分布或欄位之間的關聯改變較多';
    const thresholdText = formatFidelityPercent(FIDELITY_PASS_THRESHOLD);
    return {
        level: 3, labelText: '未達標', color: '#dc2626',
        verdictText: failedItemTexts.length > 0
            ? `${failedItemTexts.join('、')} 低於 ${thresholdText}（三項都須達 ${thresholdText}）：${reasonText}，資料效用可能降低。`
            : `${reasonText}，資料效用可能降低。`,
    };
};

/** 差分隱私：總消耗 ε → 可用性（ε 越大雜訊越少、越好用） */
export const classifyDifferentialPrivacyUtility = (consumedEpsilon: number | null | undefined): UtilityLevelInfo | null => {
    if (typeof consumedEpsilon !== 'number' || !Number.isFinite(consumedEpsilon) || consumedEpsilon <= 0) return null;
    const { high, low } = UTILITY_LEVEL_THRESHOLDS.epsilon;
    return getUtilityLevelInfo(consumedEpsilon > high ? 1 : consumedEpsilon > low ? 2 : 3);
};

/** 差分隱私雜訊多寡的白話 */
export const describeEpsilonNoiseText = (consumedEpsilon: number): string => {
    const { high, low } = UTILITY_LEVEL_THRESHOLDS.epsilon;
    // ★ 2026-10-12：原「雜訊少／中等／多」容易被誤解為「每個欄位的數字只差一點」；實際上 ε 合計會平分給各欄位，
    //   每欄偏差還要看上下限範圍。改為對應 Step3「保護強度」的說法（ε 合計 ≤ 1 高保護、1～10 中保護、> 10 低保護）。
    //   （2026-10-12 再修：右卡不再用「保護」字眼，避免與左卡「保護程度 L1」混淆）
    return consumedEpsilon > high ? '雜訊較少' : consumedEpsilon > low ? '雜訊中等' : '雜訊較多';
};

/** 風險比例（0~1）→「每 100 筆約 N 筆」；未評估回傳 null */
export const formatPer100Text = (ratio: number | null | undefined): string | null => {
    if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0) return null;
    const per100Value = ratio * 100;
    if (per100Value < 1) return '每 100 筆不到 1 筆';
    return `每 100 筆約 ${Math.round(per100Value)} 筆`;
};

/** 欄位處理方式的三大類（給一般使用者看） */
export type ColumnTreatmentBucket = 'kept' | 'blurred' | 'removed';

export interface ColumnTreatmentItem {
    columnName: string;
    bucket: ColumnTreatmentBucket;
    /** 白話說明，例如「改成數值區間」 */
    plainText: string;
    /** 處理後的範例值（呼叫端另外填入），例如「30-39」 */
    exampleText?: string;
}

export const COLUMN_TREATMENT_BUCKET_LABEL: Record<ColumnTreatmentBucket, string> = {
    kept: '保留原值',
    blurred: '去識別化', // ★ 2026-10-13 使用者要求：原「變模糊」不直觀，K-匿名與差分隱私統一稱「去識別化」
    removed: '移除或遮蔽',
};

/** K-匿名泛化技術代碼 → 白話（對應 utils/kAnonymityTechLabel.ts 的代碼） */
const GENERALIZATION_PLAIN_TEXT_MAP: Record<string, string> = {
    custom_bins: '改成數值區間',
    rounding: '數值改成較廣泛的單位',
    time_rounding: '日期改成較廣泛的時間單位（如只留年或月）',
    time_range: '日期改成區間',
    tree: '改成較廣泛的分類',
    keep_prefix: '只保留開頭幾個字',
    keep_suffix: '只保留結尾幾個字',
    length: '只保留字數',
};

/**
 * 判斷單一欄位的處理方式。
 * @param input.role 畫面欄位角色（Identifier／Quasi-identifier／Sensitive／…）
 * @param input.maskStrategy 遮蔽策略（remove／none／舊版 hash 等）
 * @param input.isActuallyDeidentified K-匿名：是否確實會被後端處理
 * @param input.generalizationTechKey K-匿名間接識別欄位的泛化技術代碼
 * @param input.isDpNoised 差分隱私：是否已加噪
 */
export const resolveColumnTreatment = (input: {
    columnName: string;
    privacyMode: string | null | undefined;
    role: string;
    maskStrategy?: string;
    isActuallyDeidentified: boolean;
    generalizationTechKey?: string;
    isDpNoised: boolean;
}): ColumnTreatmentItem => {
    const { columnName } = input;
    // 差分隱私只有「加噪／不加噪」（與合規報告欄位對照表一致）
    if (input.privacyMode === 'differential-privacy') {
        return input.isDpNoised
            ? { columnName, bucket: 'blurred', plainText: '加入雜訊' }
            : { columnName, bucket: 'kept', plainText: '保留原值' };
    }
    if (input.maskStrategy === 'remove') {
        return { columnName, bucket: 'removed', plainText: '已移除' };
    }
    // ★ 2026-10-28：識別欄位與非敏感欄位的「雜湊（假名化）」「清空（保留欄位）」；非敏感欄位另有全遮蔽／部分遮蔽
    if ((input.role === 'Identifier' || input.role === 'Non-sensitive') && input.maskStrategy === 'clear') {
        return { columnName, bucket: 'removed', plainText: '已清空' };
    }
    if ((input.role === 'Identifier' || input.role === 'Non-sensitive') && input.maskStrategy === 'hash') {
        return { columnName, bucket: 'blurred', plainText: '換成代碼（雜湊）' };
    }
    if (input.role === 'Non-sensitive' && input.maskStrategy === 'mask') {
        return { columnName, bucket: 'blurred', plainText: '全部遮蔽' };
    }
    if (input.role === 'Non-sensitive' && input.maskStrategy === 'partial') {
        return { columnName, bucket: 'blurred', plainText: '部分遮蔽' };
    }
    if (input.role === 'Identifier' && input.isActuallyDeidentified) {
        return { columnName, bucket: 'removed', plainText: '已遮蔽' };
    }
    if (input.role === 'Quasi-identifier' && input.isActuallyDeidentified && input.generalizationTechKey && GENERALIZATION_PLAIN_TEXT_MAP[input.generalizationTechKey]) {
        return { columnName, bucket: 'blurred', plainText: GENERALIZATION_PLAIN_TEXT_MAP[input.generalizationTechKey] };
    }
    return { columnName, bucket: 'kept', plainText: '保留原值' };
};

export type ReleaseDecisionTone = 'success' | 'warning' | 'error' | 'info';

export interface ReleaseDecision {
    /** 一句話結論，例如「依本次評估可提供」 */
    headline: string;
    /** 下一步建議 */
    adviceText: string;
    tone: ReleaseDecisionTone;
}

/**
 * ★ 2026-10-06 白話版：把保護程度與可用性合成「這份資料能不能給出去、下一步做什麼」。
 *   riskLevel：1~3（L1~L3），null＝未做風險評估；utilityLevel：1 高、2 中、3 低，null＝無法判斷。
 */
export const resolveReleaseDecision = (input: {
    riskLevel: 1 | 2 | 3 | null;
    utilityLevel: UtilityLevelNumber | null;
    privacyMode: string | null | undefined;
}): ReleaseDecision => {
    const isDp = input.privacyMode === 'differential-privacy';
    const strengthenAdvice = isDp
        ? '可回上一步把隱私預算 ε 調小（雜訊加多一點），再按「重新計算」。'
        : '可回上一步把年齡、地區等欄位分得更粗，或把 K 值調高，再按「重新計算」。';
    // ★ 2026-10-12：差分隱私 ε 很小時，保護程度 L1 但可用性低，使用者以為「保護越強越好」而不知如何取捨；
    //   明確說明 L1 已足夠、可以放寬 ε，並提醒重新計算後確認仍為 L1。
    const relaxAdvice = isDp
        ? '目前保護程度已是 L1 低風險，表示這份資料不需要加這麼多雜訊。如果要拿來做分析，可回上一步改選較寬鬆的保護強度（把隱私預算 ε 調大），資料會更接近原值；重新計算後請確認保護程度仍為 L1。'
        : '如果要拿來做分析，可回上一步把 K 值調低或把欄位分得細一點，再按「重新計算」。';
    if (input.riskLevel === null) {
        return { headline: '處理完成（未做風險評估）', adviceText: '尚未設定敏感欄位，因此無法判斷保護程度。建議回上一步設定敏感欄位後重新計算。', tone: 'info' };
    }
    if (input.riskLevel === 3) {
        return { headline: '不建議提供', adviceText: `被認出或被猜出敏感資料的機會偏高。${strengthenAdvice}`, tone: 'error' };
    }
    if (input.riskLevel === 2) {
        return { headline: '建議調整後再提供', adviceText: `仍有一定的被認出風險。${strengthenAdvice}`, tone: 'warning' };
    }
    if (input.utilityLevel === 3) {
        return { headline: '依本次評估可提供，但資料可能不好用', adviceText: `依本次評估，保護程度已達設定門檻，但刪除、遮蔽或雜訊較多。${relaxAdvice}`, tone: 'warning' };
    }
    if (input.utilityLevel === 2) {
        return { headline: '依本次評估可提供', adviceText: '依本次評估，保護程度已達設定門檻。部分資料已刪除、遮蔽或加入雜訊，分析時請留意。可下載處理後的資料與報告。', tone: 'success' };
    }
    // ★ 2026-10-14：差分隱私不判定可用性（utilityLevel 為 null），結論只講保護程度
    if (input.utilityLevel === null) {
        return { headline: '依本次評估可提供', adviceText: '依本次評估，保護程度已達設定門檻。可下載處理後的資料與報告，報告可作為去識別化處理的紀錄。', tone: 'success' };
    }
    return { headline: '依本次評估可提供', adviceText: '依本次評估，保護程度已達設定門檻，資料也大致完整。可下載處理後的資料與報告，報告可作為去識別化處理的紀錄。', tone: 'success' };
};

/** 從處理後資料找一個範例值（略過空白與抑制符號「*」），給「去識別化」（blurred）的欄位顯示「例：30-39」 */
export const pickExampleValue = (rows: Record<string, unknown>[], columnName: string): string | undefined => {
    for (const row of rows) {
        const cellValue = row[columnName];
        if (cellValue === undefined || cellValue === null) continue;
        const cellText = String(cellValue).trim();
        if (cellText !== '' && cellText !== '*') return cellText.length > 20 ? `${cellText.slice(0, 20)}…` : cellText;
    }
    return undefined;
};
