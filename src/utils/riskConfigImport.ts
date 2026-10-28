/**
 * 檔案名稱 (File): riskConfigImport.ts
 * 模組功能 (Description): 讀取設定檔的 risk_attacks／risk_cap 區塊（統合版 config_範例_JSON統合版.json、單一入口 config_risk_*.json），
 *                         轉成工作區的風險評估設定：欄位角色、連結性分組、對象族群限定條件、三攻擊實驗參數。
 *
 * ★ 2026-10-28：使用者決議（TTC Wei）——匯入後照設定檔評估：
 *   - 欄位角色：K-匿名、差分隱私兩種模式都改用設定檔的 risk_attacks.columns（Step3 可改回沿用原本推導）。
 *   - 實驗參數：照設定檔（Step3 可看可改、可還原前端預設）。設定檔一項都沒寫時不覆寫（維持前端預設）。
 *   前端 Step4 的三攻擊與 CAP 共用同一組欄位角色與族群條件：risk_cap 與 risk_attacks 不同時以 risk_attacks 為準並提示；
 *   只有 risk_cap 時改用 risk_cap 的欄位與族群條件。
 */
import type { RiskColumnOverrides, RiskLinkabilityGroups, RiskAttackParams, RiskSubgroupCondition } from '../store/useWorkspaceStore';
import { buildDatasetColumnNameSet, isFieldNameInDataset, normalizeDatasetColumnName } from './datasetFieldConsistency';

/**
 * 前端預設的三攻擊實驗參數（後端未填時 n_iter 為 500，前端為縮短運算時間刻意調低為 50）。
 * 原定義於 utils/riskAssessment.ts（該檔仍轉出同名常數），2026-10-28 移到這裡供匯入與 Step3 共用。
 */
export const RISK_ATTACK_DEFAULT_PARAMS: RiskAttackParams = {
    n_iter: 50,
    ctrl_ratio: 0.2,
    seed: 42,
    n_subset: 500,
    n_repeats: 1,
    overlap_ratio: 0.0
};

export const RISK_ATTACK_PARAM_KEYS = ['n_iter', 'ctrl_ratio', 'seed', 'n_subset', 'n_repeats', 'overlap_ratio'] as const;

/** 各參數的合法範圍（後端 2.0.0 設定檔說明第六節）：整數參數取整，比例參數 0～1 */
export const RISK_ATTACK_PARAM_RULES: Record<keyof RiskAttackParams, { min: number; max?: number; integer: boolean; maxExclusive?: boolean }> = {
    n_iter: { min: 1, integer: true },
    ctrl_ratio: { min: 0, max: 1, integer: false, maxExclusive: true },
    seed: { min: 0, integer: true },
    n_subset: { min: 1, integer: true },
    n_repeats: { min: 1, integer: true },
    overlap_ratio: { min: 0, max: 1, integer: false, maxExclusive: true },
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** 單一參數值是否合法 */
export const isValidRiskAttackParamValue = (paramKey: keyof RiskAttackParams, rawValue: unknown): rawValue is number => {
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) return false;
    const rule = RISK_ATTACK_PARAM_RULES[paramKey];
    if (rule.integer && !Number.isInteger(rawValue)) return false;
    if (rawValue < rule.min) return false;
    if (rule.max !== undefined && (rule.maxExclusive ? rawValue >= rule.max : rawValue > rule.max)) return false;
    return true;
};

/** 與前端預設完全相同時視為未覆寫 */
export const isDefaultRiskAttackParams = (params: RiskAttackParams | null | undefined): boolean =>
    !params || RISK_ATTACK_PARAM_KEYS.every((paramKey) => params[paramKey] === RISK_ATTACK_DEFAULT_PARAMS[paramKey]);

export interface RiskImportResult
{
    columnOverrides: RiskColumnOverrides | null;
    linkability: RiskLinkabilityGroups | null;
    subgroupFilters: Record<string, RiskSubgroupCondition> | null;   // null＝設定檔沒寫（不變更畫面上的條件）
    attackParams: RiskAttackParams | null;                           // null＝設定檔沒寫任何參數
    warnings: string[];
    summaryParts: string[];                                          // 成功匯入的項目（組成提示文字）
}

