import { describe, it, expect } from 'vitest';
import { detectConfigPrivacyMode } from '../configModeDetect';
import backendDp from './fixtures/backend_config_dp.json';
import backendKanon from './fixtures/backend_config_kanon.json';
import frontendKanon from './fixtures/frontend_export_kanon_six_levels.json';
import legacyDp from './fixtures/legacy_final_privacy_config_dp.json';

describe('detectConfigPrivacyMode：判斷匯入設定檔的隱私模式', () => {
    it('差分隱私設定檔（後端大包、舊版匯出檔、陣列格式）判定為 differential-privacy', () => {
        expect(detectConfigPrivacyMode(backendDp)).toBe('differential-privacy');
        expect(detectConfigPrivacyMode(legacyDp)).toBe('differential-privacy');
        expect(detectConfigPrivacyMode([{ fieldName: 'age', fieldType: 'Numeric' }])).toBe('differential-privacy');
        expect(detectConfigPrivacyMode({ column_budgets: { age: { type: 'numeric' } } })).toBe('differential-privacy');
    });

    it('K-匿名設定檔（後端大包、本工具匯出、舊版 privacy_targets）判定為 k-anonymity', () => {
        expect(detectConfigPrivacyMode(backendKanon)).toBe('k-anonymity');
        expect(detectConfigPrivacyMode(frontendKanon)).toBe('k-anonymity');
        expect(detectConfigPrivacyMode({
            privacy_mode: 'k-anonymity',
            privacy_targets: { k_anonymity: { enabled: true, k: 5 }, differential_privacy: { enabled: false } },
            field_attributes: { age: { type: 'numeric', role: 'quasi_identifier' } }
        })).toBe('k-anonymity');
    });

    it('沒有任何模式標記時回傳 unknown（交由原本格式判斷）', () => {
        expect(detectConfigPrivacyMode({ field_attributes: { age: { type: 'numeric' } } })).toBe('unknown');
        expect(detectConfigPrivacyMode(null)).toBe('unknown');
        expect(detectConfigPrivacyMode('x')).toBe('unknown');
    });
});
