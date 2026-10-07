import { describe, it, expect } from 'vitest';
import i18n from '../../i18n';
import { resolveKAnonymityGeneralizationTechKey, getKAnonymityGeneralizationTechLabel } from '../kAnonymityTechLabel';
import { buildPipelineAuditLogEntry } from '../../features/step4_result/pipeline/pipelineResults';

const t = (key: string, defaultValue: string) => i18n.t(key, { defaultValue });

describe('K-匿名報告「套用去識別化技術」依實際泛化策略顯示', () => {
    it('字串型「婚姻」選字串前後綴（前方）→ 字串保留前綴，不是區間/時間泛化', async () => {
        await i18n.changeLanguage('zh_TW');
        const key = resolveKAnonymityGeneralizationTechKey({ type: 'string', genStrategy: 'prefix', genDirection: 'front' }, true);
        expect(key).toBe('keep_prefix');
        expect(getKAnonymityGeneralizationTechLabel(key, t)).toBe('字串保留前綴（其餘遮蔽）');
    });

    it('各型態策略對應正確', () => {
        expect(resolveKAnonymityGeneralizationTechKey({ type: 'string', genStrategy: 'prefix', genDirection: 'back' }, true)).toBe('keep_suffix');
        expect(resolveKAnonymityGeneralizationTechKey({ type: 'string', genStrategy: 'length' }, true)).toBe('length');
        expect(resolveKAnonymityGeneralizationTechKey({ type: 'numeric', genStrategy: 'rounding' }, true)).toBe('rounding');
        expect(resolveKAnonymityGeneralizationTechKey({ type: 'numeric', genStrategy: 'custom_bins' }, true)).toBe('custom_bins');
        expect(resolveKAnonymityGeneralizationTechKey({ type: 'temporal', genStrategy: 'time_rounding' }, true)).toBe('time_rounding');
        expect(resolveKAnonymityGeneralizationTechKey({ type: 'temporal', genStrategy: 'time_range' }, true)).toBe('time_range');
        expect(resolveKAnonymityGeneralizationTechKey({ type: 'categorical', genStrategy: 'tree' }, true)).toBe('tree');
    });

    it('參數未設定完整（後端不會處理）→ 保留原文', () => {
        expect(resolveKAnonymityGeneralizationTechKey({ type: 'categorical', genStrategy: 'tree' }, false)).toBe('none');
    });

    it('舊憑證沒有快照 → 維持原本「區間/時間泛化」', () => {
        expect(getKAnonymityGeneralizationTechLabel(undefined, t)).toBe('區間/時間泛化');
    });

    it('英文介面有對應翻譯', async () => {
        await i18n.changeLanguage('en_US');
        expect(getKAnonymityGeneralizationTechLabel('keep_prefix', t)).toBe('Keep String Prefix (rest masked)');
        await i18n.changeLanguage('zh_TW');
    });

    it('稽核紀錄寫入間接識別欄位的技術快照（僅 K-匿名模式）', () => {
        const base = {
            certificateId: 'C1', auditTime: 't', auditTimestamp: 0, fileName: 'a.csv', operatorName: 'u', operatorRole: 'data_owner',
            kValue: 5, queryCount: 1, hasAttackReport: false,
            simulationMetrics: { singling: { risk: 0 }, linkability: { risk: 0 }, inference: { risk: 0 }, overallRiskPercent: 0 } as never,
            datasetRowStats: { input: 1, deleted: 0, output: 1 }, isComplianceValid: true,
            columnNames: ['婚姻', '姓名'],
            resolveColumnRole: (c: string) => ({ role: c === '婚姻' ? 'Quasi-identifier' : 'Identifier' }),
            dpEnabledFieldNames: [],
            resolveQiGeneralizationTech: () => 'keep_prefix'
        };
        expect(buildPipelineAuditLogEntry({ ...base, privacyMode: 'k-anonymity' }).qiGeneralizationTechSnapshot).toEqual({ 婚姻: 'keep_prefix' });
        expect(buildPipelineAuditLogEntry({ ...base, privacyMode: 'differential-privacy' }).qiGeneralizationTechSnapshot).toBeUndefined();
    });
});
