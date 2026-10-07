import { describe, it, expect } from 'vitest';
import { findHierarchyTableProblems, describeHierarchyRowProblem } from '../hierarchyTableValidation';

const base = [
    ['大安區', '臺北市', '北部', '全國'],
    ['中正區', '臺北市', '北部', '全國'],
    ['板橋區', '新北市', '北部', '全國'],
    ['苓雅區', '高雄市', '南部', '全國']
];

describe('findHierarchyTableProblems', () => {
    it('使用者截圖：原始值空白、只有泛化 3 填 444444 → 擋下', () => {
        const problems = findHierarchyTableProblems([...base, ['', '', '', '444444']], 2);
        expect(problems).toEqual([{ kind: 'missing_original', rowNumber: 5, columnIndex: 0 }]);
        expect(describeHierarchyRowProblem(problems[0], 2)).toBe('第 5 列沒有填原始值，但後面的層級有填');
    });
    it('完全空白的列不檢查；完整資料無問題', () => {
        expect(findHierarchyTableProblems([...base, ['', '', '', '']], 3)).toEqual([]);
    });
    it('中間層空白', () => {
        expect(findHierarchyTableProblems([['大安區', '', '北部']], 1)).toEqual([{ kind: 'level_gap', rowNumber: 1, columnIndex: 1 }]);
    });
    it('原始值重複（前後空白視為相同）', () => {
        expect(findHierarchyTableProblems([['大安區', '臺北市'], [' 大安區', '台北市']], 1)).toEqual([{ kind: 'duplicate_original', rowNumber: 2, columnIndex: 0, originalValue: '大安區' }]);
    });
    it('只填到泛化 1，但選用層級 2', () => {
        const problems = findHierarchyTableProblems([['大安區', '臺北市', '北部'], ['板橋區', '新北市', '']], 2);
        expect(problems).toEqual([{ kind: 'below_selected_level', rowNumber: 2, columnIndex: 2, filledLevel: 1 }]);
        expect(describeHierarchyRowProblem(problems[0], 2)).toBe('第 2 列只填到「泛化 1」，但目前選用的泛化層級是 2');
    });
    it('只有原始值、選用層級 1', () => {
        expect(describeHierarchyRowProblem(findHierarchyTableProblems([['大安區']], 1)[0], 1)).toBe('第 1 列只有原始值，沒有填任何泛化層級（目前選用層級 1）');
    });
    it('選用層級 0（不泛化）時不檢查層級深度', () => {
        expect(findHierarchyTableProblems([['大安區']], 0)).toEqual([]);
    });
});
