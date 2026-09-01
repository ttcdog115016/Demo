/**
 * ============================================================================
 * 檔案名稱 (File): usePrivacyStore.ts
 * 模組功能 (Description): 整合式全域隱私防護工作區狀態數據庫 (Zustand Persistent Master Privacy Store，提供去識別化工作流、審計軌跡與系統安全參數管理)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之縮寫) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * ============================================================================
 * 預設系統常數宣告 (Magic Numbers Constants)
 * ============================================================================
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const DEFAULT_SESSION_TIMEOUT_MINUTES = 15;
const DEFAULT_MAX_FAILED_LOGINS = 5;
const DEFAULT_PASSWORD_EXPIRY_DAYS = 90;
const DEFAULT_K_ANONYMITY_VALUE = 5;
const DEFAULT_MAX_SUPPRESSION_PERCENT = 10;
const DEFAULT_L_DIVERSITY_VALUE = 2;
const DEFAULT_T_CLOSENESS_VALUE = 0.15;
const DEFAULT_EPSILON_BUDGET = 1.0;
const DEFAULT_DELTA_BUDGET = 0.0001;
const DEFAULT_SIMULATE_QUERY_COUNT = 1;
const DEFAULT_BUDGET_LIMIT_EPSILON = 10.0;
const MAX_STEP_INDEX = 3;
const MIN_STEP_INDEX = 0;

/**
 * 使用者系統角色型別定義
 * 規範對照: 符合規範 h) 資料結構宣告註記
 */
export type UserRole = 'admin' | 'data_owner';

/**
 * 使用者個人基本資料介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export interface UserProfile 
{
	name: string;   // 使用者顯示名稱
	email: string;  // 使用者電子郵件帳號
	role: UserRole; // 使用者系統角色 ('admin' | 'data_owner')
}

/**
 * 差分隱私欄位配置參數介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export interface DpField 
{
	id: string;                   // 欄位唯一識別碼
	fieldName: string;            // 欄位名稱
	fieldType?: string;           // 資料型態 ('Numeric' | 'Categorical' | 'Text' | 'Unknown')
	enabled: boolean;             // 是否啟用差分隱私處理
	epsilon: number;              // 個人化 Epsilon 隱私預算 (ε)
	delta: number;                // 個人化 Delta 鬆弛參數 (δ)
	mode: 'epsilon' | 'epsilon-delta'; // 差分隱私運作模式
	equivalentEpsilon?: number;   // 換算後之等效 Epsilon 數值
	sensitivity?: number;         // 函數敏感度 (Sensitivity)
	lowerBound?: number | string; // 連續數值截斷下限
	upperBound?: number | string; // 連續數值截斷上限
	allowedCategories?: string;   // 類別型允許之類別清單
	maxLength?: number | string;  // 文字型最大長度限制
}

/**
 * 步驟三隱私參數批次更新介面
 * 規範對照: 符合規範 h) 資料結構宣告註記
 */
export interface Step3Params 
{
	kValue?: number;                                  // K-匿名群組大小 k
	maxSuppression?: number;                          // 最大允許抑制率 (%)
	lValue?: number;                                  // L-多樣性 l
	tValue?: number;                                  // T-趨近性 t
	suppressionMethod?: 'row' | 'cell';                // 抑制處理方式
	limitExceededAction?: string;                     // 抑制率超限應變處置
	epsilon?: number;                                 // 隱私預算 ε
	targetDelta?: number;                             // 全域 Baseline Target δ
	queryCount?: number;                              // 模擬連續查詢發布次數
	budgetLimitEpsilon?: number;                      // 累積隱私預算門檻上限
	outOfBoundsStrategy?: 'clip' | 'wrap' | 'reflect'; // 溢出處理策略
	dpFields?: DpField[];                             // 差分隱私欄位配置陣列
}

