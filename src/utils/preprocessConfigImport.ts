/**
 * 檔案名稱 (File): preprocessConfigImport.ts
 * 模組功能 (Description): 讀取後端設定檔的 preprocess 區塊（單一入口 config_preprocess.json、統合版 config_範例_JSON統合版.json、
 *                         本工具匯出檔），轉回 Step2「資料預先處理」的清洗步驟與缺失值處理。
 *
 * ★ 2026-10-28：期末交付包附了前處理測資與統合版設定檔，但 Step2「匯入設定檔」只認得本工具舊版的 preprocessing_rules，
 *   後端格式的 preprocess 區塊完全讀不進來；純前處理設定檔匯入 K-匿名頁甚至會把欄位設定清空。
 *   與 utils/preprocessConfig.ts（匯出／送後端）互為反向：
 *
 *   後端 action（params）                         → 前端動作（參數）
 *   trim（mode）                                  → trim（mode）
 *   slice（side, count）                          → slice（direction, count）
 *   anchor_truncate（anchor, direction before／after, keep）→ anchor_truncate（anchor, direction front／back, keepCount）
 *   cast（type int／float／bool）                  → type_cast（targetType integer／float／boolean）
 *   normalize（case, width half）                  → normalize（caseMode, widthMode full_to_half）
 *   clamp（min, max）                             → clamp（min, max）；沒給的一側存空字串（不限制）
 *   hash（salt）＋區塊層 algorithm                 → hash（algorithm, seedMode none／fixed／random, seedValue）
 *   regex_replace（pattern, replacement）          → regex_replace（pattern, placeholder）
 *   drop_nulls／fill_default（value）／impute（strategy）→ 缺失值 drop／constant／fill（fillMethod）
 *
 *   前端畫面表達不了的寫法（例如轉整數用無條件捨去、半形轉全形、雜湊之後還有步驟）照最接近的方式讀入，並列在 warnings。
 */
import type { PreprocessingRule, MissingValueRule } from '../store/useWorkspaceStore';
import { normalizePreprocessHashAlgorithm, PREPROCESS_TIMESTAMP_SALT_KEYWORD, PREPROCESS_BOOLEAN_TRUE_VALUES, PREPROCESS_BOOLEAN_FALSE_VALUES } from './preprocessConfig';
import type { PreprocessHashAlgorithm } from './preprocessConfig';
import { buildDatasetColumnNameSet, isFieldNameInDataset, normalizeDatasetColumnName } from './datasetFieldConsistency';

/** 後端 preprocess 區塊未填 algorithm 時的預設（後端 2.0.0 設定檔說明 3-1 節） */
export const BACKEND_DEFAULT_PREPROCESS_HASH_ALGORITHM: PreprocessHashAlgorithm = 'sha3-256';