/** 設定檔是否帶有風險評估區塊 */
export const hasRiskConfigBlocks = (parsedJson: unknown): boolean =>
    isPlainObject(parsedJson) && (isPlainObject(parsedJson.risk_attacks) || isPlainObject(parsedJson.risk_cap));

const ACCEPTED_RISK_ROLES = new Set(['quasi_identifier', 'sensitive']);

/** columns 區塊 → 欄位角色（只收 quasi_identifier／sensitive；其他角色不參與風險評估） */
const parseRiskColumns = (rawColumns: unknown, resolveName: (name: string) => string | null, warnings: string[], skippedNames: Set<string>): RiskColumnOverrides => {
    const columnOverrides: RiskColumnOverrides = {};
    if (!isPlainObject(rawColumns)) return columnOverrides;
    Object.entries(rawColumns).forEach(([rawName, rawSpec]) => {
        const spec = isPlainObject(rawSpec) ? rawSpec : {};
        const role = String(spec.role ?? '').toLowerCase();
        if (!ACCEPTED_RISK_ROLES.has(role)) {
            warnings.push(`風險評估欄位「${rawName}」的角色「${String(spec.role)}」不參與三攻擊／CAP，已略過`);
            return;
        }
        const columnName = resolveName(rawName);
        if (!columnName) {
            skippedNames.add(normalizeDatasetColumnName(rawName));
            return;
        }
        columnOverrides[columnName] = { role: role as 'quasi_identifier' | 'sensitive', type: String(spec.type ?? 'categorical').toLowerCase() || 'categorical' };
    });
    return columnOverrides;
};

/** subgroup 區塊 → 畫面條件（數值／日期區間存字串，與 RiskSubgroupFilterPanel 輸入框一致） */
const parseRiskSubgroup = (rawSubgroup: unknown, resolveName: (name: string) => string | null, warnings: string[], skippedNames: Set<string>): Record<string, RiskSubgroupCondition> => {
    const filters: Record<string, RiskSubgroupCondition> = {};
    if (!isPlainObject(rawSubgroup)) return filters;
    Object.entries(rawSubgroup).forEach(([rawName, rawCondition]) => {
        const columnName = resolveName(rawName);
        if (!columnName) {
            skippedNames.add(normalizeDatasetColumnName(rawName));
            return;
        }
        if (Array.isArray(rawCondition)) {
            const values = rawCondition.map((value) => String(value).trim()).filter((value) => value !== '');
            if (values.length > 0) filters[columnName] = { kind: 'categorical', values };
            return;
        }
        if (isPlainObject(rawCondition) && (rawCondition.min !== undefined || rawCondition.max !== undefined)) {
            const toText = (value: unknown): string | undefined => (value === undefined || value === null ? undefined : String(value));
            filters[columnName] = { kind: 'range', min: toText(rawCondition.min), max: toText(rawCondition.max) };
            return;
        }
        warnings.push(`對象族群條件「${rawName}」的寫法無法辨識，已略過`);
    });
    return filters;
};

/** 兩組條件是否相同（比較 risk_attacks 與 risk_cap 用） */
const isSameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/**
 * 函數名稱: importRiskFromConfig
 * 函數功能: 從整份設定檔取出 risk_attacks／risk_cap 並轉換；已上傳資料時只保留資料中存在的欄位。
 * 返回值: 兩個區塊都沒有（或都未啟用）時回傳 null。
 */
