/**
 * ============================================================================
 * 檔案名稱 (File): validateProgression.ts
 * 模組功能 (Description): 步驟切換進度校驗工具函式 (提供使用者跨步驟切換、下一步跳頁時之前置必填門閥驗證)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, type DPField } from '../../store/useWorkspaceStore';
import { isDpFieldSelectableAsRiskSensitive } from '../../utils/riskAssessment';
import { resolveIsDateTimeDpField } from '../../utils/dpFieldHelpers';
import { findDeclaredTypeConflicts, type DeclaredTypedColumn } from '../../utils/columnTypeConsistency';
import { findFieldsNotInDataset, countBlankFieldNames, describeFieldsNotInDatasetError, describeBlankFieldNamesError } from '../../utils/datasetFieldConsistency';

/**
 * 預設步驟驗證門檻常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 * 
 * 詳細說明:
 * 定義跳轉與導航時的數學邊界與步驟索引檢查點，以確保使用者遵循預設的工作流方向進行操作。
 */
const MAX_ALLOWED_STEP_JUMP_COUNT = 1;
const STEP_INDEX_MAPPING_REQUIREMENT = 1;
const STEP_INDEX_RULES_REQUIREMENT = 2;
const STEP_INDEX_RESULT_REQUIREMENT = 3;

/**
 * 多國語系翻譯函式型別定義
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
type TranslateFunction = ReturnType<typeof useTranslation>['t'];

/**
 * 工作區全域狀態型別定義
 * 規範對照: 符合規範 h) 資料結構宣告註記
 */
type WorkspaceState = ReturnType<typeof useWorkspaceStore.getState>;

