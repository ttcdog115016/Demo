import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { projectCsvTextToColumns, pruneKAnonymityBlockToColumns } from '../riskUploadTrimming';

describe('projectCsvTextToColumns', () => {
    const csvText = '\uFEFF姓名,年齡,地址,疾病\n王小明,30,"台北市,中正區",感冒\n李"大"華,,"多行\n地址",糖尿病\n';

    it('只保留指定欄位、維持原順序，含逗號／換行／引號的儲存格不被拆壞', () => {
        const result = projectCsvTextToColumns(csvText, ['疾病', '年齡']);
        expect(result.keptColumnNames).toEqual(['年齡', '疾病']);
        expect(result.droppedColumnNames).toEqual(['姓名', '地址']);
        expect(result.csvText.charCodeAt(0)).toBe(0xFEFF);
        const rows = Papa.parse<string[]>(result.csvText.slice(1), { skipEmptyLines: true }).data;
        expect(rows).toEqual([['年齡', '疾病'], ['30', '感冒'], ['', '糖尿病']]);
    });

    it('筆數與原檔相同', () => {
        const original = Papa.parse(csvText.slice(1), { header: true, skipEmptyLines: true }).data.length;
        const projected = Papa.parse(projectCsvTextToColumns(csvText, ['年齡', '姓名']).csvText.slice(1), { header: true, skipEmptyLines: true }).data.length;
        expect(projected).toBe(original);
    });

    it('沒有要拿掉的欄位，或對得到的欄位少於 2 個時，原文照回', () => {
        expect(projectCsvTextToColumns(csvText, ['姓名', '年齡', '地址', '疾病']).csvText).toBe(csvText);
        expect(projectCsvTextToColumns(csvText, ['不存在']).csvText).toBe(csvText);
        // 只剩 1 欄時空值列會變空白行、被後端略過，因此不裁切
        expect(projectCsvTextToColumns(csvText, ['年齡']).csvText).toBe(csvText);
    });

    it('前導零與文字格式原樣保留', () => {
        const result = projectCsvTextToColumns('郵遞區號,姓名,備註\n00100,甲,x\n', ['郵遞區號', '姓名']);
        expect(result.csvText).toBe('郵遞區號,姓名\n00100,甲');
    });
});

describe('pruneKAnonymityBlockToColumns', () => {
    it('以欄名為 key 的設定只留指定欄位，其他參數不變', () => {
        const block = {
            k: 5, l: 2,
            columns: { 姓名: { role: 'identifier' }, 年齡: { role: 'quasi_identifier' }, 疾病: { role: 'sensitive' } },
            generalization_hierarchies: { 年齡: { bins: [] } },
            generalization_matrices: { 地區: {} },
            qi_generalization_levels: { 年齡: 1 }
        };
        const pruned = pruneKAnonymityBlockToColumns(block, ['年齡', '疾病']) as Record<string, unknown>;
        expect(pruned.k).toBe(5);
        expect(pruned.l).toBe(2);
        expect(Object.keys(pruned.columns as object)).toEqual(['年齡', '疾病']);
        expect(pruned.generalization_hierarchies).toEqual({ 年齡: { bins: [] } });
        expect(pruned.generalization_matrices).toBeUndefined();
        expect(pruned.qi_generalization_levels).toEqual({ 年齡: 1 });
        expect(Object.keys(block.columns)).toHaveLength(3); // 不改動原物件
    });
});
