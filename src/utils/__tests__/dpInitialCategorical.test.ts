import { describe, it, expect } from 'vitest';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { validateProgression } from '../../features/workspace/validateProgression';

const t = (_k: string, d?: string) => d ?? _k;

describe('DP 初始欄位：剛進入 Step2 時不預先選好資料型態', () => {
    it('婚姻、年齡、姓名等欄位一律為「請選擇」（Unknown），且不帶預設邊界', () => {
        useWorkspaceStore.getState().setFileData(['婚姻', '年齡', '姓名'], [{ 婚姻: 'Married', 年齡: 30, 姓名: 'A' }], 't.csv');
        const fields = useWorkspaceStore.getState().dpFields;
        expect(fields.map((f) => f.fieldType)).toEqual(['Unknown', 'Unknown', 'Unknown']);
        fields.forEach((f) => {
            expect(f.lowerBound).toBeUndefined();
            expect(f.upperBound).toBeUndefined();
        });
    });

    it('未選型態前不能前往 Step3；選好類別型後可前進（類別清單由系統自動萃取）', () => {
        const store = useWorkspaceStore.getState();
        store.setFileData(['婚姻'], [{ 婚姻: 'Married' }], 't.csv');
        useWorkspaceStore.setState({ privacyMode: 'differential-privacy', currentStep: 1 } as never);
        expect(validateProgression(2, 1, useWorkspaceStore.getState(), t as never)).not.toBeNull();

        const [field] = useWorkspaceStore.getState().dpFields;
        useWorkspaceStore.getState().setDpFields([{ ...field, fieldType: 'Categorical', lowerBound: 0, upperBound: 1, allowedCategories: 'auto_extracted' }]);
        expect(validateProgression(2, 1, useWorkspaceStore.getState(), t as never)).toBeNull();
    });
});