/**
 * 使用者角色權限開關介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export interface UserPermissions 
{
	canUploadData: boolean;   // 是否允許上傳資料集
	canEditRules: boolean;     // 是否允許編輯脫敏與清洗規則
	canAdjustParams: boolean;  // 是否允許調整隱私參數
	canExportCSV: boolean;     // 是否允許導出脫敏後 CSV
	canExportReport: boolean;  // 是否允許導出 PDF 審計報告
}

/**
 * 歷史審計軌跡紀錄項介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export interface AuditLogItem 
{
	id: string;                                          // 審計紀錄識別碼
	certificateId: string;                               // 合規審計憑證編號
	fileName: string;                                    // 處置資料集檔案名稱
	privacyMode: 'k-anonymity' | 'differential-privacy'; // 脫敏保護模式
	operator: string;                                    // 操作者姓名
	operatorRole: UserRole;                              // 操作者系統角色
	auditTime: string;                                   // 審計時間字串
	parameters: string;                                  // 關鍵參數摘要
	singlingRisk: string;                                // 指認性殘餘風險
	linkabilityRisk: string;                             // 連結性殘餘風險
	inferenceRisk: string;                               // 推斷性殘餘風險
	overallRisk: string;                                 // 綜合殘餘風險
	status: 'passed' | 'rejected';                       // 審計驗證結果狀態
}

/**
 * K-匿名欄位規則定義介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export interface FieldDef 
{
	id: string;            // 欄位唯一識別碼
	name: string;          // 欄位名稱
	type: string;          // 資料型態
	role: string;          // 隱私角色
	maskStrategy: string;  // 遮蔽策略
	maskKeepChars: number; // 保留字元數
	maskChar: string;      // 遮蔽字元
	hashType: string;      // 雜湊演算法
	genStrategy: string;   // 泛化策略
	genParam: number;      // 泛化參數
	genMaxLevel: number;   // 泛化最高層級
}

/**
 * K-匿名階層樹對應表結構介面
 * 規範對照: 符合規範 h) 資料結構宣告註記
 */
export interface HierarchyTable 
{
	id: string;            // 階層表識別碼
	fieldName: string;     // 對應欄位名稱
	mappings: string[][];  // 二維階層對應矩陣
}

/**
 * 隱私風險量測模擬指標介面
 * 規範對照: 符合規範 h) 資料結構宣告註記
 */
export interface SimulationMetrics 
{
	singling: { ori: number; ctrl: number; base: number; risk: number };   // 指認性風險明細
	linkability: { ori: number; ctrl: number; base: number; risk: number };// 連結性風險明細
	inference: { ori: number; ctrl: number; base: number; risk: number };  // 推斷性風險明細
	overallRiskPercent: string;                                            // 綜合風險百分比字串
}

/**
 * 步驟四預覽與報告暫存快照介面
 * 規範對照: 符合規範 h) 資料結構宣告註記
 */
export interface Step4Cache 
{
	metrics: SimulationMetrics; // 風險量測指標
	certificateId: string;      // 憑證編號
	auditTime: string;          // 審計時間
}

/**
 * 主 Master 隱私 Store 狀態與 Actions 介面
 * 規範對照: 符合規範 h) 資料結構宣告註記
 */
export interface PrivacyState 
{
	// ============================================================================
	// 身分與系統偏好狀態 (User Profile & System Preferences)
	// ============================================================================
	isAuthenticated: boolean;                                   // 是否已登入
	user: UserProfile | null;                                   // 當前使用者資料
	isDarkMode: boolean;                                        // 深色模式開關
	language: string;                                           // 系統語系
	currentStep: number;                                        // 去識別化精靈當前步驟 (0 ~ 3)
	privacyMode: 'k-anonymity' | 'differential-privacy' | null; // 保護模式
	
	// ============================================================================
	// 連線安全與密碼政策狀態 (Security & Audit Policies)
	// ============================================================================
	sessionTimeout: number;                                     // Session 逾時分鐘數
	maxFailedLogins: number;                                    // 最大失敗登入次數
	isMaintenanceMode: boolean;                                 // 系統維護模式開關
	isPasswordExpired: boolean;                                 // 使用者密碼是否過期
	enablePasswordExpiry: boolean;                              // 強制密碼過期輪替開關
	passwordExpiryDays: number;                                 // 密碼有效天數
	
	// ============================================================================
	// Step 1 檔案與資料集狀態 (Dataset State)
	// ============================================================================
	columns: string[];                                     // 欄位名稱清單
	previewData: Record<string, unknown>[];                // 預覽數據筆數清單
	fileName: string | null;                               // 當前載入檔案名稱
	
