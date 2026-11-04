import { describe, it, expect } from 'vitest';
import { classifyKAnonymityUtility, classifyDifferentialPrivacyUtility, formatPer100Text, resolveColumnTreatment } from '../plainResultSummary';

describe('formatPer100Text', () => {
    it('比例換成每 100 筆幾筆；未滿 1 筆另行說明', () => {
        expect(formatPer100Text(0)).toBe('每 100 筆不到 1 筆');
        expect(formatPer100Text(0.022)).toBe('每 100 筆約 2 筆');
        expect(formatPer100Text(0.315)).toBe('每 100 筆約 32 筆');
        expect(formatPer100Text(-1)).toBeNull();
        expect(formatPer100Text(null)).toBeNull();
    });
});

describe('可用性分級', () => {
    it('K-匿名依抑制比例：< 5% 高、5%～20% 中、≥ 20% 低（邊界歸較差一級）', () => {
        expect(classifyKAnonymityUtility(0)!.labelText).toBe('高');
        expect(classifyKAnonymityUtility(0.05)!.labelText).toBe('中');
        expect(classifyKAnonymityUtility(0.2)!.labelText).toBe('低');
        expect(classifyKAnonymityUtility(null)).toBeNull();
    });
    it('差分隱私依總消耗 ε：> 10 高、1～10 中、≤ 1 低', () => {
        expect(classifyDifferentialPrivacyUtility(12)!.labelText).toBe('高');
        expect(classifyDifferentialPrivacyUtility(10)!.labelText).toBe('中');
        expect(classifyDifferentialPrivacyUtility(1)!.labelText).toBe('低');
        expect(classifyDifferentialPrivacyUtility(0)).toBeNull();
    });
});

describe('resolveColumnTreatment', () => {
    const base = { columnName: 'x', privacyMode: 'k-anonymity', isActuallyDeidentified: true, isDpNoised: false };
    it('移除、遮蔽、泛化、保留原值', () => {
        expect(resolveColumnTreatment({ ...base, role: 'Identifier', maskStrategy: 'remove' }).bucket).toBe('removed');
        // ★ 2026-10-28：識別欄位雜湊／清空分開標示
        expect(resolveColumnTreatment({ ...base, role: 'Identifier', maskStrategy: 'hash' }).plainText).toBe('換成代碼（雜湊）');
        expect(resolveColumnTreatment({ ...base, role: 'Identifier', maskStrategy: 'clear' }).plainText).toBe('已清空');
        expect(resolveColumnTreatment({ ...base, role: 'Identifier', maskStrategy: 'full' }).plainText).toBe('已遮蔽');
        expect(resolveColumnTreatment({ ...base, role: 'Quasi-identifier', generalizationTechKey: 'custom_bins' }).plainText).toBe('改成數值區間');
        expect(resolveColumnTreatment({ ...base, role: 'Quasi-identifier', generalizationTechKey: 'none', isActuallyDeidentified: false }).bucket).toBe('kept');
        expect(resolveColumnTreatment({ ...base, role: 'Sensitive', maskStrategy: 'none', isActuallyDeidentified: false }).bucket).toBe('kept');
    });
    it('差分隱私只分加噪／保留', () => {
        expect(resolveColumnTreatment({ ...base, privacyMode: 'differential-privacy', role: 'Identifier', maskStrategy: 'remove', isDpNoised: true }).bucket).toBe('blurred');
        expect(resolveColumnTreatment({ ...base, privacyMode: 'differential-privacy', role: 'Sensitive', isDpNoised: false }).bucket).toBe('kept');
    });
});

import { resolveReleaseDecision, pickExampleValue } from '../plainResultSummary';

describe('resolveReleaseDecision', () => {
    it('依保護程度與可用性給出一句話結論', () => {
        expect(resolveReleaseDecision({ riskLevel: 1, utilityLevel: 1, privacyMode: 'k-anonymity' }).headline).toBe('依本次評估可提供');
        expect(resolveReleaseDecision({ riskLevel: 1, utilityLevel: 3, privacyMode: 'k-anonymity' }).tone).toBe('warning');
        // ★ 2026-11-04：riskLevel 1 通過、2 不通過
        expect(resolveReleaseDecision({ riskLevel: 2, utilityLevel: 1, privacyMode: 'k-anonymity' }).headline).toBe('不建議提供');
        expect(resolveReleaseDecision({ riskLevel: 2, utilityLevel: 1, privacyMode: 'differential-privacy' }).adviceText).toContain('ε');
        expect(resolveReleaseDecision({ riskLevel: null, utilityLevel: 1, privacyMode: 'k-anonymity' }).tone).toBe('info');
    });
});

describe('pickExampleValue', () => {
    it('略過空白與 *，過長截斷', () => {
        expect(pickExampleValue([{ a: '' }, { a: '*' }, { a: '30-39' }], 'a')).toBe('30-39');
        expect(pickExampleValue([{ a: '' }], 'a')).toBeUndefined();
        expect(pickExampleValue([{ a: 'x'.repeat(30) }], 'a')).toBe(`${'x'.repeat(20)}…`);
    });
});
