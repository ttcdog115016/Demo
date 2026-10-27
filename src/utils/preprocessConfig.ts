/**
 * 檔案名稱 (File): preprocessConfig.ts
 * 模組功能 (Description): 把 Step2「資料預先處理」的設定（清洗步驟、缺失值處理）轉成後端 /api/v1/preprocess
 *                         設定檔的 preprocess 區塊。
 *
 * ★ 2026-10-27：最終版後端（v2.0.0）提供 POST /api/v1/preprocess，Step4 於去識別化前先呼叫一次，
 *   之後的去識別化、風險評估都以清洗後的資料進行。對照後端 app/engines/preprocess/actions/*.py：
 *
 *   前端動作（參數）                         → 後端 action（params）
 *   trim（mode edges／all）                  → trim（mode）
 *   slice（direction left／right, count）    → slice（side, count）
 *   anchor_truncate（anchor, direction front／back, keepCount）
 *                                            → anchor_truncate（anchor, direction before／after, keep）
 *   type_cast（targetType integer／float／boolean）
 *                                            → cast（type int＋rounding round／float／bool＋true_values／false_values）
 *   normalize（caseMode, widthMode）          → normalize（case upper／lower, width half）；兩者皆「不轉換」時略過
 *   clamp（min, max）                        → clamp（min, max）
 *   hash（algorithm, seedMode, seedValue）   → hash（salt）；演算法為整份清單共用的區塊層參數 algorithm
 *        seedMode none   → 不帶 salt（使用伺服器 .env 預設鹽值，未設定則不加鹽）
 *        seedMode fixed  → salt＝自訂鹽值
 *        seedMode random → salt＝use_timestamp（伺服器於本次處理取一個時間戳當鹽，所有欄位共用）
 *   regex_replace（pattern, placeholder）    → regex_replace（pattern, replacement）
 *   缺失值 drop／constant／fill               → drop_nulls／fill_default（value）／impute（strategy ffill／bfill／interpolate／mean）
 *
 *   同一欄位的順序：先清洗步驟、最後才處理缺失值——與 Step2 預覽相同（清洗步驟不動空格，缺失值另行補值／刪列）。
 */
import type { PreprocessingRule, MissingValueRule } from '../store/useWorkspaceStore';

export type PreprocessHashAlgorithm = 'sha256' | 'sha3-256' | 'sha3-512';
export const DEFAULT_PREPROCESS_HASH_ALGORITHM: PreprocessHashAlgorithm = 'sha256';

/** 型態轉換為布林時的對照表（比對忽略大小寫；表外的值後端原樣不動） */
export const PREPROCESS_BOOLEAN_TRUE_VALUES = ['true', '1', 'yes', 'y'] as const;
export const PREPROCESS_BOOLEAN_FALSE_VALUES = ['false', '0', 'no', 'n'] as const;

/** 伺服器於本次處理取時間戳當鹽值的保留字（後端 masking.py 的 TIMESTAMP_SALT_KEYWORD） */
export const PREPROCESS_TIMESTAMP_SALT_KEYWORD = 'use_timestamp';

/**
 * 函數名稱: normalizePreprocessHashAlgorithm
 * 函數功能: 畫面／舊設定檔的演算法值 → 後端支援的三種。舊版選項 SHA256 → sha256；
 *           SHA512（SHA-2，後端不支援）與 SHA3-512 → sha3-512；SHA3-256 → sha3-256；其餘 → sha256。
 */
export const normalizePreprocessHashAlgorithm = (algorithmValue: unknown): PreprocessHashAlgorithm =>
{
	const normalizedText = String(algorithmValue ?? '').trim().toLowerCase().replace(/_/g, '-');
	if (normalizedText === 'sha3-256') return 'sha3-256';
	if (normalizedText === 'sha3-512' || normalizedText === 'sha512' || normalizedText === 'sha-512') return 'sha3-512';
	return 'sha256';
};

export interface BackendPreprocessAction
{
	action: string;
	params: Record<string, unknown>;
}

export interface BackendPreprocessBlock
{
	enabled: true;
	algorithm: PreprocessHashAlgorithm;
	columns: { column: string; actions: BackendPreprocessAction[] }[];
}

const toFiniteNumberOrUndefined = (rawValue: unknown): number | undefined =>
{
	if (rawValue === undefined || rawValue === null || rawValue === '') return undefined;
	const numericValue = Number(rawValue);
	return Number.isFinite(numericValue) ? numericValue : undefined;
};

/**
 * 函數名稱: convertPreprocessStep
 * 函數功能: 單一清洗步驟 → 後端動作；「不處理」或沒有實際效果的步驟回傳 null（不送出）。
 */
