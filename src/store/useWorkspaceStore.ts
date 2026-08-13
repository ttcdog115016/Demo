/**
 * ============================================================================
 * 檔案名稱 (File): useWorkspaceStore.ts
 * 模組功能 (Description): 全域去識別化工作區狀態數據庫 (Zustand Workspace Store，提供精靈步驟切換、資料集解析、K-Anonymity 與 DP 進階參數管理)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之縮寫) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import { create } from 'zustand';

/**
 * 預設系統常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const MIN_STEP_INDEX = 0;
const DEFAULT_K_ANONYMITY_VALUE = 5;
const DEFAULT_L_DIVERSITY_VALUE = 2;
const DEFAULT_T_CLOSENESS_VALUE = 0.15;
const DEFAULT_MAX_SUPPRESSION_PERCENT = 5;
const DEFAULT_EPSILON_BUDGET = 1.0;
const DEFAULT_DELTA_BUDGET = 1e-5;
const DEFAULT_NUMERIC_LOWER_BOUND = 0;
const DEFAULT_NUMERIC_UPPER_BOUND = 100;
const DEFAULT_SIMULATE_QUERY_COUNT = 1;
const DEFAULT_BUDGET_LIMIT_EPSILON = 10;
const DEFAULT_TARGET_DELTA = 0.0001;

/**
 * 預處理清洗規則介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export interface PreprocessingRule 
{
	action: string; // 清洗動作指令 (如 'remove_digits', 'remove_spaces', 'hash')
	param: string;  // 清洗動作附帶之參數
}

/**
 * 差分隱私 (DP) 欄位配置介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export interface DPField 
{
	id: string;                                           // 欄位唯一識別碼 (如: 'col_0')
	fieldName: string;                                    // 欄位名稱
	enabled?: boolean;                                    // 是否啟用 DP 處理
	fieldType?: 'Numeric' | 'Categorical' | 'Text' | 'Unknown'; // 欄位資料型態
	epsilon?: number;                                     // 個人化 Epsilon 隱私預算 (ε)
	delta?: number;                                       // 個人化 Delta 鬆弛參數 (δ)
	mode?: 'epsilon' | 'epsilon-delta';                   // 差分隱私運作模式
	lowerBound?: number | string;                         // 連續數值型裁剪下限
	upperBound?: number | string;                         // 連續數值型裁剪上限
	allowedCategories?: string;                           // 類別型允許之類別清單 (以逗號分隔)
	maxLength?: number;                                   // 文字型最大長度限制
}

/**
 * 步驟四模擬與驗證檢測快照介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export interface Step4Cache 
{
	metrics: {
		singling: { ori: number; ctrl: number; base: number; risk: number };    // 指認性風險明細
		linkability: { ori: number; ctrl: number; base: number; risk: number }; // 連結性風險明細
		inference: { ori: number; ctrl: number; base: number; risk: number };   // 推斷性風險明細
		overallRiskPercent: string;                                             // 綜合風險百分比字串
	};
	certificateId: string;                                                      // 合規驗證憑證編號
	auditTime: string;                                                          // 審計驗證時間字串
}

/**
 * 去識別化工作區全域狀態與 Actions 介面
 * 規範對照: 符合規範 h) 資料結構宣告註記
 */
interface WorkspaceState 
{
	// 基礎設定與檔案資料 (符合規範 g)
	currentStep: number;                                                     // 當前精靈步驟索引 (0 ~ 3)
	privacyMode: 'k-anonymity' | 'differential-privacy' | null;               // 脫敏保護模式
	columns: string[];                                                       // 數據集欄位名稱陣列
	previewData: Record<string, unknown>[];                                  // 前端預覽數據紀錄陣列
	preprocessingRules: Record<string, PreprocessingRule>;                    // 預處理清洗規則表
	fileName?: string;                                                       // 當前載入之檔案名稱
	
	// 核心陣列與物件 (符合規範 g)
	columnRoles: Record<string, string>;                                      // 欄位隱私角色映射
	columnTypes: Record<string, string>;                                      // 欄位資料型態映射
	dpFields: DPField[];                                                     // 差分隱私欄位配置陣列
	
	// 步驟四預覽快照 (符合規範 g)
	step4Cache: Step4Cache | null;                                           // 風險量測快照
	lastRunParamsHash: string | null;                                        // 參數設定校驗 Hash 快照

	// 門閥驗證狀態 (符合規範 g)
	isStepValid: boolean;                                                    // 當前步驟是否合規
	stepErrorMessage: string | null;                                          // 步驟驗證錯誤提示訊息
	