/**
 * 函數名稱: validateProgression
 * 函數功能: 驗證使用者跳轉至目標步驟 (targetStepIndexValue) 時前置條件是否已完全符合，防範未上傳檔案、未標記間接識別碼或 DP 參數不完整即跨步跳轉。
 * 
 * 輸入參數 (Input):
 *   - targetStepIndexValue (number): 使用者欲跳轉之目標步驟索引 (0 ~ 3)
 *   - currentStepIndexValue (number): 當前所在之步驟索引 (0 ~ 3)
 *   - currentWorkspaceStoreStateData (WorkspaceState): 全域 WorkspaceStore 當前狀態快照物件
 *   - translateFunction (TranslateFunction): i18n 多國語系翻譯轉換函式
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - string | null: 驗證失敗時回傳多國語系錯誤提示訊息字串，若驗證通過則回傳 null
 * 呼叫關係 (Call Relations): 
 *   - 被 MainLayout.tsx 中的 handleStepClick 與 handleNext 步驟導航事件所呼叫
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export const validateProgression = (
	targetStepIndexValue: number, 
	currentStepIndexValue: number, 
	currentWorkspaceStoreStateData: WorkspaceState, 
	translateFunction: TranslateFunction
): string | null => 
{
	// ============================================================================
	// 1. 基礎跨步防呆關卡
	// 規範對照: 符合規範 g) 處理異常行為防止不合理跳躍
	// ============================================================================
	
	// 禁止跨越超過 1 個步驟之向前跳躍式導航 (向後回退不受限制)
	if (targetStepIndexValue > currentStepIndexValue + MAX_ALLOWED_STEP_JUMP_COUNT) 
	{
		return translateFunction('message.no_skip', '為確保資料安全，請循序漸進完成設定，勿跳躍步驟');
	}

	// ============================================================================
	// 2. 解構提取 WorkspaceStore 狀態資料，減少後續程式碼長度
	// ============================================================================
	const { 
		columns: datasetColumnsListArray, 
		privacyMode: currentPrivacyModeTypeStr, 
		columnRoles: columnPrivacyRolesMapDict, 
		dpFields: currentDpFieldsListArray 
	} = currentWorkspaceStoreStateData;

	// ============================================================================
	// 3. 門閥 1 校驗：欲進入「步驟二：屬性對應」或後續步驟
	// 規則: 必須已完成資料上傳，且已選擇防護模式
	// ============================================================================
	if (targetStepIndexValue >= STEP_INDEX_MAPPING_REQUIREMENT) 
	{
		// 檢查欄位陣列是否存在且長度大於零
		if (!datasetColumnsListArray || datasetColumnsListArray.length === 0) 
		{
			return translateFunction('message.require_import', '請先完成資料匯入！');
		}

		// 檢查隱私防護模式 (K-Anonymity 或 Differential Privacy) 是否已勾選
		if (!currentPrivacyModeTypeStr) 
		{
			return translateFunction('message.require_mode', '請先選擇隱私防護模式！');
		}
	}

	// ============================================================================
	// 4. 門閥 2 校驗：欲進入「步驟三：隱私設定」或後續步驟
	// 規則: 必須依據所選模式，完成欄位角色標註或對應的 DP 參數配置
	// ============================================================================
	if (targetStepIndexValue >= STEP_INDEX_RULES_REQUIREMENT) 
	{
		// ★ 2026-10-07：Step2 欄位清單須與上傳資料一致（規則見 utils/datasetFieldConsistency.ts）。
		//   頁面本身已顯示錯誤並提供「移除不存在的欄位」；此處再擋一次，涵蓋側欄／網址直接跳轉。
		//   放在 QI／敏感欄位檢查之前：不存在的欄位也會被同步進 columnRoles，可能讓 QI 檢查誤判通過。
		const configuredFieldNamesList: unknown[] = currentPrivacyModeTypeStr === 'k-anonymity'
			? ((currentWorkspaceStoreStateData.kAnonymityFields || []) as Array<Record<string, unknown>>).map((fieldRecord) => fieldRecord.name)
			: (currentDpFieldsListArray || []).map((dpFieldItemRecord) => dpFieldItemRecord.fieldName);
		if (currentPrivacyModeTypeStr === 'k-anonymity')
		{
			const blankFieldNameCount = countBlankFieldNames(configuredFieldNamesList);
			if (blankFieldNameCount > 0)
			{
				return translateFunction('step2.blank_field_name_error', describeBlankFieldNamesError(blankFieldNameCount));
			}
		}
		const fieldsNotInDatasetNamesList = findFieldsNotInDataset(configuredFieldNamesList, datasetColumnsListArray);
		if (fieldsNotInDatasetNamesList.length > 0)
		{
			return describeFieldsNotInDatasetError(fieldsNotInDatasetNamesList);
		}

		if (currentPrivacyModeTypeStr === 'k-anonymity') 
		{
			// 針對 K-Anonymity 模式：提取所有欄位目前被分配的角色清單
			const assignedPrivacyRolesListArray = Object.values(columnPrivacyRolesMapDict || {});

			// 檢查是否至少標記了一個「間接識別碼 (Quasi-identifier)」
			const hasQuasiIdentifierMarkedStatus = assignedPrivacyRolesListArray.some(
				(roleNameString) => roleNameString === 'Quasi-identifier'
			);
			
			if (!hasQuasiIdentifierMarkedStatus) 
			{
				return translateFunction('message.require_qi', '請至少將一個欄位標記為「間接識別碼」才能進入隱私設定！');
			}

			// ★ 2026-10-30：敏感欄位改為選填（2026-10-02 曾改為必填）。後端去識別化不需要敏感欄位，
			//   只有 l／t 檢測（Step3 KAnonymityRules 啟用 l／t 時另擋）與三攻擊／CAP（Step4 沒有敏感欄位即略過）用到。

			// ★ 新增: 「屬性對應」頁面 (KAnonymityMapping.tsx) 本身已會計算欄位層級的細部防呆 (例如
			//   Quasi-identifier 選擇「階層樹 (Tree)」泛化策略卻未於「泛化階層映射」設定任何有效對應、
			//   Identifier 選擇「保留部分字元」卻未填寫保留字數、泛化參數 <= 0、預處理步驟參數缺漏等)，
			//   並透過 setStepValidation 寫入全域 isStepValid/stepErrorMessage；但先前本門閥並未讀取
			//   該旗標，導致上述任一設定不完整時使用者仍可點擊「下一步」跳過，傳至後端執行時才出錯。
			//   此處補上檢查，確保離開「屬性對應」頁面時，該頁面自身認定之驗證狀態亦須合法。
			if (!currentWorkspaceStoreStateData.isStepValid && currentStepIndexValue === STEP_INDEX_MAPPING_REQUIREMENT) 
			{
				return currentWorkspaceStoreStateData.stepErrorMessage || translateFunction('message.complete_current_step', '請完成當前步驟的必填設定');
			}
		} 
		else 
		{
			// 針對 Differential Privacy (差分隱私) 模式嚴格校驗邏輯
			const typedDpFieldsListArray: DPField[] = currentDpFieldsListArray || [];
			
			// 子關卡 A：檢查是否至少有一個欄位啟用了 DP 處理機制
			const hasActiveDPFieldItemStatus = typedDpFieldsListArray.some(
				(dpFieldItemRecord) => dpFieldItemRecord.enabled
			);

			if (!hasActiveDPFieldItemStatus) 
			{
				return translateFunction('message.dp_require_at_least_one', '請至少選擇一個欄位啟用差分隱私 (DP) 處理！');
			}
			
			// 子關卡 B：檢查所有已啟用 DP 之欄位，其細部屬性與邊界參數是否已填寫完備
			const hasIncompleteDPFieldSettingStatus = typedDpFieldsListArray.some(
				(dpFieldItemRecord) => 
				{
					// 若該欄位未啟用 DP，則跳過不檢查 (不會成為阻擋條件)
					if (!dpFieldItemRecord.enabled) 
					{
						return false; 
					}
					
					// 驗證規則 1: 必須選擇合法之資料型態 (不可為 Unknown 未定狀態)
					if (!dpFieldItemRecord.fieldType || dpFieldItemRecord.fieldType === 'Unknown') 
					{
						return true; // 回傳 true 代表「發現不完整的設定」
					}
					
					// 驗證規則 2: 若為連續數值型態 (Numeric)，必須提供合理之下限與上限邊界
					if (dpFieldItemRecord.fieldType === 'Numeric') 
					{
						const isLowerBoundMissingStatus = dpFieldItemRecord.lowerBound === undefined || dpFieldItemRecord.lowerBound === null || String(dpFieldItemRecord.lowerBound).trim() === '';

						const isUpperBoundMissingStatus = dpFieldItemRecord.upperBound === undefined || dpFieldItemRecord.upperBound === null || String(dpFieldItemRecord.upperBound).trim() === '';

						return isLowerBoundMissingStatus || isUpperBoundMissingStatus;
					} 
					// 驗證規則 3: 若為類別型態 (Categorical)，必須填寫允許之類別清單 (以逗號分隔或陣列)
					else if (dpFieldItemRecord.fieldType === 'Categorical') 
					{
						const isAllowedCategoriesArrayEmptyStatus = Array.isArray(dpFieldItemRecord.allowedCategories) ? dpFieldItemRecord.allowedCategories.length === 0 : false;
						
						const isAllowedCategoriesStringEmptyStatus = !Array.isArray(dpFieldItemRecord.allowedCategories) && String(dpFieldItemRecord.allowedCategories || '').trim() === '';

						return !dpFieldItemRecord.allowedCategories || isAllowedCategoriesArrayEmptyStatus || isAllowedCategoriesStringEmptyStatus;
					}

					return false;
				}
			);

			if (hasIncompleteDPFieldSettingStatus)
			{
				return translateFunction('message.dp_incomplete', '設定不完整：請先完成所有紅框標示的參數設定，才能進入下一步！');
			}

			// 子關卡 C（2026-10-02）：點選的風險評估敏感欄位須為類別型或連續數值型（數值型 Step4 會先分級距）。
			// ★ 2026-10-30：不再要求須有間接識別——沒有攻擊面時 Step2 顯示警告、Step4 略過三攻擊與 CAP（見 riskAssessment.hasDpRiskAttackSurface）
			const designatedRiskSensitiveFieldsList = typedDpFieldsListArray.filter((dpFieldItemRecord) => dpFieldItemRecord.isRiskSensitive);
			if (designatedRiskSensitiveFieldsList.some((dpFieldItemRecord) => !isDpFieldSelectableAsRiskSensitive(dpFieldItemRecord)))
			{
				return translateFunction('message.dp_risk_sensitive_numeric', '風險評估的敏感欄位須為類別型或連續數值型，文字型與日期時間型欄位不能設為敏感欄位！');
			}

			// ★ 邊界範圍是否涵蓋實際資料數值 (例如年齡邊界設為 0~1，但真實資料介於 20~80)，
			// 改回僅在 DifferentialPrivacyMapping.tsx 頁面內顯示橘色警告提示，不在此處阻擋跳轉——
			// 加噪前仍會依邊界裁剪，使用者可自行評估是否要擴大邊界範圍或維持現狀，不視為硬性錯誤。
		}

		// ★ 2026-10-05 第 2 級檢查：設為數值／日期的欄位，實際資料中不可有無法轉換的值（否則後端必定 422）。
		//   K-匿名：間接識別碼與敏感欄位（會被實際運算的欄位）；差分隱私：已啟用的連續數值型（含日期時間）。
		const declaredTypedColumnsList: DeclaredTypedColumn[] = currentPrivacyModeTypeStr === 'k-anonymity'
			? ((currentWorkspaceStoreStateData.kAnonymityFields || []) as Array<Record<string, unknown>>)
				.filter((fieldRecord) => (fieldRecord.role === 'Quasi-identifier' || fieldRecord.role === 'Sensitive') && (fieldRecord.type === 'numeric' || fieldRecord.type === 'temporal'))
				.map((fieldRecord) => ({ columnName: String(fieldRecord.name || ''), kind: fieldRecord.type === 'temporal' ? 'date' as const : 'numeric' as const }))
			: (currentDpFieldsListArray || [])
				.filter((dpFieldItemRecord) => dpFieldItemRecord.enabled && dpFieldItemRecord.fieldType === 'Numeric')
				.map((dpFieldItemRecord) => ({ columnName: dpFieldItemRecord.fieldName, kind: resolveIsDateTimeDpField(dpFieldItemRecord) ? 'date' as const : 'numeric' as const }));
		const declaredTypeConflictsList = findDeclaredTypeConflicts(declaredTypedColumnsList, currentWorkspaceStoreStateData.datasetProfile);
		if (declaredTypeConflictsList.length > 0)
		{
			const firstConflict = declaredTypeConflictsList[0];
			const typeLabel = firstConflict.kind === 'numeric' ? translateFunction('message.type_label_numeric', '數值') : translateFunction('message.type_label_date', '日期');
			const examplesText = firstConflict.examples.map((value) => `「${value}」`).join('、');
			const otherColumnsText = declaredTypeConflictsList.length > 1
				? translateFunction('message.type_conflict_others', { names: declaredTypeConflictsList.slice(1).map((conflictItem) => `「${conflictItem.columnName}」`).join('、') })
				: '';
			return firstConflict.badCount !== undefined
				? translateFunction('message.type_conflict_counted', { column: firstConflict.columnName, type: typeLabel, count: firstConflict.badCount, examples: examplesText, others: otherColumnsText })
				: translateFunction('message.type_conflict', { column: firstConflict.columnName, type: typeLabel, examples: examplesText, others: otherColumnsText });
		}
	}

	// ============================================================================
	// 5. 門閥 3 校驗：欲進入「步驟四：預覽匯出」最終階段
	// 規則: 檢核步驟三中，關於 K/L/T 參數與預處理正則表達式的防呆校驗是否已被標記為有效 (isStepValid = true)
	// ============================================================================
	if (targetStepIndexValue >= STEP_INDEX_RESULT_REQUIREMENT) 
	{
		// 確保前一步驟 (Step 3) 的狀態標記為合法，否則攔截並回傳由元件端生成的詳細錯誤訊息
		if (!currentWorkspaceStoreStateData.isStepValid && currentStepIndexValue === STEP_INDEX_RULES_REQUIREMENT) 
		{
			return currentWorkspaceStoreStateData.stepErrorMessage || translateFunction('message.complete_current_step', '請完成當前步驟的必填設定');
		}
	}

	// ============================================================================
	// 6. 最終放行
	// 若以上所有門閥均無攔截，則回傳 null 告知呼叫端驗證通過，允許導航跳轉。
	// ============================================================================
	return null; 
};