import { describe, it, expect } from 'vitest';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { validateProgression } from '../../features/workspace/validateProgression';
import { findFieldsNotInDataset, findDatasetColumnsNotConfigured, countBlankFieldNames, isFieldNameInDataset, buildDatasetColumnNameSet } from '../datasetFieldConsistency';

const t = (_k: string, d?: unknown) => (typeof d === 'string' ? d : _k);

describe('datasetFieldConsistency：Step2 欄位清單與上傳資料一致性', () => {
    const datasetColumns = ['\uFEFF姓名', '身分證號', '年齡', '地區'];

    it('列出資料中不存在的欄位（去 BOM／前後空白比對、去重、忽略空白名稱）', () => {
        expect(findFieldsNotInDataset(['姓名', ' 年齡 ', '生日', '薪資', '生日', ''], datasetColumns)).toEqual(['生日', '薪資']);
    });

    it('列出資料中有、設定尚未涵蓋的欄位（依資料欄位順序）', () => {
        expect(findDatasetColumnsNotConfigured(['姓名', '年齡', '生日'], datasetColumns)).toEqual(['身分證號', '地區']);
    });

    it('計算空白名稱列數', () => {
        expect(countBlankFieldNames(['', '  ', '年齡'])).toBe(2);
    });

    it('尚未上傳資料時不比對（一律視為存在）', () => {
        expect(isFieldNameInDataset('任意', buildDatasetColumnNameSet([]))).toBe(true);
        expect(findFieldsNotInDataset(['任意'], [])).toEqual([]);
    });
});

describe('validateProgression：設定中有資料中沒有的欄位時不能進 Step3', () => {
    it('K-匿名：多出資料中不存在的敏感欄位 → 擋下並列出欄位名稱', () => {
        useWorkspaceStore.setState({
            columns: ['姓名', '年齡'], privacyMode: 'k-anonymity', currentStep: 1, isStepValid: true,
            columnRoles: { 姓名: 'Identifier', 年齡: 'Quasi-identifier', 疾病: 'Sensitive' },
            kAnonymityFields: [
                { name: '姓名', role: 'Identifier', type: 'string', maskStrategy: 'remove' },
                { name: '年齡', role: 'Quasi-identifier', type: 'string' },
                { name: '疾病', role: 'Sensitive', type: 'string', maskStrategy: 'none' }
            ]
        } as never);
        const errorMessage = validateProgression(2, 1, useWorkspaceStore.getState(), t as never);
        expect(errorMessage).toContain('「疾病」');
    });

    it('差分隱私：已設定欄位不在資料中 → 擋下', () => {
        useWorkspaceStore.setState({
            columns: ['婚姻'], privacyMode: 'differential-privacy', currentStep: 1,
            dpFields: [
                { id: '1', fieldName: '婚姻', fieldType: 'Categorical', enabled: true, epsilon: 1, delta: 0, allowedCategories: 'auto_extracted' },
                { id: '2', fieldName: '薪資', fieldType: 'Categorical', enabled: true, epsilon: 1, delta: 0, allowedCategories: 'auto_extracted' }
            ]
        } as never);
        expect(validateProgression(2, 1, useWorkspaceStore.getState(), t as never)).toContain('「薪資」');
    });
});
