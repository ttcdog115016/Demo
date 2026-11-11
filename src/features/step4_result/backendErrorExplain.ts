/**
 * ============================================================================
 * 檔案名稱 (File): backendErrorExplain.ts
 * 模組功能 (Description): 把後端錯誤原始訊息翻成「問題：哪個欄位、哪裡不對」＋「建議：到哪一步改什麼」。
 * ★ 2026-10-05 新增：使用者要求錯誤卡片比照後端「錯誤訊息與建議」的寫法，簡潔明瞭指出問題所在。
 *   原本卡片只依錯誤碼顯示通用說明（例如「欄位設定與您上傳的資料對不起來」），真正有用的
 *   「欄位 '年齡' 宣告為 continuous…」只放在最下方小字。這裡依後端訊息樣板（見
 *   backendErrorCatalog.tsx 的 DEBUG_PANEL_ERROR_CODE_OPTIONS）抽出欄位名稱與數值，必要時再對照
 *   已掃描的資料集統計 (datasetProfile) 列出實際有問題的值。無法辨識的訊息回傳 null，沿用原本通用說明。
 * ============================================================================
 */
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { evaluateNumericConflict, evaluateDateConflict } from '../../utils/backendValueRules';

export interface ExplainedBackendError {
    /** 問題所在（一句話） */
    problem: string;
    /** 具體建議（一句話） */
    advice: string;
}

const QUOTED = `['‘’「『"]([^'‘’」』"]+)['‘’」』"]`;
const MAX_EXAMPLE_VALUES = 3;

const DECLARED_TYPE_LABEL_MAP: Record<string, string> = {
    continuous: '數值', numeric: '數值', integer: '整數', int: '整數', float: '數值', number: '數值',
    datetime: '日期時間', temporal: '日期時間', date: '日期', time: '時間',
    categorical: '類別', category: '類別', string: '文字', text: '文字'
};

const toTypeLabel = (declaredType: string): string => DECLARED_TYPE_LABEL_MAP[declaredType.toLowerCase()] ?? declaredType;

const normalizeColumnName = (name: string): string =>
    // eslint-disable-next-line no-control-regex
    name.normalize('NFKC').replace(/[\u0000-\u001F\u007F​-‏⁠﻿]/g, '').trim();

/** 從資料集統計取出某欄位無法轉成數值／日期的實際值與筆數（規則與後端一致，見 backendValueRules.ts） */
const describeConflictValues = (columnName: string, kind: 'numeric' | 'date'): string => {
    const profile = useWorkspaceStore.getState().datasetProfile;
    const valueStats = (profile?.columns?.[columnName] ?? profile?.columns?.[normalizeColumnName(columnName)])?.valueStats;
    if (!valueStats) return '';
    const conflict = kind === 'numeric' ? evaluateNumericConflict(valueStats) : evaluateDateConflict(valueStats);
    if (!conflict) return '';
    const examples = conflict.examples.slice(0, MAX_EXAMPLE_VALUES)
        .map((example) => (example.lineNumber ? `第 ${example.lineNumber} 列「${example.value}」` : `「${example.value}」`)).join('、');
    return `，共 ${conflict.badCount} 筆，例如 ${examples}`;
};

/** 找資料中名稱「看起來一樣」的欄位（差在前後空白、不可見字元或全半形） */
const findLookAlikeColumn = (missingColumnName: string): string | undefined => {
    const columns = useWorkspaceStore.getState().columns || [];
    const target = normalizeColumnName(missingColumnName);
    return columns.find((columnName) => columnName !== missingColumnName && normalizeColumnName(columnName) === target);
};