	// K-Anonymity 進階參數 (符合規範 g)
	kValue: number;                                                          // K-匿名 k 數值
	lValue: number;                                                          // L-多樣性 l 數值
	tValue: number;                                                          // T-趨近性 t 數值
	maxSuppression: number;                                                  // 最大允許抑制率 (%)
	suppressionMethod: string;                                               // 抑制處理方式 ('row_suppression' | 'cell_suppression')
	limitExceededAction: string;                                             // 抑制率超限處置動作

	kAnonymityFields: Record<string, unknown>[];                             // K-匿名欄位明細
	kAnonymityHierarchies: Record<string, unknown>[];                        // K-匿名階層對應表
	fieldAttributes: Record<string, unknown>;                                // JSON 導出用欄位屬性
	maskingRules: Record<string, unknown>;                                   // JSON 導出用遮蔽規則
	generalizationRules: Record<string, unknown>;                            // JSON 導出用泛化規則
	categoricalHierarchies: Record<string, unknown>;                         // JSON 導出用類別階層
	numericBins: Record<string, unknown>;                                    // JSON 導出用數值箱寬
	temporalHierarchies: Record<string, unknown>;                            // JSON 導出用時間階層

	// Differential Privacy 進階參數 (符合規範 g)
	queryCount: number;                                                      // 模擬連續發布/查詢次數 M
	targetDelta: number;                                                     // 全域目標 Baseline δ
	budgetLimitEpsilon: number;                                              // 累積隱私預算門檻上限
	outOfBoundsStrategy: string;                                             // 數值邊界溢出處置策略

	// Actions 宣告
	/**
	 * 函數名稱: setPrivacyMode
	 * 函數功能: 切換去識別化保護模式 ('k-anonymity' | 'differential-privacy')。
	 */
	setPrivacyMode: (privacyModeTypeStr: 'k-anonymity' | 'differential-privacy') => void;

	/**
	 * 函數名稱: setPreprocessingRules
	 * 函數功能: 寫入第一階段資料預先處理清洗規則表。
	 */
	setPreprocessingRules: (preprocessingRulesMapDict: Record<string, PreprocessingRule>) => void;

	/**
	 * 函數名稱: nextStep
	 * 函數功能: 推進精靈步驟至下一步 (currentStep + 1)。
	 */
	nextStep: () => void;

	/**
	 * 函數名稱: prevStep
	 * 函數功能: 回退精靈步驟至上一步 (currentStep - 1)。
	 */
	prevStep: () => void;

	/**
	 * 函數名稱: setStep4Cache
	 * 函數功能: 暫存步驟四風險量測數值快照與參數 Hash。
	 */
	setStep4Cache: (step4CacheDataObj: Step4Cache, paramsHashString: string) => void;

	/**
	 * 函數名稱: setFileData
	 * 函數功能: 載入解析後之檔案數據集，並自動建構初化帶有唯一 id 的 dpFields 陣列。
	 */
	setFileData: (datasetColumnsListArray: string[], datasetRowsListArray: Record<string, unknown>[], loadedFileNameStr: string) => void;

	/**
	 * 函數名稱: clearFileData
	 * 函數功能: 清除目前載入之資料集與工作區快照，還原初始狀態。
	 */
	clearFileData: () => void;

	/**
	 * 函數名稱: setStepValidation
	 * 函數功能: 更新步驟驗證通過標記與錯誤說明訊息。
	 */
	setStepValidation: (isValidBooleanStatus: boolean, errorMessageString: string | null) => void;
	
	/**
	 * 函數名稱: setDpFields
	 * 函數功能: 設定或反寫差分隱私 dpFields 欄位設定陣列。
	 */
	setDpFields: (dpFieldsListArray: DPField[]) => void;
}

