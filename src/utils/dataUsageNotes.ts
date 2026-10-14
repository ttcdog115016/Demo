/**
 * ============================================================================
 * 檔案名稱 (File): dataUsageNotes.ts
 * 模組功能 (Description): Step4 下載處理後資料時附上的「資料使用注意事項」（給資料使用方）。
 * ============================================================================
 * ★ 2026-10-08 諮詢會（郭博鈞執行長）：一般使用單位取得處理後資料，可能用了不適用的統計操作而作出錯誤解讀，
 *   例如經差分隱私處理後統計「年齡最大的 10%」，已非實際的那 10%；複雜統計方法更可能產生偏差。
 *   下載時先顯示注意事項，並可一併下載成文字檔，隨資料交給使用方。
 */

export type DataUsageNotesMode = 'k-anonymity' | 'differential-privacy';

export interface DataUsageNotesContext
{
    mode: DataUsageNotesMode;
    /** 原始檔名（選填，寫入文字檔表頭） */
    sourceFileName?: string | null;
    /** K-匿名：K 值 */
    kValue?: number | null;
    /** 差分隱私：實際消耗 ε */
    consumedEpsilon?: number | string | null;
    /** 產出時間（預設為現在） */
    generatedAt?: Date;
}

/** 兩種模式共通的注意事項 */
export const COMMON_DATA_USAGE_NOTES: readonly string[] = [
    '本資料已經過去識別化處理，部分欄位已被泛化、遮蔽或加入雜訊，與原始資料不同。',
    '請勿嘗試以其他資料比對、還原或推測特定個人。',
    '本資料適合用於群體層級的統計分析，不宜用於針對個人的判斷或決策。',
];

/** K-匿名專屬注意事項 */
export const K_ANONYMITY_DATA_USAGE_NOTES: readonly string[] = [
    '年齡、地區、日期等欄位可能已改為區間或較粗的類別（例如「30-39」），計算平均數、中位數時只能以區間估算，結果為近似值；也請勿把區間再推估回單一數值。',
    '湊不滿同一群人數的資料可能已被刪除或遮蔽（顯示為 *），統計總數可能少於原始資料；人數少的群體（例如少數族群、偏遠地區）受影響最大，比例可能失真。',
];

/** 差分隱私專屬注意事項 */
export const DIFFERENTIAL_PRIVACY_DATA_USAGE_NOTES: readonly string[] = [
    '數值已加入隨機雜訊，單一筆資料的數值不是真實值；只有彙總大量資料（例如平均數、總數）時，雜訊才會互相抵銷，結果才較可靠。',
    '最大值、最小值、排名、百分位數（例如「年齡最大的 10%」）受雜訊影響最大，算出來的已不是實際的那一群人，請勿據此作成決策。',
    '分組後筆數很少的群組，統計誤差相對很大，建議合併分組後再解讀。',
    '超出設定上下限的原始數值，可能已被拉回到上下限，極端值會被低估。',
    '迴歸、相關係數等較複雜的統計方法可能產生偏差，使用前建議先與資料提供單位確認。',
];

/** 依模式取得完整注意事項清單（共通在前、模式專屬在後） */
export const getDataUsageNotes = (mode: DataUsageNotesMode): string[] => [
    ...COMMON_DATA_USAGE_NOTES,
    ...(mode === 'k-anonymity' ? K_ANONYMITY_DATA_USAGE_NOTES : DIFFERENTIAL_PRIVACY_DATA_USAGE_NOTES),
];

const pad2 = (numberValue: number): string => String(numberValue).padStart(2, '0');
const formatLocalDateTime = (dateValue: Date): string =>
    `${dateValue.getFullYear()}-${pad2(dateValue.getMonth() + 1)}-${pad2(dateValue.getDate())} ${pad2(dateValue.getHours())}:${pad2(dateValue.getMinutes())}`;

/** 處理方式一行摘要（例如「K-匿名（K = 5）」「差分隱私（消耗 ε = 1.5）」） */
export const describeProcessingMethod = (context: DataUsageNotesContext): string =>
{
    if (context.mode === 'k-anonymity')
    {
        return Number.isFinite(Number(context.kValue)) && context.kValue !== null && context.kValue !== undefined
            ? `K-匿名（K = ${context.kValue}，每群至少 ${context.kValue} 筆資料無法區分）`
            : 'K-匿名';
    }
    const epsilonNumber = Number(context.consumedEpsilon);
    return context.consumedEpsilon !== null && context.consumedEpsilon !== undefined && Number.isFinite(epsilonNumber)
        ? `差分隱私（消耗隱私預算 ε = ${Number(epsilonNumber.toFixed(6))}）`
        : '差分隱私';
};

/** 組出隨資料附上的純文字說明（Windows 記事本可直接開啟，換行用 CRLF） */
export const buildDataUsageNotesText = (context: DataUsageNotesContext): string =>
{
    const lines: string[] = [
        '資料使用注意事項',
        '====================',
        ...(context.sourceFileName ? [`原始資料：${context.sourceFileName}`] : []),
        `處理方式：${describeProcessingMethod(context)}`,
        `產出時間：${formatLocalDateTime(context.generatedAt ?? new Date())}`,
        '',
        ...getDataUsageNotes(context.mode).map((noteText, noteIndex) => `${noteIndex + 1}. ${noteText}`),
        '',
        '如有疑問，請洽資料提供單位。',
    ];
    return lines.join('\r\n') + '\r\n';
};
