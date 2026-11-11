import { describe, it, expect, beforeEach } from 'vitest';
import { explainBackendErrorMessage } from '../../features/step4_result/backendErrorExplain';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { createColumnValueStats, addValueToColumnStats } from '../backendValueRules';

describe('explainBackendErrorMessage', () => {
    beforeEach(() => {
        const ageStats = createColumnValueStats();
        ['20', '三十', '45', 'N/A', '-', '50', '@$$88'].forEach((value, index) => addValueToColumnStats(ageStats, value, index + 2));
        const birthStats = createColumnValueStats();
        ['1990-01-02', '1990-02-30', '1990/01/03', '1990-01-04'].forEach((value, index) => addValueToColumnStats(birthStats, value, index + 2));
        useWorkspaceStore.setState({
            columns: ['年齡', ' 地區', '生日'],
            datasetProfile: { fileKey: 'k', rowCount: 7, columnNamesList: ['年齡', '生日'], numericValues: {},
                columns: {
                    年齡: { nonEmptyCount: 7, distinctCount: 7, isDistinctCountCapped: false, topValues: [], numericCount: 3, nonNumericDistinctValues: [], valueStats: ageStats },
                    生日: { nonEmptyCount: 4, distinctCount: 4, isDistinctCountCapped: false, topValues: [], numericCount: 0, nonNumericDistinctValues: [], valueStats: birthStats } } }
        } as never);
    });
    it('數值欄位含非數值 → 指出欄位、筆數與實際值', () => {
        const r = explainBackendErrorMessage("欄位 '年齡' 宣告為 continuous，但實體資料包含無法轉換的非數值內容。");
        // N/A 是後端缺值字串，不算錯誤；「-」「三十」「@$$88」才算
        expect(r?.problem).toBe('「年齡」設定為數值欄位，但資料中有無法轉成數值的值，共 3 筆，例如 第 3 列「三十」、第 6 列「-」、第 8 列「@$$88」。');
        expect(r?.advice).toContain('屬性分類');
    });
    it('欄位不存在、資料中有看起來一樣的欄位 → 指出多了空白', () => {
        const r = explainBackendErrorMessage("設定檔宣告的欄位 '地區' 不存在於提供的資料中，請檢查欄位名稱。");
        expect(r?.problem).toContain('「␣地區」');
    });
    it('K-匿名端點的日期訊息（配置為 temporal、無法解析）→ 指出格式不一致與日期不存在的值', () => {
        const r = explainBackendErrorMessage("欄位 '生日' 配置為 temporal，但實體資料包含無法解析的日期時間內容（須為西元格式，且同一欄格式一致）。");
        expect(r?.problem).toBe('「生日」設定為日期時間欄位，但資料中有無法解析的日期，共 2 筆，例如 第 3 列「1990-02-30」、第 4 列「1990/01/03」（須為西元年，且整欄格式一致）。');
    });
    it('ε 必須 > 0', () => {
        expect(explainBackendErrorMessage("欄位 '年齡' 的 epsilon_budget 必須 > 0（收到 0）。")?.problem).toBe('「年齡」的隱私預算 ε 必須 > 0，目前是 0。');
    });
    it('抑制率超標', () => {
        expect(explainBackendErrorMessage('去識別化失敗：計算之總列抑制率 62.35% 已超過設定的最高上限 50.00%。')?.problem).toContain('62.35%');
    });
    it('辨識不出來 → null', () => {
        expect(explainBackendErrorMessage('Internal Server Error')).toBeNull();
    });
});
