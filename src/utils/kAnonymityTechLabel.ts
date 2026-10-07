/**
 * K-匿名化「欄位處置與技術對照表」：間接識別欄位（Quasi-identifier）實際套用之泛化技術。
 *
 * ★ 2026-10-05 修正：Step4 合規報告與稽核憑證原本把所有間接識別欄位一律標為「區間/時間泛化」，
 *   不論 Step2 實際選的策略（例如字串型「婚姻」選「字串前後綴、保留前 3 字」，報告卻寫區間/時間泛化）。
 *   改為依欄位型態＋泛化策略（＋前後綴方向）顯示實際技術；參數未設定完整、實際不會送後端處理的欄位
 *   （判斷與 Step4 isColumnActuallyDeidentifiedFn 一致）顯示「保留原文（泛化未設定完整）」。
 *
 * 稽核紀錄存「技術代碼」而非顯示文字，讓切換語系後歷史憑證仍可正確翻譯。
 */

export type KAnonymityGeneralizationTechKey =
    | 'custom_bins'
    | 'rounding'
    | 'time_rounding'
    | 'time_range'
    | 'tree'
    | 'keep_prefix'
    | 'keep_suffix'
    | 'length'
    | 'none';

interface GeneralizationFieldLike {
    type?: unknown;
    genStrategy?: unknown;
    genDirection?: unknown;
}

/** 依欄位設定判斷技術代碼；isActuallyApplied 為 false（參數不完整，後端不會處理）時回傳 'none' */
export const resolveKAnonymityGeneralizationTechKey = (
    field: GeneralizationFieldLike | undefined,
    isActuallyApplied: boolean
): KAnonymityGeneralizationTechKey => {
    if (!field || !isActuallyApplied) return 'none';
    const fieldType = String(field.type ?? 'string');
    const genStrategy = String(field.genStrategy ?? '');

    if (fieldType === 'numeric') {
        if (genStrategy === 'custom_bins' || genStrategy === 'rounding') return genStrategy;
        return 'none';
    }
    if (fieldType === 'temporal') {
        if (genStrategy === 'time_rounding' || genStrategy === 'time_range') return genStrategy;
        return 'none';
    }
    if (fieldType === 'categorical') {
        return genStrategy === 'tree' ? 'tree' : 'none';
    }
    if (fieldType === 'string') {
        if (genStrategy === 'prefix') return field.genDirection === 'back' ? 'keep_suffix' : 'keep_prefix';
        if (genStrategy === 'length') return 'length';
        return 'none';
    }
    return 'none';
};

const TECH_LABEL_DEFAULTS: Record<KAnonymityGeneralizationTechKey, string> = {
    custom_bins: '自訂數值區間泛化',
    rounding: '數值捨入泛化',
    time_rounding: '時間粒度泛化',
    time_range: '時間區間泛化',
    tree: '階層樹泛化',
    keep_prefix: '字串保留前綴（其餘遮蔽）',
    keep_suffix: '字串保留後綴（其餘遮蔽）',
    length: '字串長度泛化',
    none: '保留原文（泛化未設定完整）',
};

type TranslateLike = (key: string, defaultValue: string) => string;

/**
 * 技術代碼 → 顯示文字。techKey 為 undefined（本修正前簽發的舊憑證沒有此快照）時，
 * 退回舊版通用文字「區間/時間泛化」，不改動舊憑證原本的顯示內容。
 */
export const getKAnonymityGeneralizationTechLabel = (
    techKey: string | undefined,
    translate: TranslateLike
): string => {
    if (techKey && techKey in TECH_LABEL_DEFAULTS) {
        const knownKey = techKey as KAnonymityGeneralizationTechKey;
        return translate(`step4.report.tech_gen_${knownKey}`, TECH_LABEL_DEFAULTS[knownKey]);
    }
    return translate('step4.report.tech_generalization', '區間/時間泛化');
};