const visible = (name: string): string =>
    // eslint-disable-next-line no-control-regex
    name.replace(/[\u0000-\u001F\u007F​-‏⁠﻿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
        .replace(/^ +| +$/g, (spaces) => '␣'.repeat(spaces.length));

type Explainer = (rawMessage: string) => ExplainedBackendError | null;

const EXPLAINERS: Explainer[] = [
    // 欄位 '年齡' 宣告為 continuous，但實體資料包含無法轉換的非數值內容。
    (rawMessage) => {
        // ★ 2026-10-05：K-匿名端點用「配置為」、差分隱私端點用「宣告為」；日期欄為「無法解析」
        const match = rawMessage.match(new RegExp(`欄位\\s*${QUOTED}\\s*(?:宣告為|配置為)\\s*([A-Za-z_]+)`));
        if (!match || !/無法(轉換|解析)/.test(rawMessage)) return null;
        const [, columnName, declaredType] = match;
        const typeLabel = toTypeLabel(declaredType);
        const isDateType = /日期|時間/.test(typeLabel);
        const valueDetail = describeConflictValues(columnName, isDateType ? 'date' : 'numeric');
        return {
            problem: isDateType
                ? `「${columnName}」設定為${typeLabel}欄位，但資料中有無法解析的日期${valueDetail}（須為西元年，且整欄格式一致）。`
                : `「${columnName}」設定為${typeLabel}欄位，但資料中有無法轉成${typeLabel}的值${valueDetail}。`,
            advice: `到「屬性分類」把「${columnName}」的資料型態改為類別，或在原始檔案修正這些值後重新上傳。`
        };
    },
    // 設定檔宣告的欄位 '地區' 不存在於提供的資料中，請檢查欄位名稱。
    (rawMessage) => {
        const match = rawMessage.match(new RegExp(`欄位\\s*${QUOTED}\\s*不存在`));
        if (!match) return null;
        const [, columnName] = match;
        const lookAlike = findLookAlikeColumn(columnName);
        return {
            problem: lookAlike
                ? `設定中的欄位「${columnName}」在資料裡找不到；資料中的欄位名稱是「${visible(lookAlike)}」，看起來一樣但多了空白或看不見的字元。`
                : `設定中的欄位「${columnName}」在上傳的資料裡找不到。`,
            advice: lookAlike
                ? '在原始檔案清除該欄位名稱的空白／特殊字元後，回到「資料匯入」重新上傳。'
                : `確認資料檔案的欄位名稱與設定一致（含全半形、空白）；若設定是匯入的，請回到「屬性分類」刪除或改名「${columnName}」。`
        };
    },
    // 欄位 '年齡' 的 epsilon_budget 必須 > 0（收到 0）。
    (rawMessage) => {
        const match = rawMessage.match(new RegExp(`欄位\\s*${QUOTED}\\s*的\\s*([A-Za-z_]+)\\s*必須\\s*(.+?)[（(]收到\\s*(.+?)[）)]`));
        if (!match) return null;
        const [, columnName, parameterName, requirement, received] = match;
        const parameterLabel = parameterName.startsWith('epsilon') ? '隱私預算 ε' : parameterName.startsWith('delta') ? 'δ' : parameterName;
        return {
            problem: `「${columnName}」的${parameterLabel} 必須 ${requirement.trim()}，目前是 ${received.trim()}。`,
            advice: `到「隱私設定」修改「${columnName}」的${parameterLabel}。`
        };
    },
    // 風險評估一次只評估一個 sensitive 欄位，但收到 2 個（['疾病', '薪資']）。
    (rawMessage) => {
        const match = rawMessage.match(/收到\s*(\d+)\s*個[（(]\[(.+?)\][）)]/);
        if (!match || !/sensitive/.test(rawMessage)) return null;
        const names = match[2].split(',').map((name) => name.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
        return {
            problem: `目前有 ${match[1]} 個敏感欄位（${names.map((name) => `「${name}」`).join('、')}），風險評估一次只能評估一個。`,
            advice: '到「屬性分類」只保留一個敏感欄位，其餘改為其他角色。'
        };
    },
    // 去識別化失敗：計算之總列抑制率 62.35% 已超過設定的最高上限 50.00%。
    (rawMessage) => {
        const match = rawMessage.match(/抑制率\s*([\d.]+%)\s*已超過設定的最高上限\s*([\d.]+%)/);
        if (!match) return null;
        return {
            problem: `有 ${match[1]} 的資料因為太特殊需要刪除，超過設定上限 ${match[2]}。`,
            advice: '到「屬性分類」提高間接識別欄位的泛化層級，或到「隱私設定」降低 K 值／調高最大抑制率。'
        };
    },
    // 設定檔內容不合法。columns→年齡→generalization_level：Input should be a valid integer
    (rawMessage) => {
        const match = rawMessage.match(/設定檔內容不合法。\s*(?:columns|column_budgets)→([^→：:]+)→([^：:]+)[：:]\s*(.+)/);
        if (!match) return null;
        return {
            problem: `「${match[1]}」的 ${match[2]} 設定值不正確（${match[3].trim()}）。`,
            advice: `回到「屬性分類」或「隱私設定」重新設定「${match[1]}」。`
        };
    }
];

/**
 * 函數名稱: explainBackendErrorMessage
 * 函數功能: 依後端原始訊息產生「問題／建議」；辨識不出來時回傳 null。
 */
export const explainBackendErrorMessage = (rawMessage: string | undefined): ExplainedBackendError | null => {
    if (!rawMessage) return null;
    for (const explainer of EXPLAINERS) {
        try {
            const explained = explainer(rawMessage);
            if (explained) return explained;
        } catch {
            // 解析失敗不影響錯誤卡片顯示，改用通用說明
        }
    }
    return null;
};
