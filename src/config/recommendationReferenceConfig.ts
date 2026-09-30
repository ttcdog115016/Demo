/**
 * ============================================================================
 * 檔案名稱 (File): recommendationReferenceConfig.ts
 * 模組功能 (Description): 「套用系統推薦設定」功能之預設參考設定 (內嵌自使用者提供之
 *           config_dp.json／config_kanon.json 兩份參考設定檔)。當欄位名稱與此處鍵值
 *           完全相符時，DP／K-匿名兩種模式的「套用系統推薦設定」按鈕即優先套用此參考設定
 *           所指定之資料型態／隱私角色／處理策略／參數設定；未列於此參考設定中的欄位，
 *           則維持退回既有之關鍵字判斷邏輯 (英文/中文欄位名稱關鍵字比對)。
 * 規範對照: 符合開發規範 h) 資料結構宣告註記，欄位說明置於右方
 * ============================================================================
 */

/**
 * 差分隱私 (DP) 模式單一欄位之參考設定介面
 * 對應 config_dp.json 之 column_budgets 內單一欄位物件結構
 */
export interface DPColumnBudgetReferenceItem
{
    type: string;          // 'continuous' | 'categorical' | 'datetime' 等 Open-PETs API 設定檔型態代碼
    epsilon: number;       // 該欄位專屬之 Epsilon 隱私預算 (ε)
    delta?: number;        // 該欄位專屬之 Delta 鬆弛參數 (δ)
    sensitivity?: number;  // 連續數值型欄位之函數敏感度 (用以推算裁剪上下限)
}

/**
 * 差分隱私 (DP) 模式「套用系統推薦設定」參考設定
 * 資料來源: 使用者提供之 config_dp.json，鍵值為欄位名稱，須與資料集欄位名稱完全相符才會套用
 */
export const DP_COLUMN_BUDGETS_REFERENCE: Record<string, DPColumnBudgetReferenceItem> = {
    "年齡": { type: "continuous", epsilon: 5.0, delta: 0.0, sensitivity: 71.0 },
    "薪資": { type: "continuous", epsilon: 5.0, delta: 0.0, sensitivity: 125000.0 },
    "就醫次數": { type: "continuous", epsilon: 4.0, delta: 0.0, sensitivity: 19.0 },
    "地區": { type: "categorical", epsilon: 1.0 },
    "生日": { type: "datetime", epsilon: 1.0, delta: 0.0, sensitivity: 365.0 },
};

/**
 * K-匿名模式單一欄位之參考設定介面
 * 對應 config_kanon.json 之 columns 內單一欄位物件結構
 */
export interface KAnonColumnReferenceItem
{
    role: string;       // 'identifier' | 'quasi_identifier' | 'sensitive' | 'non_sensitive'
    type: string;       // 'string' | 'numeric' | 'categorical' | 'temporal'
    strategy?: string;  // 遮蔽策略 (如 'remove')，未指定時依隱私角色套用系統預設策略
}

/**
 * K-匿名模式「套用系統推薦設定」參考設定
 * 資料來源: 使用者提供之 config_kanon.json 之 columns 區段，鍵值為欄位名稱，須與資料集欄位名稱完全相符才會套用
 * (generalization_hierarchies／generalization_matrices／qi_generalization_levels 等階層樹對照表內容，
 *  屬於既有「匯入配置」功能之職責範圍，非本參考設定涵蓋對象)
 */
export const KANON_COLUMNS_REFERENCE: Record<string, KAnonColumnReferenceItem> = {
    "姓名": { role: "identifier", type: "string" },
    "身分證號": { role: "identifier", type: "string", strategy: "remove" },
    "生日": { role: "identifier", type: "temporal", strategy: "remove" },
    "年齡": { role: "quasi_identifier", type: "numeric" },
    "地區": { role: "quasi_identifier", type: "categorical" },
    "職業": { role: "quasi_identifier", type: "categorical" },
    "疾病": { role: "sensitive", type: "categorical" },
    "薪資": { role: "non_sensitive", type: "numeric" },
    "婚姻狀況": { role: "non_sensitive", type: "categorical" },
    "就醫次數": { role: "non_sensitive", type: "numeric" },
};

// ★ DP 模式「敏感欄位」自動判定參考設定（DP_SENSITIVE_FIELD_ROLE_REFERENCE）已移除：
// DP 模式風險評估不應要求指定「恰好 1 個敏感欄位」，先前這項設計經確認為錯誤假設，
// 已於 Step2 差分隱私欄位設定與 Step4 風險評估流程中一併移除。
