/**
 * ============================================================================
 * 檔案名稱 (File): configFileParse.ts
 * 模組功能 (Description): Step2「匯入設定檔」的檔案解析（JSON／YAML）。
 * ============================================================================
 * ★ 2026-10-29（TTC Wei 要求）：支援後端統合版 YAML 設定檔（期末交付包 04_系統設定檔/config_範例_YAML統合版.yaml）。
 *   - 副檔名 .yaml／.yml 以 YAML 解析，其餘維持 JSON；解析後的物件交給原本的匯入流程（與 JSON 版完全相同）。
 *   - 後端以 PyYAML（YAML 1.1）讀檔，有幾個容易踩到的寫法：1e-5 會被當成字串（須寫 1.0e-5）、
 *     沒加引號的 18:00 會被當成六十進位整數 1080、yes／no 會被當成布林。
 *     前端改用 YAML 1.2 核心規則（yaml 套件預設）：1e-5 是數字、18:00 與日期維持字串、只有 true／false 是布林，
 *     使用者照字面寫就會得到預期的值；前端匯入後一律轉成 JSON 送後端，不受後端 YAML 解讀差異影響。
 *     （交付包範例檔兩種規則解讀的結果相同，見 __tests__/configFileParse.test.ts。）
 *   - YAML 語法錯誤時回報行號，方便使用者修正。
 */
import { parse as parseYamlText, YAMLParseError } from 'yaml';

/** 匯入按鈕接受的副檔名 */
export const CONFIG_FILE_ACCEPT = '.json,.yaml,.yml';

export const isYamlConfigFileName = (fileName: string | undefined): boolean => /\.ya?ml$/i.test(String(fileName || '').trim());

/** 設定檔解析失敗（訊息為給使用者看的白話說明） */
export class ConfigFileParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConfigFileParseError';
    }
}

/**
 * 解析設定檔文字。YAML 檔解析失敗丟出 ConfigFileParseError（含行號）；
 * JSON 檔維持原本的 JSON.parse 行為（丟出 SyntaxError，由呼叫端顯示既有的錯誤訊息）。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 匯入流程沿用既有的動態物件存取
export const parseConfigFileText = (rawText: string, fileName?: string): any => {
    const cleanedText = String(rawText || '').replace(/^[\uFEFF\u200B]+/, '').trim();
    if (!isYamlConfigFileName(fileName)) return JSON.parse(cleanedText);

    let parsedValue: unknown;
    try {
        parsedValue = parseYamlText(cleanedText, { version: '1.2', schema: 'core', uniqueKeys: true });
    } catch (yamlError) {
        if (yamlError instanceof YAMLParseError) {
            const lineNumber = yamlError.linePos?.[0]?.line;
            // 後端套件訊息末尾的「at line N, column M:」與前面的行號重複，去掉
            const firstLine = String(yamlError.message || '').split('\n')[0].replace(/\s*at line \d+, column \d+:?\s*$/, '');
            throw new ConfigFileParseError(lineNumber
                ? `YAML 格式錯誤（第 ${lineNumber} 行）：${firstLine}`
                : `YAML 格式錯誤：${firstLine}`);
        }
        throw new ConfigFileParseError(`YAML 檔案無法解析：${String((yamlError as Error)?.message || yamlError)}`);
    }
    if (parsedValue === null || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
        throw new ConfigFileParseError('YAML 設定檔的最上層必須是「參數名稱: 值」的形式（例如 k_anonymity:、differential_privacy:）。');
    }
    return parsedValue;
};