	// ============================================================================
	// Step 2 清洗與欄位標註狀態 (Preprocessing & Mapping State)
	// ============================================================================
	columnRoles: Record<string, string>;                   // 欄位隱私角色對應表
	columnTypes: Record<string, string>;                   // 欄位資料型態對應表
	preprocessingRules: Record<string, { action: string; param: string }>; // 預處理規則表

	// ============================================================================
	// JSON 匯出與 K-Anonymity 特屬配置 (Export Configuration State)
	// ============================================================================
	kAnonymityFields: FieldDef[];                          // K-匿名欄位配置
	kAnonymityHierarchies: HierarchyTable[];               // K-匿名階層對應表
	fieldAttributes: Record<string, unknown>;              // JSON 輸出用欄位屬性
	maskingRules: Record<string, unknown>;                 // JSON 輸出用遮蔽規則
	generalizationRules: Record<string, unknown>;          // JSON 輸出用泛化規則
	categoricalHierarchies: Record<string, unknown>;       // JSON 輸出用類別階層
	numericBins: Record<string, unknown>;                  // JSON 輸出用數值分箱
	temporalHierarchies: Record<string, unknown>;          // JSON 輸出用時間階層

	// ============================================================================
	// 步驟門閥驗證狀態 (Progression Validation State)
	// ============================================================================
	isStepValid: boolean;                                  // 當前步驟是否合規
	stepErrorMessage: string | null;                        // 步驟驗證錯誤訊息
	
	// ============================================================================
	// Step 3 K-Anonymity 專屬參數 (K-Anonymity Parameters)
	// ============================================================================
	kValue: number;                                        // k 數值
	maxSuppression: number;                                // 最大允許抑制率 (%)
	lValue: number;                                        // l 多樣性數值
	tValue: number;                                        // t 趨近性數值
	suppressionMethod: 'row' | 'cell';                     // 抑制方式
	limitExceededAction: string;                           // 抑制超限處置

	// ============================================================================
	// Step 3 Differential Privacy 專屬參數 (Differential Privacy Parameters)
	// ============================================================================
	epsilon: number;                                       // 單一 Epsilon
	targetDelta: number;                                   // 全域 Target Baseline δ
	queryCount: number;                                    // 模擬連續查詢次數
	budgetLimitEpsilon: number;                            // 累積隱私預算門檻
	outOfBoundsStrategy: 'clip' | 'wrap' | 'reflect';      // 溢出處理策略
	dpFields: DpField[];                                   // 差分隱私欄位配置陣列

	// ============================================================================
	// 審計軌跡與快照數據庫 (Persistence & History State)
	// ============================================================================
	auditLogs: AuditLogItem[];                             // 歷史審計憑證清單
	step4Cache: Step4Cache | null;                         // 步驟四檢測快照
	lastRunParamsHash: string | null;                      // 參數驗證 Hash 快照