export const importRiskFromConfig = (parsedJson: unknown, datasetColumnNames: readonly string[] | null | undefined): RiskImportResult | null => {
    if (!hasRiskConfigBlocks(parsedJson)) return null;
    const configRecord = parsedJson as Record<string, unknown>;
    const attacksBlock = isPlainObject(configRecord.risk_attacks) && configRecord.risk_attacks.enabled !== false ? configRecord.risk_attacks : null;
    const capBlock = isPlainObject(configRecord.risk_cap) && configRecord.risk_cap.enabled !== false ? configRecord.risk_cap : null;
    if (!attacksBlock && !capBlock) return null;

    const datasetColumnNameSet = buildDatasetColumnNameSet(datasetColumnNames);
    const datasetNameByNormalized = new Map((datasetColumnNames || []).map((rawName) => [normalizeDatasetColumnName(rawName), rawName] as const));
    const resolveName = (rawName: string): string | null => {
        const normalizedName = normalizeDatasetColumnName(rawName);
        if (!normalizedName || !isFieldNameInDataset(normalizedName, datasetColumnNameSet)) return null;
        return datasetNameByNormalized.get(normalizedName) ?? normalizedName;
    };

    const result: RiskImportResult = { columnOverrides: null, linkability: null, subgroupFilters: null, attackParams: null, warnings: [], summaryParts: [] };
    const skippedNames = new Set<string>();
    const primaryBlock = attacksBlock ?? capBlock!;

    // ── 欄位角色 ──
    if (isPlainObject(primaryBlock.columns)) {
        const columnOverrides = parseRiskColumns(primaryBlock.columns, resolveName, result.warnings, skippedNames);
        const roles = Object.values(columnOverrides).map((spec) => spec.role);
        if (roles.includes('sensitive') && roles.includes('quasi_identifier')) {
            result.columnOverrides = columnOverrides;
            result.summaryParts.push(`風險評估欄位（間接識別 ${roles.filter((role) => role === 'quasi_identifier').length}、敏感 ${roles.filter((role) => role === 'sensitive').length}）`);
        } else {
            result.warnings.push('風險評估欄位須至少各有 1 個間接識別與敏感欄位（資料中存在者），已改為沿用原本的欄位推導');
        }
        if (attacksBlock && capBlock && isPlainObject(capBlock.columns) && !isSameJson(parseRiskColumns(capBlock.columns, resolveName, [], new Set()), columnOverrides)) {
            result.warnings.push('risk_cap 的欄位角色與 risk_attacks 不同；本工具三攻擊與 CAP 共用同一組，已採用 risk_attacks');
        }
    }

    // ── 連結性分組（僅三攻擊） ──
    if (attacksBlock && isPlainObject(attacksBlock.linkability)) {
        const toNames = (rawList: unknown): string[] => (Array.isArray(rawList) ? rawList.map((name) => resolveName(String(name))) : []).filter((name): name is string => Boolean(name));
        const groupA = toNames(attacksBlock.linkability.A);
        const groupB = toNames(attacksBlock.linkability.B);
        const rawCount = (Array.isArray(attacksBlock.linkability.A) ? attacksBlock.linkability.A.length : 0) + (Array.isArray(attacksBlock.linkability.B) ? attacksBlock.linkability.B.length : 0);
        const overlaps = groupA.filter((name) => groupB.includes(name));
        const quasiIdentifierNames = result.columnOverrides ? Object.keys(result.columnOverrides).filter((name) => result.columnOverrides![name].role === 'quasi_identifier') : null;
        const notQuasiIdentifier = quasiIdentifierNames ? [...groupA, ...groupB].filter((name) => !quasiIdentifierNames.includes(name)) : [];
        if (groupA.length === 0 || groupB.length === 0 || groupA.length + groupB.length < rawCount) {
            result.warnings.push('連結性分組 A／B 須各至少 1 欄且都存在於資料中，已改由後端自動分組');
        } else if (overlaps.length > 0) {
            result.warnings.push(`連結性分組 A、B 不可重疊（${overlaps.join('、')}），已改由後端自動分組`);
        } else if (notQuasiIdentifier.length > 0) {
            result.warnings.push(`連結性分組只能用間接識別欄位（${notQuasiIdentifier.join('、')} 不是），已改由後端自動分組`);
        } else {
            result.linkability = { A: groupA, B: groupB };
            result.summaryParts.push(`連結性分組（A：${groupA.join('、')}／B：${groupB.join('、')}）`);
        }
    }

    // ── 對象族群限定條件 ──
    if (isPlainObject(primaryBlock.subgroup)) {
        result.subgroupFilters = parseRiskSubgroup(primaryBlock.subgroup, resolveName, result.warnings, skippedNames);
        if (Object.keys(result.subgroupFilters).length > 0) result.summaryParts.push(`對象族群條件 ${Object.keys(result.subgroupFilters).length} 項`);
    } else if (attacksBlock) {
        result.subgroupFilters = {}; // 設定檔明確評估全體
    }
    if (attacksBlock && capBlock && !isSameJson(attacksBlock.subgroup ?? null, capBlock.subgroup ?? null)) {
        result.warnings.push('risk_cap 的對象族群條件與 risk_attacks 不同；本工具三攻擊與 CAP 共用同一組，已採用 risk_attacks');
    }

    // ── 三攻擊實驗參數 ──
    if (attacksBlock && RISK_ATTACK_PARAM_KEYS.some((paramKey) => attacksBlock[paramKey] !== undefined)) {
        const attackParams: RiskAttackParams = { ...RISK_ATTACK_DEFAULT_PARAMS };
        RISK_ATTACK_PARAM_KEYS.forEach((paramKey) => {
            const rawValue = attacksBlock[paramKey];
            if (rawValue === undefined) return;
            if (isValidRiskAttackParamValue(paramKey, rawValue)) attackParams[paramKey] = rawValue;
            else result.warnings.push(`實驗參數 ${paramKey} 的值「${String(rawValue)}」不合法，改用前端預設 ${RISK_ATTACK_DEFAULT_PARAMS[paramKey]}`);
        });
        if (!isDefaultRiskAttackParams(attackParams)) {
            result.attackParams = attackParams;
            result.summaryParts.push(`實驗參數（n_iter ${attackParams.n_iter}、n_repeats ${attackParams.n_repeats}）`);
            if (attackParams.n_iter * attackParams.n_repeats > RISK_ATTACK_DEFAULT_PARAMS.n_iter * RISK_ATTACK_DEFAULT_PARAMS.n_repeats * 2) {
                result.warnings.push(`三攻擊實驗參數比前端預設大（n_iter ${attackParams.n_iter}×n_repeats ${attackParams.n_repeats}，預設 ${RISK_ATTACK_DEFAULT_PARAMS.n_iter}×${RISK_ATTACK_DEFAULT_PARAMS.n_repeats}），Step4 風險評估會明顯變慢；可在 Step3 還原預設`);
            }
        }
    }

    if (skippedNames.size > 0) result.warnings.unshift(`風險評估：已略過 ${skippedNames.size} 個資料中沒有的欄位：${Array.from(skippedNames).join('、')}`);
    return result;
};