export const convertPreprocessStep = (stepItem: PreprocessingRule): BackendPreprocessAction | null =>
{
	const params = stepItem.params || {};
	switch (stepItem.action)
	{
		case 'trim':
			return { action: 'trim', params: { mode: params.mode === 'all' ? 'all' : 'edges' } };
		case 'slice':
		{
			const countValue = Math.floor(Number(params.count) || 0);
			if (countValue < 1) return null; // 刪 0 個字等於沒做（後端要求 ≥ 1）
			return { action: 'slice', params: { side: params.direction === 'right' ? 'right' : 'left', count: countValue } };
		}
		case 'anchor_truncate':
			return {
				action: 'anchor_truncate',
				params: {
					anchor: String(params.anchor ?? ''),
					direction: params.direction === 'back' ? 'after' : 'before',
					keep: Math.max(0, Math.floor(Number(params.keepCount) || 0)),
				},
			};
		case 'type_cast':
		{
			if (params.targetType === 'boolean')
			{
				return { action: 'cast', params: { type: 'bool', true_values: [...PREPROCESS_BOOLEAN_TRUE_VALUES], false_values: [...PREPROCESS_BOOLEAN_FALSE_VALUES] } };
			}
			if (params.targetType === 'float') return { action: 'cast', params: { type: 'float' } };
			// 整數：有小數時四捨五入（未指定 rounding 時後端遇到小數會報錯）
			return { action: 'cast', params: { type: 'int', rounding: 'round' } };
		}
		case 'normalize':
		{
			const normalizeParams: Record<string, string> = {};
			if (params.caseMode === 'upper' || params.caseMode === 'lower') normalizeParams.case = String(params.caseMode);
			if (params.widthMode === 'full_to_half') normalizeParams.width = 'half';
			return Object.keys(normalizeParams).length > 0 ? { action: 'normalize', params: normalizeParams } : null;
		}
		case 'clamp':
		{
			const clampParams: Record<string, number> = {};
			const minValue = toFiniteNumberOrUndefined(params.min);
			const maxValue = toFiniteNumberOrUndefined(params.max);
			if (minValue !== undefined) clampParams.min = minValue;
			if (maxValue !== undefined) clampParams.max = maxValue;
			return Object.keys(clampParams).length > 0 ? { action: 'clamp', params: clampParams } : null;
		}
		case 'hash':
		{
			const seedModeText = String(params.seedMode || 'none');
			if (seedModeText === 'fixed') return { action: 'hash', params: { salt: String(params.seedValue ?? '') } };
			if (seedModeText === 'random' || seedModeText === 'timestamp') return { action: 'hash', params: { salt: PREPROCESS_TIMESTAMP_SALT_KEYWORD } };
			return { action: 'hash', params: {} };
		}
		case 'regex_replace':
			return {
				action: 'regex_replace',
				params: { pattern: String(params.pattern ?? ''), replacement: params.placeholder !== undefined ? String(params.placeholder) : '***' },
			};
		default:
			return null;
	}
};

/**
 * 函數名稱: convertMissingValueRule
 * 函數功能: 缺失值處理規則 → 後端動作；「不處理」回傳 null。
 *           常數填充的值若是數字就以數字送出（後端照設定檔的型別填，數值欄填文字會變成混合型別）。
 */
export const convertMissingValueRule = (missingRule: MissingValueRule | undefined): BackendPreprocessAction | null =>
{
	if (!missingRule || missingRule.strategy === 'none') return null;
	if (missingRule.strategy === 'drop') return { action: 'drop_nulls', params: {} };
	if (missingRule.strategy === 'constant')
	{
		const constantText = missingRule.constantValue ?? '';
		const numericValue = constantText.trim() !== '' ? Number(constantText) : NaN;
		return { action: 'fill_default', params: { value: Number.isFinite(numericValue) ? numericValue : constantText } };
	}
	const strategyByFillMethod: Record<NonNullable<MissingValueRule['fillMethod']>, string> = {
		forward: 'ffill', backward: 'bfill', interpolate: 'interpolate', mean: 'mean',
	};
	return { action: 'impute', params: { strategy: strategyByFillMethod[missingRule.fillMethod ?? 'mean'] } };
};

/**
 * 函數名稱: buildPreprocessBlock
 * 函數功能: 依欄位順序組出 preprocess 區塊；沒有任何需要處理的欄位時回傳 null（Step4 即略過前處理）。
 *
 * 輸入參數 (Input):
 *   - columnNames: 資料集欄位（決定輸出順序；設定中但資料集沒有的欄位不送出）
 *   - preprocessingRules: 各欄位清洗步驟
 *   - missingValueRules: 各欄位缺失值處理
 */
export const buildPreprocessBlock = (
	columnNames: string[],
	preprocessingRules: Record<string, PreprocessingRule[]> | null | undefined,
	missingValueRules: Record<string, MissingValueRule> | null | undefined
): BackendPreprocessBlock | null =>
{
	const ownValue = <ValueType,>(sourceMap: Record<string, ValueType> | null | undefined, keyName: string): ValueType | undefined =>
		sourceMap && Object.prototype.hasOwnProperty.call(sourceMap, keyName) ? sourceMap[keyName] : undefined;

	let hashAlgorithm: PreprocessHashAlgorithm | null = null;
	const columnEntries: BackendPreprocessBlock['columns'] = [];
	for (const columnName of columnNames)
	{
		const stepList = ownValue(preprocessingRules, columnName);
		const actionList: BackendPreprocessAction[] = [];
		for (const stepItem of Array.isArray(stepList) ? stepList : [])
		{
			const convertedAction = convertPreprocessStep(stepItem);
			if (!convertedAction) continue;
			if (convertedAction.action === 'hash' && hashAlgorithm === null) hashAlgorithm = normalizePreprocessHashAlgorithm(stepItem.params?.algorithm);
			actionList.push(convertedAction);
			if (stepItem.action === 'hash') break; // 雜湊為終點，與畫面預覽一致
		}
		const missingAction = convertMissingValueRule(ownValue(missingValueRules, columnName));
		if (missingAction) actionList.push(missingAction);
		if (actionList.length > 0) columnEntries.push({ column: columnName, actions: actionList });
	}

	if (columnEntries.length === 0) return null;
	return { enabled: true, algorithm: hashAlgorithm ?? DEFAULT_PREPROCESS_HASH_ALGORITHM, columns: columnEntries };
};