	// ============================================================================
	// 全域 Actions 宣告 (Global Store Actions)
	// ============================================================================
	setSessionTimeout: (timeoutMinutes: number) => void;
	setMaxFailedLogins: (failedCount: number) => void;
	setMaintenanceMode: (isMaintenance: boolean) => void;
	setPasswordExpired: (isExpired: boolean) => void; 
	updateSecuritySettings: (settingsObj: { sessionTimeout: number; maxFailedLogins: number; isMaintenanceMode: boolean; enablePasswordExpiry: boolean; passwordExpiryDays: number; }) => void;
	setStepValidation: (isValidStatus: boolean, errorMessage?: string | null) => void;
	addAuditLog: (auditLogObj: Omit<AuditLogItem, 'id'>) => void;
	setStep4Cache: (cacheObj: Step4Cache, paramsHash: string) => void;
	getPermissions: () => UserPermissions;
	setUserRole: (targetRole: UserRole) => void;
	login: (userDataObj: { name: string; email: string; role?: UserRole }) => void;
	logout: () => void;
	setIsDarkMode: (isDarkTheme: boolean) => void;
	setLanguage: (langCode: string) => void;
	setFileData: (columnsList: string[], dataList: Record<string, unknown>[], fileNameStr: string) => void;
	clearFileData: () => void;
	setPrivacyMode: (privacyModeType: 'k-anonymity' | 'differential-privacy') => void;
	nextStep: () => void;
	prevStep: () => void;
	setKValue: (kVal: number) => void;
	setMaxSuppression: (suppressionVal: number) => void;
	setLValue: (lVal: number) => void;
	setTValue: (tVal: number) => void;
	setSuppressionMethod: (methodType: 'row' | 'cell') => void;
	setLimitExceededAction: (actionType: string) => void;
	setEpsilon: (epsVal: number) => void;
	setTargetDelta: (deltaVal: number) => void;
	setQueryCount: (queryVal: number) => void;
	setBudgetLimitEpsilon: (budgetVal: number) => void;
	toggleFieldEnable: (targetFieldName: string, isEnabled?: boolean) => void;
	updateFieldDP(updatedFieldObj: Partial<DpField>): void;
	updateFieldDP(targetFieldName: string, updatedFieldsObj: Partial<DpField>): void;
	updateFieldDP<AttributeKey extends keyof DpField>(targetFieldName: string, attributeKey: AttributeKey, attributeValue?: DpField[AttributeKey]): void;
	updateStep3Params: (paramsObj: Partial<Step3Params>) => void;
}

/**
 * 全域 Master 隱私 Store 實例 (usePrivacyStore)
 * 規範對照: 符合規範 i) 全域變數/狀態詳細註記
 */
