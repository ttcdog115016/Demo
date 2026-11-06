/**
 * ★ 2026-11-06：合規結果納入風險評估——未評估＝未完成風險評估、風險不通過＝未達合規標準。
 */
import { describe, it, expect } from 'vitest';
import { resolveComplianceStatus, resolveAuditLogComplianceStatus, type ComplianceReportSnapshot } from '../complianceReport';
import { computeOverallRiskLevel } from '../riskLevel';

const lowRisk = computeOverallRiskLevel([{ label: 'a', value: 0.01 }]);
const highRisk = computeOverallRiskLevel([{ label: 'a', value: 0.2 }]);

const snapshotWith = (attackRisks: ComplianceReportSnapshot['attackRisks'], cap: ComplianceReportSnapshot['cap'] = null): ComplianceReportSnapshot =>
    ({ attackRisks, cap } as unknown as ComplianceReportSnapshot);

describe('resolveComplianceStatus', () => {
    it('去識別化未達標＝failed（不論風險）', () => {
        expect(resolveComplianceStatus(false, lowRisk)).toBe('failed');
        expect(resolveComplianceStatus(false, null)).toBe('failed');
    });
    it('風險未評估＝unassessed', () => expect(resolveComplianceStatus(true, null)).toBe('unassessed'));
    it('風險不通過＝failed', () => expect(resolveComplianceStatus(true, highRisk)).toBe('failed'));
    it('兩者皆通過＝passed', () => expect(resolveComplianceStatus(true, lowRisk)).toBe('passed'));
});

describe('resolveAuditLogComplianceStatus（含舊紀錄）', () => {
    it('舊紀錄存 passed、無快照、整體風險「未評估」→ unassessed', () => {
        expect(resolveAuditLogComplianceStatus({ status: 'passed', overallRisk: '未評估' })).toBe('unassessed');
    });
    it('舊紀錄存 passed、快照無三攻擊與 CAP → unassessed', () => {
        expect(resolveAuditLogComplianceStatus({ status: 'passed', overallRisk: '未評估', reportSnapshot: snapshotWith(null) })).toBe('unassessed');
    });
    it('舊紀錄存 passed、快照風險 ≥ 9% → failed', () => {
        expect(resolveAuditLogComplianceStatus({ status: 'passed', overallRisk: '20.0%', reportSnapshot: snapshotWith({ singling: 0.2, linkability: 0, inference: 0 }) })).toBe('failed');
    });
    it('快照風險皆 < 9% → passed', () => {
        expect(resolveAuditLogComplianceStatus({ status: 'passed', overallRisk: '1.0%', reportSnapshot: snapshotWith({ singling: 0.01, linkability: 0.02, inference: 0 }) })).toBe('passed');
    });
    it('存的是 failed 一律 failed', () => {
        expect(resolveAuditLogComplianceStatus({ status: 'failed', overallRisk: '1.0%', reportSnapshot: snapshotWith({ singling: 0.01, linkability: 0, inference: 0 }) })).toBe('failed');
    });
    it('無快照、有百分比的舊紀錄維持原狀態', () => {
        expect(resolveAuditLogComplianceStatus({ status: 'passed', overallRisk: '3.0%' })).toBe('passed');
    });
});