/**
 * 函數名稱: resolveRiskColumnOverridesForDataset
 * 函數功能: Step4 執行時取用匯入的欄位角色：只保留實際處理的欄位；缺間接識別或敏感欄位時回傳 null（退回原本推導）。
 */
export const resolveRiskColumnOverridesForDataset = (columnOverrides: RiskColumnOverrides | null | undefined, processedColumnNames: readonly string[]): RiskColumnOverrides | null => {
    if (!columnOverrides) return null;
    const processedNameByNormalized = new Map(processedColumnNames.map((name) => [normalizeDatasetColumnName(name), name] as const));
    const keptOverrides: RiskColumnOverrides = {};
    Object.entries(columnOverrides).forEach(([columnName, spec]) => {
        const processedName = processedNameByNormalized.get(normalizeDatasetColumnName(columnName));
        if (processedName) keptOverrides[processedName] = spec;
    });
    const roles = Object.values(keptOverrides).map((spec) => spec.role);
    return roles.includes('sensitive') && roles.includes('quasi_identifier') ? keptOverrides : null;
};

/**
 * 函數名稱: resolveLinkabilityForRound
 * 函數功能: 本輪 columns 中 A、B 都是間接識別時才送出連結性分組，否則回傳 null（由後端自動分組）。
 */
export const resolveLinkabilityForRound = (
    linkability: RiskLinkabilityGroups | null | undefined,
    roundColumns: Record<string, { role: string }>
): RiskLinkabilityGroups | null => {
    if (!linkability || linkability.A.length === 0 || linkability.B.length === 0) return null;
    const isQuasiIdentifier = (name: string): boolean => roundColumns[name]?.role === 'quasi_identifier';
    return linkability.A.every(isQuasiIdentifier) && linkability.B.every(isQuasiIdentifier) ? linkability : null;
};

/** 匯入結果 → 畫面提示 */
export const describeRiskImport = (importResult: RiskImportResult): { summary: string; warnings: string[] } => ({
    summary: importResult.summaryParts.length > 0
        ? `已匯入風險評估設定：${importResult.summaryParts.join('；')}`
        : '設定檔的風險評估區塊沒有可匯入的項目',
    warnings: importResult.warnings,
});