export const usePrivacyStore = create<PrivacyState>()(
	persist(
		(setStoreStateAction, getStoreStateAction) => 
		(
			{
				// 預設初始化狀態 (符合規範 g)
				isAuthenticated: false,
				user: null,
				isDarkMode: true,
				language: 'zh_TW',
				currentStep: MIN_STEP_INDEX,
				privacyMode: null,
				
				sessionTimeout: DEFAULT_SESSION_TIMEOUT_MINUTES,
				maxFailedLogins: DEFAULT_MAX_FAILED_LOGINS,
				isMaintenanceMode: false,
				isPasswordExpired: false, 
				
				enablePasswordExpiry: true,
				passwordExpiryDays: DEFAULT_PASSWORD_EXPIRY_DAYS,
				
				/**
				 * 函數名稱: setSessionTimeout
				 * 函數功能: 更新連線閒置逾時登出時間數值。
				 */
				setSessionTimeout: (timeoutMinutesValue) => setStoreStateAction({ sessionTimeout: timeoutMinutesValue }),

				/**
				 * 函數名稱: setMaxFailedLogins
				 * 函數功能: 更新密碼錯誤鎖定之次數上限。
				 */
				setMaxFailedLogins: (failedCountValue) => setStoreStateAction({ maxFailedLogins: failedCountValue }),

				/**
				 * 函數名稱: setMaintenanceMode
				 * 函數功能: 切換系統維護模式 (Maintenance Mode) 開關。
				 */
				setMaintenanceMode: (isMaintenanceModeActive) => setStoreStateAction({ isMaintenanceMode: isMaintenanceModeActive }),

				/**
				 * 函數名稱: setPasswordExpired
				 * 函數功能: 設定目前使用者之密碼是否處於已過期狀態。
				 */
				setPasswordExpired: (isPasswordExpiredStatus) => setStoreStateAction({ isPasswordExpired: isPasswordExpiredStatus }), 

				/**
				 * 函數名稱: updateSecuritySettings
				 * 函數功能: 批次更新系統安全與環境參數。
				 */
				updateSecuritySettings: ({ sessionTimeout, maxFailedLogins, isMaintenanceMode, enablePasswordExpiry, passwordExpiryDays }) => 
					setStoreStateAction({ sessionTimeout, maxFailedLogins, isMaintenanceMode, enablePasswordExpiry, passwordExpiryDays }),
				
				columns: [],
				previewData: [],
				fileName: null,
				
				columnRoles: {},
				columnTypes: {},
				preprocessingRules: {},

				kAnonymityFields: [],
				kAnonymityHierarchies: [],
				fieldAttributes: {},
				maskingRules: {},
				generalizationRules: {},
				categoricalHierarchies: {},
				numericBins: {},
				temporalHierarchies: {},

				isStepValid: true,
				stepErrorMessage: null,

				/**
				 * 函數名稱: setStepValidation
				 * 函數功能: 更新步驟門閥之校驗結果標記與錯誤訊息。
				 */
				setStepValidation: (isValidBooleanStatus, validationErrorMessage = null) => setStoreStateAction({ isStepValid: isValidBooleanStatus, stepErrorMessage: validationErrorMessage }),

				kValue: DEFAULT_K_ANONYMITY_VALUE,
				maxSuppression: DEFAULT_MAX_SUPPRESSION_PERCENT,
				lValue: DEFAULT_L_DIVERSITY_VALUE,
				tValue: DEFAULT_T_CLOSENESS_VALUE,
				suppressionMethod: 'row',
				limitExceededAction: 'stop_and_error',

				epsilon: DEFAULT_EPSILON_BUDGET,
				targetDelta: DEFAULT_DELTA_BUDGET,
				queryCount: DEFAULT_SIMULATE_QUERY_COUNT,
				budgetLimitEpsilon: DEFAULT_BUDGET_LIMIT_EPSILON,
				outOfBoundsStrategy: 'clip',
				dpFields: [],

				auditLogs: [
					{
						id: 'log-1',
						certificateId: 'PAC-1785138781031',
						fileName: 'finance_scenario_v2_test_data.csv',
						privacyMode: 'k-anonymity',
						operator: 'Admin.Test',
						operatorRole: 'admin',
						auditTime: '2026/7/27 下午3:53:01',
						parameters: 'K = 5, Suppression = 10%',
						singlingRisk: '8.2%',
						linkabilityRisk: '10.5%',
						inferenceRisk: '12.1%',
						overallRisk: '12.1%',
						status: 'passed',
					}
				],

				step4Cache: null,
				lastRunParamsHash: null,

				/**
				 * 函數名稱: setStep4Cache
				 * 函數功能: 寫入步驟四風險量測數值快照與參數校驗 Hash 值。
				 */
				setStep4Cache: (cacheDataSnapshot, paramsHashString) => setStoreStateAction({ step4Cache: cacheDataSnapshot, lastRunParamsHash: paramsHashString }),

				/**
				 * 函數名稱: addAuditLog
				 * 函數功能: 寫入新簽發之合規審計憑證紀錄至審計軌跡清單。
				 */
				addAuditLog: (newAuditLogEntryObj) => setStoreStateAction(
					(currentStoreStateData) => 
					{
						const isDuplicateLogEntryFound = currentStoreStateData.auditLogs.some(
							(existingLogRecordItem) => existingLogRecordItem.certificateId === newAuditLogEntryObj.certificateId
						);

						if (isDuplicateLogEntryFound) 
						{
							return currentStoreStateData;
						}

						const newlyConstructedAuditLogItem = {
							...newAuditLogEntryObj,
							id: (newAuditLogEntryObj as { id?: string }).id || newAuditLogEntryObj.certificateId || `log-${Date.now()}`,
						};

						return { 
							auditLogs: [newlyConstructedAuditLogItem, ...currentStoreStateData.auditLogs] 
						};
					}
				),

				/**
				 * 函數名稱: getPermissions
				 * 函數功能: 依據當前登入使用者之角色，計算並回傳權限控制開關。
				 */
				getPermissions: () => 
				{
					const currentUserRoleType = getStoreStateAction().user?.role || 'data_owner';

					return {
						canUploadData: currentUserRoleType === 'data_owner',
						canEditRules: currentUserRoleType === 'data_owner',
						canAdjustParams: currentUserRoleType === 'data_owner',
						canExportCSV: currentUserRoleType === 'data_owner',
						canExportReport: currentUserRoleType === 'data_owner',
					};
				},

				/**
				 * 函數名稱: setUserRole
				 * 函數功能: 切換登入使用者之權限角色。
				 */
				setUserRole: (targetUserRoleType) => setStoreStateAction({
					user: {
						name: targetUserRoleType === 'admin' ? 'Admin.Test' : 'Data.Owner.A',
						email: targetUserRoleType === 'admin' ? 'admin@company.com' : 'owner_a@company.com',
						role: targetUserRoleType
					}
				}),

				/**
				 * 函數名稱: login
				 * 函數功能: 執行使用者登入資訊寫入與 Session 建立。
				 */
				login: (userSessionDataObj) => setStoreStateAction({ 
					isAuthenticated: true, 
					user: {
						name: userSessionDataObj.name,
						email: userSessionDataObj.email,
						role: userSessionDataObj.role || 'data_owner'
					},
					isPasswordExpired: false 
				}),

				/**
				 * 函數名稱: logout
				 * 函數功能: 清除 Session 並重置登入狀態。
				 */
				logout: () => setStoreStateAction({ isAuthenticated: false, user: null }),

				/**
				 * 函數名稱: setIsDarkMode
				 * 函數功能: 設定深色模式切換。
				 */
				setIsDarkMode: (isDarkThemeActive) => setStoreStateAction({ isDarkMode: isDarkThemeActive }),

				/**
				 * 函數名稱: setLanguage
				 * 函數功能: 切換多國語系。
				 */
				setLanguage: (langCodeString) => setStoreStateAction({ language: langCodeString }),
				
				/**
				 * 函數名稱: setFileData
				 * 函數功能: 寫入解析後之檔案資料集，並自動建構 initialDpFields 陣列。
				 */
				setFileData: (datasetColumnsList, datasetRowsList, datasetFileNameStr) => 
				{
					const initialDpFieldsConfigArray: DpField[] = datasetColumnsList.map(
						(columnNameStr, columnIndexNumber) => 
						(
							{
								id: `dp-col-${columnIndexNumber}-${Date.now()}`,
								fieldName: columnNameStr,
								fieldType: columnNameStr.toLowerCase().includes('age') || columnNameStr.toLowerCase().includes('fare') ? 'Numeric' : 'Categorical',
								enabled: true,
								epsilon: DEFAULT_EPSILON_BUDGET,
								delta: DEFAULT_DELTA_BUDGET,
								mode: 'epsilon',
								equivalentEpsilon: DEFAULT_EPSILON_BUDGET,
								sensitivity: 1.0,
							}
						)
					);

					setStoreStateAction({ 
						columns: datasetColumnsList, 
						previewData: datasetRowsList, 
						fileName: datasetFileNameStr,
						columnRoles: datasetColumnsList.reduce((rolesAccumulatorDict: Record<string, string>, columnNameStr: string) => ({ ...rolesAccumulatorDict, [columnNameStr]: 'Non-sensitive' }), {}),
						columnTypes: datasetColumnsList.reduce((typesAccumulatorDict: Record<string, string>, columnNameStr: string) => ({ ...typesAccumulatorDict, [columnNameStr]: '字串' }), {}),
						dpFields: initialDpFieldsConfigArray,
						kAnonymityFields: [],
						kAnonymityHierarchies: [],
						fieldAttributes: {},
						maskingRules: {},
						generalizationRules: {},
						categoricalHierarchies: {},
						numericBins: {},
						temporalHierarchies: {},
						step4Cache: null,       
						lastRunParamsHash: null 
					});
				},

				/**
				 * 函數名稱: clearFileData
				 * 函數功能: 清除已載入之資料集與工作區快照，還原至初始狀態。
				 */
				clearFileData: () => setStoreStateAction({ 
					columns: [], 
					previewData: [], 
					fileName: null, 
					currentStep: MIN_STEP_INDEX, 
					privacyMode: null,
					dpFields: [],
					kAnonymityFields: [],
					kAnonymityHierarchies: [],
					fieldAttributes: {},
					maskingRules: {},
					generalizationRules: {},
					categoricalHierarchies: {},
					numericBins: {},
					temporalHierarchies: {},
					step4Cache: null,        
					lastRunParamsHash: null   
				}),

				/**
				 * 函數名稱: setPrivacyMode
				 * 函數功能: 切換脫敏保護模式 ('k-anonymity' | 'differential-privacy')。
				 */
				setPrivacyMode: (privacyModeTypeStr) => setStoreStateAction({ privacyMode: privacyModeTypeStr }),

				/**
				 * 函數名稱: nextStep
				 * 函數功能: 精靈步驟前進一步。
				 */
				nextStep: () => setStoreStateAction(
					(currentStoreStateData) => ({ currentStep: Math.min(currentStoreStateData.currentStep + 1, MAX_STEP_INDEX) })
				),

				/**
				 * 函數名稱: prevStep
				 * 函數功能: 精靈步驟後退一步。
				 */
				prevStep: () => setStoreStateAction(
					(currentStoreStateData) => ({ currentStep: Math.max(currentStoreStateData.currentStep - 1, MIN_STEP_INDEX) })
				),

				/**
				 * 函數名稱: setKValue
				 * 函數功能: 設定 K-Anonymity k 數值。
				 */
				setKValue: (kNumberValue) => setStoreStateAction({ kValue: kNumberValue }),

				/**
				 * 函數名稱: setMaxSuppression
				 * 函數功能: 設定最大允許抑制率限制 (%)。
				 */
				setMaxSuppression: (suppressionPercentageValue) => setStoreStateAction({ maxSuppression: suppressionPercentageValue }),

				/**
				 * 函數名稱: setLValue
				 * 函數功能: 設定 L-Diversity l 數值。
				 */
				setLValue: (lNumberValue) => setStoreStateAction({ lValue: lNumberValue }),

				/**
				 * 函數名稱: setTValue
				 * 函數功能: 設定 T-Closeness t 數值。
				 */
				setTValue: (tNumberValue) => setStoreStateAction({ tValue: tNumberValue }),

				/**
				 * 函數名稱: setSuppressionMethod
				 * 函數功能: 設定抑制方式 ('row' | 'cell')。
				 */
				setSuppressionMethod: (methodTypeStr) => setStoreStateAction({ suppressionMethod: methodTypeStr }),

				/**
				 * 函數名稱: setLimitExceededAction
				 * 函數功能: 設定抑制超限處置動作。
				 */
				setLimitExceededAction: (actionTypeStr) => setStoreStateAction({ limitExceededAction: actionTypeStr }),

				/**
				 * 函數名稱: setEpsilon
				 * 函數功能: 設定單一 Epsilon 數值。
				 */
				setEpsilon: (epsilonNumberValue) => setStoreStateAction({ epsilon: epsilonNumberValue }),

				/**
				 * 函數名稱: setTargetDelta
				 * 函數功能: 設定全域 Baseline Target δ。
				 */
				setTargetDelta: (deltaNumberValue) => setStoreStateAction({ targetDelta: deltaNumberValue }),

				/**
				 * 函數名稱: setQueryCount
				 * 函數功能: 設定模擬連續查詢次數。
				 */
				setQueryCount: (queryCountNumberValue) => setStoreStateAction({ queryCount: queryCountNumberValue }),

				/**
				 * 函數名稱: setBudgetLimitEpsilon
				 * 函數功能: 設定累積隱私預算門檻。
				 */
				setBudgetLimitEpsilon: (budgetLimitNumberValue) => setStoreStateAction({ budgetLimitEpsilon: budgetLimitNumberValue }),

				/**
				 * 函數名稱: toggleFieldEnable
				 * 函數功能: 開啟或關閉指定欄位之差分隱私處理。
				 */
				toggleFieldEnable: (targetFieldNameStr: string, isEnabledStatus?: boolean) => setStoreStateAction(
					(currentStoreStateData) => 
					(
						{
							dpFields: currentStoreStateData.dpFields.map(
								(fieldItemRecord: DpField) => 
								(fieldItemRecord.fieldName === targetFieldNameStr || fieldItemRecord.id === targetFieldNameStr) 
									? { ...fieldItemRecord, enabled: isEnabledStatus !== undefined ? isEnabledStatus : !fieldItemRecord.enabled } 
									: fieldItemRecord
							)
						}
					)
				),

				/**
				 * 函數名稱: updateFieldDP
				 * 函數功能: 重載多型更新差分隱私 dpFields 屬性設定。
				 */
				updateFieldDP: (argument1: unknown, argument2?: unknown, argument3?: unknown) => setStoreStateAction(
					(currentStoreStateData) => 
					{
						if (typeof argument1 === 'object' && argument1 !== null) 
						{
							const updatedFieldConfigObj = argument1 as Partial<DpField>;

							return {
								dpFields: currentStoreStateData.dpFields.map(
									(fieldItemRecord: DpField) => 
									(fieldItemRecord.id === updatedFieldConfigObj.id || fieldItemRecord.fieldName === updatedFieldConfigObj.fieldName) ? { ...fieldItemRecord, ...updatedFieldConfigObj } : fieldItemRecord
								)
							};
						}

						const fieldIdentifierString = argument1 as string;

						if (typeof argument2 === 'object' && argument2 !== null) 
						{
							const partialUpdateConfigObj = argument2 as Partial<DpField>;

							return {
								dpFields: currentStoreStateData.dpFields.map(
									(fieldItemRecord: DpField) => 
									(fieldItemRecord.fieldName === fieldIdentifierString || fieldItemRecord.id === fieldIdentifierString) ? { ...fieldItemRecord, ...partialUpdateConfigObj } : fieldItemRecord
								)
							};
						}

						const targetAttributeKeyStr = argument2 as keyof DpField;

						const newAttributeValueData = argument3;

						return {
							dpFields: currentStoreStateData.dpFields.map(
								(fieldItemRecord: DpField) => 
								{
									if ((fieldItemRecord.fieldName === fieldIdentifierString || fieldItemRecord.id === fieldIdentifierString) && targetAttributeKeyStr) 
									{
										return { ...fieldItemRecord, [targetAttributeKeyStr]: newAttributeValueData };
									}

									return fieldItemRecord;
								}
							)
						};
					}
				),

				/**
				 * 函數名稱: updateStep3Params
				 * 函數功能: 批次更新步驟三隱私參數。
				 */
				updateStep3Params: (parametersBatchObj) => setStoreStateAction(
					(currentStoreStateData) =>
					(
						{
							...currentStoreStateData,
							...parametersBatchObj
						}
					)
				),
			}
		),
		{
			// Persist 持久化設定 (使用 sessionStorage 快取) (符合規範 g)
			name: 'privacy-app-storage', 
			storage: createJSONStorage(() => sessionStorage), 
			partialize: (currentStoreStateData) => ({
				isAuthenticated: currentStoreStateData.isAuthenticated,
				user: currentStoreStateData.user,
				isDarkMode: currentStoreStateData.isDarkMode,
				language: currentStoreStateData.language,

				sessionTimeout: currentStoreStateData.sessionTimeout,
				maxFailedLogins: currentStoreStateData.maxFailedLogins,
				isMaintenanceMode: currentStoreStateData.isMaintenanceMode,
				isPasswordExpired: currentStoreStateData.isPasswordExpired, 
				
				enablePasswordExpiry: currentStoreStateData.enablePasswordExpiry,
				passwordExpiryDays: currentStoreStateData.passwordExpiryDays,

				currentStep: currentStoreStateData.currentStep,
				privacyMode: currentStoreStateData.privacyMode,
				fileName: currentStoreStateData.fileName,
				columns: currentStoreStateData.columns,
				previewData: currentStoreStateData.previewData, 
				columnRoles: currentStoreStateData.columnRoles,
				columnTypes: currentStoreStateData.columnTypes,
				dpFields: currentStoreStateData.dpFields,

				kAnonymityFields: currentStoreStateData.kAnonymityFields,
				kAnonymityHierarchies: currentStoreStateData.kAnonymityHierarchies,
				fieldAttributes: currentStoreStateData.fieldAttributes,
				maskingRules: currentStoreStateData.maskingRules,
				generalizationRules: currentStoreStateData.generalizationRules,
				categoricalHierarchies: currentStoreStateData.categoricalHierarchies,
				numericBins: currentStoreStateData.numericBins,
				temporalHierarchies: currentStoreStateData.temporalHierarchies,
				
				kValue: currentStoreStateData.kValue,
				epsilon: currentStoreStateData.epsilon,
			}),
		}
	)
);