// @vitest-environment jsdom
/**
 * ★ 2026-10-28：
 *   - 非敏感欄位遮蔽（全遮蔽／部分遮蔽／雜湊／清空）送後端的設定與合規報告標示
 *   - 預設值與後端一致（三攻擊 n_iter 500）
 *   - 歷史檢測紀錄只顯示目前帳號的紀錄
 * ★ 2026-10-29：紀錄改存後端（POST／GET /api/v1/history），寫入與載入改測 systemApi 的呼叫
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildKAnonymityConfig } from '../pipelineConfig';
import { resolveColumnTreatment } from '../plainResultSummary';
import { resolveReportColumnTechText, type ComplianceReportEntry } from '../complianceReport';
import { RISK_ATTACK_DEFAULT_PARAMS } from '../riskConfigImport';
import { selectAuditLogsForUser, useAuditStore, type AuditLogItem } from '../../store/useAuditStore';

const { postHistoryMock, fetchHistoryMock } = vi.hoisted(() => ({ postHistoryMock: vi.fn(), fetchHistoryMock: vi.fn() }));
vi.mock('../../api/systemApi', () => ({ postHistory: postHistoryMock, fetchHistory: fetchHistoryMock }));

const baseSettings = { kValue: 5, lValue: 2, tValue: 0.7, enableLDiversity: false, enableTCloseness: false, maxSuppression: 20, suppressionMethod: 'row_suppression', cellFillMethod: 'star' as const, limitExceededAction: 'allow_with_warning' };

describe('非敏感欄位遮蔽', () => {
    it('全遮蔽／部分遮蔽／清空照後端欄位送出；舊狀態的雜湊改送刪除；敏感欄位與日期全遮蔽不送', () => {
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
        expect(config.columns['員編'].strategy).toBe('remove'); // ★ 2026-11-04：K-匿名不再雜湊
        expect(config.columns['備註'].strategy).toBe('clear');
        expect(config.columns['疾病']).not.toHaveProperty('strategy');
        expect(config.columns['到院時間']).not.toHaveProperty('strategy');
        expect(config).not.toHaveProperty('algorithm');
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

describe('歷史檢測紀錄（存後端）', () => {
    const makeLog = (operator: string, certificateId: string) => ({ certificateId, operator, fileName: 'a.csv', privacyMode: 'k-anonymity' } as unknown as Omit<AuditLogItem, 'id'>);
    beforeEach(() => {
        useAuditStore.setState({ auditLogs: [] });
        postHistoryMock.mockReset().mockResolvedValue({});
        fetchHistoryMock.mockReset();
    });

    it('新增紀錄立即出現在畫面上，送到後端後以伺服器簽章的版本取代', async () => {
        postHistoryMock.mockImplementation(async (record: AuditLogItem) => ({ ...record, integrity: { signature: 'server-sig', inputFileSha256: null, outputFileSha256: null } }));
        const savePromise = useAuditStore.getState().addAuditLog(makeLog('alice', 'PAC-1'));
        const [optimisticLog] = useAuditStore.getState().auditLogs;
        expect(optimisticLog.certificateId).toBe('PAC-1');
        expect(postHistoryMock).toHaveBeenCalledWith(optimisticLog);
        expect(await savePromise).toBe(true);
        const [savedLog] = useAuditStore.getState().auditLogs;
        expect(savedLog.id).toBe(optimisticLog.id);
        expect(savedLog.integrity?.signature).toBe('server-sig');
    });

    it('後端寫入失敗：回傳 false 讓畫面提示，紀錄仍留在畫面上', async () => {
        postHistoryMock.mockRejectedValue(new Error('offline'));
        expect(await useAuditStore.getState().addAuditLog(makeLog('alice', 'PAC-2'))).toBe(false);
        expect(useAuditStore.getState().auditLogs.map((log) => log.certificateId)).toEqual(['PAC-2']);
    });

    it('登入後自後端載入；登出清空畫面', async () => {
        fetchHistoryMock.mockResolvedValue([{ ...makeLog('alice', 'S-1'), id: 's1' }]);
        await useAuditStore.getState().loadAuditLogs();
        expect(useAuditStore.getState().auditLogs.map((log) => log.certificateId)).toEqual(['S-1']);
        useAuditStore.getState().clearAuditLogs();
        expect(useAuditStore.getState().auditLogs).toEqual([]);
    });

    it('只顯示目前帳號的紀錄；未登入不顯示', () => {
        const logs = [makeLog('alice', 'A'), makeLog('bob', 'B')].map((log, index) => ({ ...log, id: String(index) })) as AuditLogItem[];
        expect(selectAuditLogsForUser(logs, 'alice').map((log) => log.certificateId)).toEqual(['A']);
        expect(selectAuditLogsForUser(logs, undefined)).toEqual([]);
    });
});
