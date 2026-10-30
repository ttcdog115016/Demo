// @vitest-environment jsdom
import { render, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

const stableTranslation = vi.hoisted(() => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : ((fallback as { defaultValue?: string } | undefined)?.defaultValue ?? key))
}));
vi.mock('react-i18next', () => ({ useTranslation: () => stableTranslation }));
vi.mock('echarts-for-react', () => ({ default: () => null }));

import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { validateProgression } from '../../features/workspace/validateProgression';
import KAnonymityRules from '../../features/step3_rules/KAnonymityRules';

const t = (_k: string, d?: string) => d ?? _k;

describe('敏感欄位選填（2026-10-30，對齊後端：去識別化不需要敏感欄位）', () => {
    afterEach(() => cleanup());

    it('差分隱私只啟用 1 個欄位並點選為敏感：可進 Step3（Step4 略過三攻擊與 CAP）', () => {
        useWorkspaceStore.setState({
            columns: ['PART_CODE'], privacyMode: 'differential-privacy', currentStep: 1, datasetProfile: null,
            dpFields: [{ id: '1', fieldName: 'PART_CODE', fieldType: 'Categorical', enabled: true, epsilon: 1, delta: 0, allowedCategories: 'auto_extracted', isRiskSensitive: true }]
        } as never);
        expect(validateProgression(2, 1, useWorkspaceStore.getState(), t as never)).toBeNull();
    });

    it('差分隱私點選日期時間型為敏感：仍擋', () => {
        useWorkspaceStore.setState({
            columns: ['生日', '地區'], privacyMode: 'differential-privacy', currentStep: 1, datasetProfile: null,
            dpFields: [
                { id: '1', fieldName: '生日', fieldType: 'Numeric', enabled: true, epsilon: 1, delta: 0, lowerBound: 0, upperBound: 1, isRiskSensitive: true },
                { id: '2', fieldName: '地區', fieldType: 'Categorical', enabled: true, epsilon: 1, delta: 0, allowedCategories: 'auto_extracted' }
            ]
        } as never);
        expect(validateProgression(2, 1, useWorkspaceStore.getState(), t as never)).toContain('類別型或連續數值型');
    });

    it('K-匿名沒有敏感欄位：可進 Step3；沒有間接識別碼仍擋', () => {
        useWorkspaceStore.setState({
            columns: ['姓名', '年齡'], privacyMode: 'k-anonymity', currentStep: 1, isStepValid: true, datasetProfile: null,
            columnRoles: { 姓名: 'Identifier', 年齡: 'Quasi-identifier' },
            kAnonymityFields: [
                { name: '姓名', role: 'Identifier', type: 'string', maskStrategy: 'remove' },
                { name: '年齡', role: 'Quasi-identifier', type: 'string' }
            ]
        } as never);
        expect(validateProgression(2, 1, useWorkspaceStore.getState(), t as never)).toBeNull();

        useWorkspaceStore.setState({ columnRoles: { 姓名: 'Identifier', 年齡: 'Non-sensitive' } } as never);
        expect(validateProgression(2, 1, useWorkspaceStore.getState(), t as never)).toContain('間接識別碼');
    });

    it('K-匿名 Step3：沒有保留的敏感欄位時，啟用 l 擋下一步，關閉 l／t 放行', async () => {
        useWorkspaceStore.setState({
            columns: ['年齡', '疾病'], privacyMode: 'k-anonymity', previewData: [], datasetProfile: null,
            columnRoles: { 年齡: 'Quasi-identifier', 疾病: 'Sensitive' },
            kAnonymityFields: [
                { name: '年齡', role: 'Quasi-identifier', type: 'numeric' },
                { name: '疾病', role: 'Sensitive', type: 'categorical', maskStrategy: 'remove' }
            ],
            kValue: 5, lValue: 2, tValue: 0.2, enableLDiversity: true, enableTCloseness: false
        } as never);
        render(<KAnonymityRules />);
        await waitFor(() => expect(useWorkspaceStore.getState().stepErrorMessage).toContain('沒有保留的敏感欄位'));
        expect(useWorkspaceStore.getState().isStepValid).toBe(false);

        useWorkspaceStore.setState({ enableLDiversity: false } as never);
        await waitFor(() => expect(useWorkspaceStore.getState().isStepValid).toBe(true));
    });
});