/**
 * 函數名稱: createInitialDPFields
 * 函數功能: 依據傳入之資料集欄位名稱陣列，自動建構帶有唯一 id 與智慧推導型態之初始 DPField 物件陣列。
 * 
 * 輸入參數 (Input):
 *   - datasetColumnsListArray (string[]): 原始資料集欄位名稱陣列
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - DPField[]: 初始建構之差分隱私欄位設定陣列
 * 呼叫關係 (Call Relations): 被 setFileData 在載入新檔案資料時調用
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
const createInitialDPFields = (datasetColumnsListArray: string[]): DPField[] => 
{
	return datasetColumnsListArray.map(
		(columnNameString, columnIndexNumber) => 
		{
			// 將欄位名稱轉換為小寫以利比對關鍵字 (符合規範 g)
			const lowerCaseColumnNameString = columnNameString.toLowerCase();
			
			// 智慧推導預設型態 (符合規範 g)
			let calculatedDefaultTypeStr: 'Numeric' | 'Categorical' | 'Text' | 'Unknown' = 'Unknown';

			if (/(age|amount|fare|count|price|salary|num|duration|mins)/i.test(lowerCaseColumnNameString)) 
			{
				calculatedDefaultTypeStr = 'Numeric';
			} 
			else if (/(gender|type|category|status|station)/i.test(lowerCaseColumnNameString)) 
			{
				calculatedDefaultTypeStr = 'Categorical';
			}

			return {
				id: `${columnNameString}-${columnIndexNumber}`,
				fieldName: columnNameString,
				fieldType: calculatedDefaultTypeStr,
				enabled: true,
				epsilon: DEFAULT_EPSILON_BUDGET,
				delta: DEFAULT_DELTA_BUDGET,
				lowerBound: calculatedDefaultTypeStr === 'Numeric' ? DEFAULT_NUMERIC_LOWER_BOUND : undefined,
				upperBound: calculatedDefaultTypeStr === 'Numeric' ? DEFAULT_NUMERIC_UPPER_BOUND : undefined,
				allowedCategories: ''
			};
		}
	);
};

/**
 * 全域去識別化工作區 Store 實例 (useWorkspaceStore)
 * 規範對照: 符合規範 i) 全域變數/狀態詳細註記
 */
export const useWorkspaceStore = create<WorkspaceState>(
	(setStoreStateAction) => 
	(
		{
			// 初始化基礎資料 (符合規範 g)
			currentStep: MIN_STEP_INDEX,
			privacyMode: null,
			columns: [],
			previewData: [],
			preprocessingRules: {},
			fileName: undefined,
			columnRoles: {},
			columnTypes: {},
			dpFields: [],
			step4Cache: null,
			lastRunParamsHash: null,

			// 初始化驗證狀態 (符合規範 g)
			isStepValid: true,
			stepErrorMessage: null,

			// 初始化 K-Anonymity 參數 (符合規範 g)
			kValue: DEFAULT_K_ANONYMITY_VALUE, 
			lValue: DEFAULT_L_DIVERSITY_VALUE,
			tValue: DEFAULT_T_CLOSENESS_VALUE,
			maxSuppression: DEFAULT_MAX_SUPPRESSION_PERCENT,
			suppressionMethod: 'row_suppression',
			limitExceededAction: 'stop_and_error',

			kAnonymityFields: [],
			kAnonymityHierarchies: [],
			fieldAttributes: {},
			maskingRules: {},
			generalizationRules: {},
			categoricalHierarchies: {},
			numericBins: {},
			temporalHierarchies: {},
			
			// 初始化 DP 參數 (符合規範 g)
			queryCount: DEFAULT_SIMULATE_QUERY_COUNT,
			targetDelta: DEFAULT_TARGET_DELTA,
			budgetLimitEpsilon: DEFAULT_BUDGET_LIMIT_EPSILON,
			outOfBoundsStrategy: 'clip',
			
			// Actions 實作
			setPrivacyMode: (privacyModeTypeStr) => setStoreStateAction({ privacyMode: privacyModeTypeStr }),
			
			setPreprocessingRules: (preprocessingRulesMapDict) => setStoreStateAction({ preprocessingRules: preprocessingRulesMapDict }),
			
			nextStep: () => setStoreStateAction(
				(currentStoreStateData) => ({ currentStep: currentStoreStateData.currentStep + 1 })
			),
			
			prevStep: () => setStoreStateAction(
				(currentStoreStateData) => ({ currentStep: currentStoreStateData.currentStep - 1 })
			),
			
			setStep4Cache: (step4CacheDataObj, paramsHashString) => setStoreStateAction({ step4Cache: step4CacheDataObj, lastRunParamsHash: paramsHashString }),
			
			setFileData: (datasetColumnsListArray, datasetRowsListArray, loadedFileNameStr) => setStoreStateAction({ 
				columns: datasetColumnsListArray, 
				previewData: datasetRowsListArray, 
				fileName: loadedFileNameStr,
				dpFields: createInitialDPFields(datasetColumnsListArray) // 自動同步建構帶有 id 的 DP 欄位陣列
			}),

			clearFileData: () => setStoreStateAction({ 
				columns: [], 
				previewData: [], 
				fileName: undefined, 
				privacyMode: null, 
				preprocessingRules: {},
				dpFields: [] 
			}),
			
			setStepValidation: (isValidBooleanStatus, errorMessageString) => setStoreStateAction({ isStepValid: isValidBooleanStatus, stepErrorMessage: errorMessageString }),

			setDpFields: (dpFieldsListArray) => setStoreStateAction({ dpFields: dpFieldsListArray }),
		}
	)
);