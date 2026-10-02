import { describe, it, expect } from 'vitest';
import type { AuditLogItem } from '../../store/useAuditStore';
import { canonicalJsonStringify, createAuditIntegrity, verifyAuditIntegrity, sha256HexOfText } from '../auditIntegrity';

const baseEntry: Omit<AuditLogItem, 'id'> = {
    certificateId: 'CERT-20261002-TEST', fileName: 'demo.csv', privacyMode: 'k-anonymity', operator: 'Data.Owner.A', operatorRole: 'data_owner',
    auditTime: '2026/10/2 上午10:00:00', auditTimestamp: 1790900000000, parameters: 'K=3', singlingRisk: '1.0%', linkabilityRisk: '2.0%',
    inferenceRisk: '3.0%', overallRisk: '3.0%', inputRowCount: 100, deletedRowCount: 2, outputRowCount: 98, status: 'passed',
    columnsSnapshot: ['姓名', '年齡'], columnRoleSnapshot: { 姓名: 'Identifier', 年齡: 'Quasi-identifier' },
    identifierMaskStrategySnapshot: { 姓名: 'remove' }, dpEnabledFieldNamesSnapshot: []
};

describe('稽核憑證防篡改指紋與數位簽章', () => {
    it('canonical JSON：鍵值順序不同仍得到相同字串', () => {
        expect(canonicalJsonStringify({ b: 1, a: { d: [2, 1], c: null } })).toBe(canonicalJsonStringify({ a: { c: null, d: [2, 1] }, b: 1 }));
        expect(canonicalJsonStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
    });

    it('SHA-256 與已知值相符', async () => {
        expect(await sha256HexOfText('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('簽發後驗證通過；改動任一欄位或簽章即判定竄改', async () => {
        const inputFile = new Blob(['a,b\n1,2\n']);
        const outputFile = new Blob(['a,b\n*,2\n']);
        const integrity = await createAuditIntegrity(baseEntry, { inputFile, outputFile });
        expect(integrity.documentSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(integrity.inputFileSha256).toBe(await sha256HexOfText('a,b\n1,2\n'));
        const signedEntry: AuditLogItem = { ...baseEntry, id: 'x', integrity };
        const expectedStatus = integrity.signature ? 'valid' : 'unsigned';
        expect((await verifyAuditIntegrity(signedEntry)).status).toBe(expectedStatus);
        expect((await verifyAuditIntegrity({ ...signedEntry, overallRisk: '0.1%' })).status).toBe('tampered');
        expect((await verifyAuditIntegrity({ ...signedEntry, columnRoleSnapshot: { 姓名: 'Non-sensitive', 年齡: 'Quasi-identifier' } })).status).toBe('tampered');
        if (integrity.signature) {
            const flippedSignature = (integrity.signature[0] === 'A' ? 'B' : 'A') + integrity.signature.slice(1);
            expect((await verifyAuditIntegrity({ ...signedEntry, integrity: { ...integrity, signature: flippedSignature } })).status).toBe('tampered');
        }
    });

    it('沒有防篡改資料的舊紀錄回報 missing', async () => {
        expect((await verifyAuditIntegrity({ ...baseEntry, id: 'old' })).status).toBe('missing');
    });
});
