/**
 * 檔案名稱 (File): reportDescriptions.ts
 * 模組功能 (Description): 合規報告用的白話描述——資料預先處理步驟、風險評估對象族群條件。
 * ★ 2026-10-28：合規報告補「資料預先處理」與「風險評估對象」，讓看報告的人知道資料在去識別化前做過哪些清洗、
 *   風險是針對哪些欄位與哪一群人評估的。
 */
import type { PreprocessingRule, MissingValueRule, RiskSubgroupCondition } from '../store/useWorkspaceStore';
import { normalizePreprocessHashAlgorithm } from './preprocessConfig';

const HASH_ALGORITHM_LABELS: Record<string, string> = { 'sha256': 'SHA-256', 'sha3-256': 'SHA3-256', 'sha3-512': 'SHA3-512' };
export const formatHashAlgorithmLabel = (algorithm: unknown): string => HASH_ALGORITHM_LABELS[String(algorithm ?? '').toLowerCase()] ?? String(algorithm ?? '');

const hasValue = (value: unknown): boolean => value !== undefined && value !== null && String(value) !== '';

/** 單一清洗步驟 → 白話描述（與 utils/preprocessConfig.ts 送後端的規則一致；「沒有效果」的步驟回傳 null） */
export const describePreprocessStep = (stepItem: PreprocessingRule): string | null => {
    const params = stepItem.params || {};
    switch (stepItem.action) {
        case 'trim': return params.mode === 'all' ? '去除所有空白' : '去除前後空白';
        case 'slice': {
            const count = Math.floor(Number(params.count) || 0);
            return count >= 1 ? `刪除${params.direction === 'right' ? '結尾' : '開頭'} ${count} 個字` : null;
        }
        case 'anchor_truncate':
            return `以「${String(params.anchor ?? '')}」為界，保留${params.direction === 'back' ? '後方' : '前方'} ${Math.max(0, Math.floor(Number(params.keepCount) || 0))} 字`;
        case 'type_cast':
            return params.targetType === 'boolean' ? '轉為布林' : params.targetType === 'float' ? '轉為浮點數' : '轉為整數（四捨五入）';
        case 'normalize': {
            const parts = [
                params.caseMode === 'upper' ? '英文轉大寫' : params.caseMode === 'lower' ? '英文轉小寫' : '',
                params.widthMode === 'full_to_half' ? '全形轉半形' : ''
            ].filter(Boolean);
            return parts.length > 0 ? parts.join('、') : null;
        }
        case 'clamp': {
            const lower = hasValue(params.min) ? String(params.min) : '';
            const upper = hasValue(params.max) ? String(params.max) : '';
            if (!lower && !upper) return null;
            return `限制範圍 ${lower || '不限'}～${upper || '不限'}`;
        }
        case 'hash': {
            const saltText = params.seedMode === 'fixed' ? '自訂鹽值' : (params.seedMode === 'random' || params.seedMode === 'timestamp') ? '執行時間鹽值' : '伺服器預設鹽值';
            return `雜湊（${formatHashAlgorithmLabel(normalizePreprocessHashAlgorithm(params.algorithm))}，${saltText}）`;
        }
        case 'regex_replace':
            return `正則替換 ${String(params.pattern ?? '')} → ${params.placeholder !== undefined ? `「${String(params.placeholder)}」` : '「***」'}`;
        default:
            return null;
    }
};

/** 缺失值處理 → 白話描述；「不處理」回傳 null */
export const describeMissingValueRule = (missingRule: MissingValueRule | undefined): string | null => {
    if (!missingRule || missingRule.strategy === 'none') return null;
    if (missingRule.strategy === 'drop') return '缺值整列刪除';
    if (missingRule.strategy === 'constant') return `缺值填入「${missingRule.constantValue ?? ''}」`;
    const fillLabels: Record<string, string> = { forward: '前一筆', backward: '後一筆', interpolate: '內插', mean: '平均值' };
    return `缺值依${fillLabels[missingRule.fillMethod ?? 'mean'] ?? '平均值'}填補`;
};

/**
 * 函數名稱: describePreprocessingForReport
 * 函數功能: 依欄位順序列出有資料預先處理的欄位與步驟（與 Step4 送 /api/v1/preprocess 的內容一致：雜湊為最後一步、缺失值處理在最後）。
 */
export const describePreprocessingForReport = (
    columnNames: string[],
    preprocessingRules: Record<string, PreprocessingRule[]> | null | undefined,
    missingValueRules: Record<string, MissingValueRule> | null | undefined
): { columnName: string; stepsText: string }[] => {
    const own = <ValueType,>(sourceMap: Record<string, ValueType> | null | undefined, key: string): ValueType | undefined =>
        sourceMap && Object.prototype.hasOwnProperty.call(sourceMap, key) ? sourceMap[key] : undefined;
    return columnNames.flatMap((columnName) => {
        const stepTexts: string[] = [];
        for (const stepItem of own(preprocessingRules, columnName) || []) {
            const stepText = describePreprocessStep(stepItem);
            if (stepText) stepTexts.push(stepText);
            if (stepItem.action === 'hash') break;
        }
        const missingText = describeMissingValueRule(own(missingValueRules, columnName));
        if (missingText) stepTexts.push(missingText);
        return stepTexts.length > 0 ? [{ columnName, stepsText: stepTexts.join(' → ') }] : [];
    });
};

/** 風險評估對象族群條件 → 白話（每欄一行） */
export const describeRiskSubgroupForReport = (subgroupFilters: Record<string, RiskSubgroupCondition> | null | undefined): string[] =>
    Object.entries(subgroupFilters || {}).flatMap(([columnName, condition]) => {
        if (condition.kind === 'range') {
            const lower = (condition.min ?? '').trim();
            const upper = (condition.max ?? '').trim();
            if (!lower && !upper) return [];
            return [`${columnName}：${lower || '不限'}～${upper || '不限'}`];
        }
        const values = (condition.values || []).map((value) => value.trim()).filter(Boolean);
        return values.length > 0 ? [`${columnName}：${values.join('、')}`] : [];
    });
