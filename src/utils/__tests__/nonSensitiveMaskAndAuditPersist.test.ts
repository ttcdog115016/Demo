// @vitest-environment jsdom
/**
 * ★ 2026-10-28：
 *   - 非敏感欄位遮蔽（全遮蔽／部分遮蔽／雜湊／清空）送後端的設定與合規報告標示
 *   - 預設值與後端一致（三攻擊 n_iter 500）
 *   - 歷史檢測紀錄持久化（localStorage）、容量不足時保留最新紀錄、只顯示目前帳號的紀錄
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildKAnonymityConfig } from '../pipelineConfig';
import { resolveColumnTreatment } from '../plainResultSummary';
import { resolveReportColumnTechText, type ComplianceReportEntry } from '../complianceReport';
import { RISK_ATTACK_DEFAULT_PARAMS } from '../riskConfigImport';
import { quotaSafeAuditLogStorage, selectAuditLogsForUser, useAuditStore, AUDIT_LOG_STORAGE_KEY, type AuditLogItem } from '../../store/useAuditStore';

const baseSettings = { kValue: 5, lValue: 2, tValue: 0.7, enableLDiversity: false, enableTCloseness: false, maxSuppression: 20, suppressionMethod: 'row_suppression', cellFillMethod: 'star' as const, limitExceededAction: 'allow_with_warning' };

describe('非敏感欄位遮蔽', () => {
    it('全遮蔽／部分遮蔽／雜湊／清空照後端欄位送出；敏感欄位與日期全遮蔽不送', () => {
        const config = buildKAnonymityConfig({
            ...baseSettings, hashAlgorithm: 'sha3-256',
            processedColumnNames: ['電話', '地址', '員編', '備註', '疾病', '到院時間'],
            kAnonymityFields: [
                { name: '電話', role: 'Non-sensitive', type: 'string', maskStrategy: 'partial', maskKeepChars: 4, maskMode: 'prefix', maskChar: '*' },
                { name: '地址', role: 'Non-sensitive', type: 'string', maskStrategy: 'mask', maskChar: '#', maskLength: 6 },
                { name: '員編', role: 'Non-sensitive', type: 'string', maskStrategy: 'hash' },
                { name: '備註', role: 'Non-sensitive', type: 'string', maskStrategy: 'clear' },
                { name: '疾病', role: 'Sensitive', type: 'categorical', maskStrategy: 'mask' },
                { name: '到院時間', role: 'Non-sensitive', type: 'temporal', maskStrategy: 'mask' },
            ],
            kAnonymityHierarchies: [], resolveFallbackUiRole: () => 'Non-sensitive'
        }).k_anonymity as { algorithm?: string; columns: Record<string, Record<string, unknown>> };
        expect(config.columns['電話']).toEqual({ role: 'non_sensitive', type: 'string', strategy: 'partial', mask_char: '*', mask_mode: 'prefix', keep_chars: 4 });
        expect(config.columns['地址']).toEqual({ role: 'non_sensitive', type: 'string', strategy: 'mask', mask_char: '#', mask_length: 6 });
        expect(config.columns['員編'].strategy).toBe('hash');
        expect(config.columns['備註'].strategy).toBe('clear');
        expect(config.columns['疾病']).not.toHaveProperty('strategy');
        expect(config.columns['到院時間']).not.toHaveProperty('strategy');
        expect(config.algorithm).toBe('sha3-256');
    });

    it('全遮蔽未指定長度時不送 mask_length（沿用原值長度）', () => {
        const config = buildKAnonymityConfig({
            ...baseSettings, processedColumnNames: ['地址'],
            kAnonymityFields: [{ name: '地址', role: 'Non-sensitive', type: 'string', maskStrategy: 'mask', maskChar: '*', maskLength: 0 }],
            kAnonymityHierarchies: [], resolveFallbackUiRole: () => 'Non-sensitive'
        }).k_anonymity as { columns: Record<string, Record<string, unknown>> };
        expect(config.columns['地址']).toEqual({ role: 'non_sensitive', type: 'string', strategy: 'mask', mask_char: '*' });
    });

    it('Step4 欄位處理與合規報告標示', () => {
        const base = { columnName: 'x', privacyMode: 'k-anonymity', isActuallyDeidentified: true, isDpNoised: false, role: 'Non-sensitive' };
        expect(resolveColumnTreatment({ ...base, maskStrategy: 'mask' }).plainText).toBe('全部遮蔽');
        expect(resolveColumnTreatment({ ...base, maskStrategy: 'partial' }).plainText).toBe('部分遮蔽');
        expect(resolveColumnTreatment({ ...base, maskStrategy: 'hash' }).plainText).toBe('換成代碼（雜湊）');
        expect(resolveColumnTreatment({ ...base, maskStrategy: 'clear' }).plainText).toBe('已清空');
        const entry = { privacyMode: 'k-anonymity', columnRoleSnapshot: { a: 'Non-sensitive', b: 'Non-sensitive' }, identifierMaskStrategySnapshot: { a: 'partial', b: 'mask' } } as unknown as ComplianceReportEntry;
        expect(resolveReportColumnTechText(entry, 'a', (_key, fallback) => fallback).techText).toBe('部分遮蔽');
        expect(resolveReportColumnTechText(entry, 'b', (_key, fallback) => fallback).techText).toBe('全遮蔽');
    });
});

describe('預設值與後端一致', () => {
    it('三攻擊迭代次數預設 500', () => {
        expect(RISK_ATTACK_DEFAULT_PARAMS).toEqual({ n_iter: 500, ctrl_ratio: 0.2, seed: 42, n_subset: 500, n_repeats: 1, overlap_ratio: 0 });
    });
});

describe('歷史檢測紀錄持久化', () => {
    const makeLog = (operator: string, certificateId: string) => ({ certificateId, operator, fileName: 'a.csv', privacyMode: 'k-anonymity' } as unknown as Omit<AuditLogItem, 'id'>);
    beforeEach(() => { localStorage.clear(); useAuditStore.setState({ auditLogs: [] }); });

    it('新增紀錄寫入 localStorage，重新讀取後仍在', async () => {
        useAuditStore.getState().addAuditLog(makeLog('alice', 'PAC-1'));
        const rawStored = localStorage.getItem(AUDIT_LOG_STORAGE_KEY) || '{}';
        expect(JSON.parse(rawStored).state.auditLogs[0].certificateId).toBe('PAC-1');
        // 模擬重新整理：記憶體清空（setState 也會寫回空陣列），再放回重新整理前的瀏覽器資料後讀取
        useAuditStore.setState({ auditLogs: [] });
        localStorage.setItem(AUDIT_LOG_STORAGE_KEY, rawStored);
        await useAuditStore.persist.rehydrate();
        expect(useAuditStore.getState().auditLogs.map((log) => log.certificateId)).toEqual(['PAC-1']);
    });

    it('只顯示目前帳號的紀錄；未登入不顯示', () => {
        const logs = [makeLog('alice', 'A'), makeLog('bob', 'B')].map((log, index) => ({ ...log, id: String(index) })) as AuditLogItem[];
        expect(selectAuditLogsForUser(logs, 'alice').map((log) => log.certificateId)).toEqual(['A']);
        expect(selectAuditLogsForUser(logs, undefined)).toEqual([]);
    });

    it('瀏覽器容量不足時捨棄最舊的一半再寫入', () => {
        const originalSetItem = Storage.prototype.setItem;
        let callCount = 0;
        Storage.prototype.setItem = function (key: string, value: string) {
            callCount += 1;
            if (callCount === 1) throw new DOMException('full', 'QuotaExceededError');
            return originalSetItem.call(this, key, value);
        };
        try {
            const payload = JSON.stringify({ state: { auditLogs: [{ id: 'new' }, { id: 'mid' }, { id: 'old1' }, { id: 'old2' }] }, version: 0 });
            quotaSafeAuditLogStorage.setItem(AUDIT_LOG_STORAGE_KEY, payload);
        } finally {
            Storage.prototype.setItem = originalSetItem;
        }
        expect(JSON.parse(localStorage.getItem(AUDIT_LOG_STORAGE_KEY) || '{}').state.auditLogs.map((log: { id: string }) => log.id)).toEqual(['new', 'mid']);
    });
});