export interface PreprocessImportResult
{
	preprocessingRules: Record<string, PreprocessingRule[]>;   // 各欄清洗步驟（依設定檔順序）
	missingValueRules: Record<string, MissingValueRule>;       // 各欄缺失值處理
	columnNames: string[];                                     // 設定檔中有處理的欄位（依首次出現順序）
	warnings: string[];                                        // 無法照原樣表達、已調整或略過的項目（中文說明）
	disabled: boolean;                                         // 區塊 enabled 為 false（未匯入任何規則）
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** 設定檔是否帶有後端格式的 preprocess 區塊 */
export const hasBackendPreprocessBlock = (parsedJson: unknown): boolean =>
	isPlainObject(parsedJson) && isPlainObject(parsedJson.preprocess);

const MISSING_VALUE_ACTIONS = new Set(['drop_nulls', 'fill_default', 'impute']);
const IMPUTE_STRATEGY_TO_FILL_METHOD: Record<string, NonNullable<MissingValueRule['fillMethod']>> = {
	ffill: 'forward', bfill: 'backward', interpolate: 'interpolate', mean: 'mean',
};

const sameValueSet = (left: unknown, right: readonly string[]): boolean =>
{
	if (!Array.isArray(left)) return false;
	const normalizedLeft = new Set(left.map((item) => String(item).trim().toLowerCase()));
	return normalizedLeft.size === right.length && right.every((item) => normalizedLeft.has(item));
};

/**
 * 函數名稱: convertBackendActionToStep
 * 函數功能: 後端單一清洗動作 → 前端清洗步驟；無法辨識時回傳 null。調整之處寫入 warnings。
 */
const convertBackendActionToStep = (
	columnName: string, actionName: string, params: Record<string, unknown>,
	hashAlgorithm: PreprocessHashAlgorithm, warnings: string[]
): PreprocessingRule | null =>
{
	switch (actionName)
	{
		case 'trim':
			return { action: 'trim', params: { mode: params.mode === 'all' ? 'all' : 'edges' } };
		case 'slice':
			return { action: 'slice', params: { direction: params.side === 'right' ? 'right' : 'left', count: Math.max(1, Math.floor(Number(params.count) || 1)) } };
		case 'anchor_truncate':
			return {
				action: 'anchor_truncate',
				params: {
					anchor: String(params.anchor ?? ''),
					direction: params.direction === 'after' ? 'back' : 'front',
					keepCount: Math.max(0, Math.floor(Number(params.keep) || 0)),
				},
			};
		case 'cast':
		{
			const castType = String(params.type ?? '').toLowerCase();
			if (castType === 'float') return { action: 'type_cast', params: { targetType: 'float' } };
			if (castType === 'bool')
			{
				if (!sameValueSet(params.true_values, PREPROCESS_BOOLEAN_TRUE_VALUES) || !sameValueSet(params.false_values, PREPROCESS_BOOLEAN_FALSE_VALUES))
				{
					warnings.push(`「${columnName}」轉布林的對照值改用本工具固定的 true/1/yes/y、false/0/no/n`);
				}
				return { action: 'type_cast', params: { targetType: 'boolean' } };
			}
			if (castType === 'int')
			{
				if (params.rounding !== undefined && params.rounding !== 'round')
				{
					warnings.push(`「${columnName}」轉整數的進位方式 ${String(params.rounding)} 改為四捨五入（本工具僅支援四捨五入）`);
				}
				return { action: 'type_cast', params: { targetType: 'integer' } };
			}
			warnings.push(`「${columnName}」型態轉換的目標型態「${String(params.type)}」無法辨識，已略過`);
			return null;
		}
		case 'normalize':
		{
			const caseMode = params.case === 'upper' || params.case === 'lower' ? String(params.case) : 'none';
			let widthMode = 'none';
			if (params.width === 'half') widthMode = 'full_to_half';
			else if (params.width === 'full') warnings.push(`「${columnName}」文字正規化的「半形轉全形」本工具不支援，已略過該項`);
			if (caseMode === 'none' && widthMode === 'none') return null;
			return { action: 'normalize', params: { caseMode, widthMode } };
		}
		case 'clamp':
		{
			const toBoundValue = (rawValue: unknown): number | '' =>
			{
				if (rawValue === undefined || rawValue === null || rawValue === '') return '';
				const numericValue = Number(rawValue);
				return Number.isFinite(numericValue) ? numericValue : '';
			};
			return { action: 'clamp', params: { min: toBoundValue(params.min), max: toBoundValue(params.max) } };
		}
		case 'hash':
		{
			const saltValue = params.salt === undefined || params.salt === null ? '' : String(params.salt);
			if (saltValue === '') return { action: 'hash', params: { algorithm: hashAlgorithm, seedMode: 'none' } };
			if (saltValue === PREPROCESS_TIMESTAMP_SALT_KEYWORD) return { action: 'hash', params: { algorithm: hashAlgorithm, seedMode: 'random' } };
			return { action: 'hash', params: { algorithm: hashAlgorithm, seedMode: 'fixed', seedValue: saltValue } };
		}
		case 'regex_replace':
			return { action: 'regex_replace', params: { pattern: String(params.pattern ?? ''), placeholder: params.replacement === undefined || params.replacement === null ? '' : String(params.replacement) } };
		default:
			warnings.push(`「${columnName}」的處理動作「${actionName}」無法辨識，已略過`);
			return null;
	}
};

/** 後端缺失值動作 → 前端缺失值處理 */
const convertBackendMissingAction = (columnName: string, actionName: string, params: Record<string, unknown>, warnings: string[]): MissingValueRule | null =>
{
	if (actionName === 'drop_nulls') return { strategy: 'drop' };
	if (actionName === 'fill_default') return { strategy: 'constant', constantValue: params.value === undefined || params.value === null ? '' : String(params.value) };
	const fillMethod = IMPUTE_STRATEGY_TO_FILL_METHOD[String(params.strategy ?? '')];
	if (!fillMethod)
	{
		warnings.push(`「${columnName}」策略填充方式「${String(params.strategy)}」無法辨識，已略過`);
		return null;
	}
	return { strategy: 'fill', fillMethod };
};

/**
 * 函數名稱: parseBackendPreprocessBlock
 * 函數功能: 後端 preprocess 區塊 → 前端清洗步驟與缺失值處理。
 *   - 同一欄位在清單出現多次時依序接續（後端由上往下執行）。
 *   - 前端每欄只有一個缺失值處理、且固定在清洗步驟之後執行：設定檔中缺失值動作若不在該欄最後，或同欄有多個，提示並以最後一個為準。
 *   - 前端雜湊為最後一步：雜湊之後的清洗步驟略過並提示。
 */
export const parseBackendPreprocessBlock = (preprocessBlock: unknown): PreprocessImportResult =>
{
	const result: PreprocessImportResult = { preprocessingRules: {}, missingValueRules: {}, columnNames: [], warnings: [], disabled: false };
	if (!isPlainObject(preprocessBlock)) return result;
	if (preprocessBlock.enabled === false)
	{
		result.disabled = true;
		return result;
	}

	const hashAlgorithm = preprocessBlock.algorithm === undefined || preprocessBlock.algorithm === null || preprocessBlock.algorithm === ''
		? BACKEND_DEFAULT_PREPROCESS_HASH_ALGORITHM
		: normalizePreprocessHashAlgorithm(preprocessBlock.algorithm);

	const columnEntries = Array.isArray(preprocessBlock.columns) ? preprocessBlock.columns : [];
	const missingActionCountByColumn: Record<string, number> = {};
	const cleaningAfterMissingColumns = new Set<string>();
	const stepsAfterHashColumns = new Set<string>();

	for (const columnEntry of columnEntries)
	{
		if (!isPlainObject(columnEntry)) continue;
		const columnName = normalizeDatasetColumnName(columnEntry.column);
		if (!columnName) continue;
		if (!result.columnNames.includes(columnName)) result.columnNames.push(columnName);

		const actionList = Array.isArray(columnEntry.actions) ? columnEntry.actions : [];
		for (const actionEntry of actionList)
		{
			if (!isPlainObject(actionEntry)) continue;
			const actionName = String(actionEntry.action ?? '').trim();
			const actionParams = isPlainObject(actionEntry.params) ? actionEntry.params : {};

			if (MISSING_VALUE_ACTIONS.has(actionName))
			{
				const missingRule = convertBackendMissingAction(columnName, actionName, actionParams, result.warnings);
				if (missingRule)
				{
					result.missingValueRules[columnName] = missingRule;
					missingActionCountByColumn[columnName] = (missingActionCountByColumn[columnName] || 0) + 1;
				}
				continue;
			}

			const existingSteps = result.preprocessingRules[columnName] || [];
			if (existingSteps.some((stepItem) => stepItem.action === 'hash'))
			{
				stepsAfterHashColumns.add(columnName);
				continue;
			}
			const convertedStep = convertBackendActionToStep(columnName, actionName, actionParams, hashAlgorithm, result.warnings);
			if (!convertedStep) continue;
			if (result.missingValueRules[columnName]) cleaningAfterMissingColumns.add(columnName);
			result.preprocessingRules[columnName] = [...existingSteps, convertedStep];
		}
	}

	Object.entries(missingActionCountByColumn).forEach(([columnName, actionCount]) =>
	{
		if (actionCount > 1) result.warnings.push(`「${columnName}」有 ${actionCount} 個缺失值處理，本工具每欄只能設定一個，已採用最後一個`);
	});
	cleaningAfterMissingColumns.forEach((columnName) =>
		result.warnings.push(`「${columnName}」的缺失值處理在設定檔中排在清洗步驟之前，本工具一律先清洗、最後才處理缺失值`));
	stepsAfterHashColumns.forEach((columnName) =>
		result.warnings.push(`「${columnName}」雜湊之後的步驟已略過（本工具雜湊須為最後一步）`));

	return result;
};

export interface PreprocessImportForDataset extends PreprocessImportResult
{
	skippedColumnNames: string[];   // 設定檔有、但目前資料沒有的欄位（未匯入）
}

/**
 * 函數名稱: importPreprocessFromConfig
 * 函數功能: 從整份設定檔取出 preprocess 區塊並轉換；已上傳資料時只保留資料中存在的欄位。
 * 返回值: 沒有 preprocess 區塊時回傳 null。
 */
export const importPreprocessFromConfig = (parsedJson: unknown, datasetColumnNames: readonly string[] | null | undefined): PreprocessImportForDataset | null =>
{
	if (!hasBackendPreprocessBlock(parsedJson)) return null;
	const parsedResult = parseBackendPreprocessBlock((parsedJson as Record<string, unknown>).preprocess);
	if (!datasetColumnNames || datasetColumnNames.length === 0) return { ...parsedResult, skippedColumnNames: [] };

	const datasetColumnNameSet = buildDatasetColumnNameSet(datasetColumnNames);
	// 規則以資料實際的欄位名稱為鍵（資料表頭可能帶 BOM，Step2 依原始欄名查規則）
	const datasetNameByNormalized = new Map(datasetColumnNames.map((rawName) => [normalizeDatasetColumnName(rawName), rawName] as const));
	const keptColumnNames = parsedResult.columnNames.filter((columnName) => isFieldNameInDataset(columnName, datasetColumnNameSet));
	const skippedColumnNames = parsedResult.columnNames.filter((columnName) => !isFieldNameInDataset(columnName, datasetColumnNameSet));
	const pickColumns = <ValueType,>(sourceMap: Record<string, ValueType>): Record<string, ValueType> =>
		Object.fromEntries(Object.entries(sourceMap)
			.filter(([columnName]) => keptColumnNames.includes(columnName))
			.map(([columnName, value]) => [datasetNameByNormalized.get(columnName) ?? columnName, value]));

	return {
		...parsedResult,
		preprocessingRules: pickColumns(parsedResult.preprocessingRules),
		missingValueRules: pickColumns(parsedResult.missingValueRules),
		columnNames: keptColumnNames.map((columnName) => datasetNameByNormalized.get(columnName) ?? columnName),
		skippedColumnNames,
	};
};

/**
 * 函數名稱: describePreprocessImport
 * 函數功能: 匯入結果 → 畫面提示文字（成功一則、其餘為警告）。
 */
export const describePreprocessImport = (importResult: PreprocessImportForDataset): { summary: string; warnings: string[] } =>
{
	const warnings = [...importResult.warnings];
	if (importResult.skippedColumnNames.length > 0)
	{
		warnings.unshift(`資料預先處理：已略過 ${importResult.skippedColumnNames.length} 個資料中沒有的欄位：${importResult.skippedColumnNames.join('、')}`);
	}
	if (importResult.disabled) return { summary: '設定檔的資料預先處理區塊未啟用（enabled: false），未匯入清洗設定', warnings };
	return { summary: `已匯入資料預先處理設定（${importResult.columnNames.length} 個欄位）`, warnings };
};
