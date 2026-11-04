// @vitest-environment jsdom
/**
 * ★ 2026-10-08 使用者反映：Step4 合規報告與歷史檢測紀錄調閱顯示不一致。
 *   兩處改用同一個 ComplianceReportDocument 與紀錄內的報告快照，這裡確認：
 *   1. 報告快照的組成與整體風險等級算法（與 Step4 畫面相同：三個白話問題取最高、CAP 扣除基線）
 *   2. 歷史檢測紀錄調閱視窗顯示的內容與直接繪製報告元件（Step4 所用）完全相同
 *   3. 舊紀錄（無快照）不會壞掉
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import ComplianceReportDocument from '../../components/ComplianceReportDocument';
import AuditLogHub from '../../features/audit_logs/AuditLogHub';
import { useAuditStore, type AuditLogItem } from '../../store/useAuditStore';
import { useAuthStore } from '../../store/useAuthStore';
import { buildComplianceReportSnapshot, computeReportOverallRisk, resolveSensitiveGuessRisk } from '../complianceReport';
import { buildPipelineAuditLogEntry } from '../../features/step4_result/pipeline/pipelineResults';
import { RISK_ATTACK_DEFAULT_PARAMS } from '../riskAssessment';

class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}
const stableTranslation = vi.hoisted(() => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
        const template = typeof fallback === 'string' ? fallback : key;
        return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    }
}));
vi.mock('react-i18next', () => ({ useTranslation: () => stableTranslation }));

const labels = { singling: '認出', linkability: '對上', sensitive: '猜出' };

const buildEntry = (): Omit<AuditLogItem, 'id'> => buildPipelineAuditLogEntry({
    certificateId: 'PAC-1', auditTime: '2026/10/8 上午10:00:00', auditTimestamp: 1,
    fileName: 'patients.csv', privacyMode: 'k-anonymity', operatorName: 'tester', operatorRole: 'data_owner',
    kValue: 5, queryCount: 0, hasAttackReport: true,
    simulationMetrics: {
        singling: { risk: 0.0123 },
        linkability: { risk: 0.0456 },
        inference: { risk: 0.03 },
        overallRiskPercent: '2.9'
    },
    datasetRowStats: { input: 100, deleted: 2, output: 98 },
    isComplianceValid: true,
    columnNames: ['姓名', '年齡', '疾病'],
    resolveColumnRole: (name) => name === '姓名' ? { role: 'Identifier', maskStrategy: 'remove' } : name === '年齡' ? { role: 'Quasi-identifier' } : { role: 'Sensitive' },
    resolveQiGeneralizationTech: () => 'numeric_range',
    dpEnabledFieldNames: [],
    reportSnapshot: buildComplianceReportSnapshot({
        privacyMode: 'k-anonymity', kValue: 5, maxSuppressionPercent: 5, limitExceededAction: 'stop_and_error',
        suppressionMethod: 'row', cellFillMethod: 'star', dpAccumulatedEpsilon: 0, dpAccumulatedDelta: 0, dpDefaultDelta: 0.0001,
        riskAttackParams: RISK_ATTACK_DEFAULT_PARAMS,
        attackRisks: { singling: 0.0123, linkability: 0.0456, inference: 0.03 },
        capReport: { cap_before: 0.9, cap_after: 0.5, n_original: 100, n_processed: 98, message: '', cap_baseline_after: 0.4, cap_after_excess: 0.1667 },
        suppressionRatePercent: 2, consumedEpsilon: null, deidentifiedColumnsCount: 2, totalColumnsCount: 3
    })
});

// 防篡改區塊為非同步驗證（「驗證中…」→ 結果），比對報告本文時排除該區塊
const normalizeText = (text: string | null | undefined): string => (text || '').split('紀錄防篡改資訊')[0].replace(/\s+/g, ' ').trim();

describe('合規報告快照', () => {
    it('K-匿名只存 K-匿名參數；DP 只存 DP 參數', () => {
        const kSnapshot = buildEntry().reportSnapshot!;
        expect(kSnapshot.kAnonymityConfig?.kValue).toBe(5);
        expect(kSnapshot.dpConfig).toBeUndefined();
        const dpSnapshot = buildComplianceReportSnapshot({
            privacyMode: 'differential-privacy', kValue: 5, maxSuppressionPercent: 5, limitExceededAction: null, suppressionMethod: null, cellFillMethod: null,
            dpAccumulatedEpsilon: 3.2, dpAccumulatedDelta: 0.0002, dpDefaultDelta: 0.0001, riskAttackParams: RISK_ATTACK_DEFAULT_PARAMS,
            attackRisks: null, capReport: null, suppressionRatePercent: 9, consumedEpsilon: '1.6' as unknown as number, deidentifiedColumnsCount: 1, totalColumnsCount: 4
        });
        expect(dpSnapshot.kAnonymityConfig).toBeUndefined();
        expect(dpSnapshot.dpConfig?.accumulatedEpsilon).toBe(3.2);
        expect(dpSnapshot.utility.consumedEpsilon).toBe(1.6);
        expect(dpSnapshot.utility.suppressionRatePercent).toBeNull();
    });

    it('整體等級：三個問題取最高，CAP 用扣除基線後的值（不是原始 CAP 50%）', () => {
        const snapshot = buildEntry().reportSnapshot!;
        const summary = computeReportOverallRisk(snapshot.attackRisks, snapshot.cap, labels);
        expect(summary?.driver.label).toBe('猜出');
        expect(summary?.driver.value).toBeCloseTo(0.1667);
        expect(summary?.info.code).toBe('FAIL'); // 0.1667 ≥ 0.09（★ 2026-11-04 改為通過／不通過）
        expect(resolveSensitiveGuessRisk(0.03, null)).toBe(0.03);
        expect(resolveSensitiveGuessRisk(undefined, null)).toBeNull();
    });
});

describe('Step4 報告與歷史檢測紀錄調閱內容一致', () => {
    // ★ 2026-10-28：歷史檢測紀錄只顯示目前帳號的紀錄，測試以紀錄的操作者 tester 登入
    beforeEach(() => { cleanup(); useAuditStore.setState({ auditLogs: [] }); useAuthStore.setState({ isAuthenticated: true, user: { name: 'tester', email: 'tester', role: 'data_owner' } } as Partial<ReturnType<typeof useAuthStore.getState>>); });

    it('調閱視窗與 Step4 報告元件呈現相同文字', async () => {
        const entry = buildEntry();
        useAuditStore.getState().addAuditLog(entry);
        const storedEntry = useAuditStore.getState().auditLogs[0];

        // Step4：直接繪製報告元件（Step4_Result 以同一筆紀錄繪製）
        const step4View = render(<AntdApp><ComplianceReportDocument entry={storedEntry} isExportingPdf={false} containerId="step4" /></AntdApp>);
        const step4Text = normalizeText(step4View.getByTestId('compliance-report-document').textContent);
        step4View.unmount();

        // 歷史檢測紀錄：點「調閱憑證」
        render(<AntdApp><AuditLogHub /></AntdApp>);
        fireEvent.click(screen.getByText('調閱憑證'));
        const historyDocument = await screen.findByTestId('compliance-report-document');
        const historyText = normalizeText(historyDocument.textContent);

        expect(historyText).toBe(step4Text);
        // 新版內容確實出現：處理配置、CAP、整體等級、效用、兩位小數
        expect(historyText).toContain('隱私強化處理配置');
        expect(historyText).toContain('1.23%');
        expect(historyText).toContain('不通過'); // ★ 2026-11-04：等級改為通過／不通過
        expect(historyText).toContain('2.000%');
        expect(historyText).toContain('2 / 3');
        expect(within(historyDocument).getByText('直接移除')).toBeTruthy();
    });

    it('列表的整體判定與報告相同（不通過），不再用舊的「綜合殘餘風險 %」', () => {
        useAuditStore.getState().addAuditLog(buildEntry());
        render(<AntdApp><AuditLogHub /></AntdApp>);
        expect(screen.getByTestId('risk-level-badge-FAIL')).toBeTruthy();
        expect(screen.queryByText('三大攻擊殘餘風險 (Singling/Link/Inf)')).toBeNull();
    });

    it('舊紀錄（無報告快照）仍可調閱，缺的項目標示未保存', async () => {
        const legacyEntry = { ...buildEntry() };
        delete legacyEntry.reportSnapshot;
        useAuditStore.getState().addAuditLog(legacyEntry);
        render(<AntdApp><AuditLogHub /></AntdApp>);
        fireEvent.click(screen.getByText('調閱憑證'));
        const historyDocument = await screen.findByTestId('compliance-report-document');
        expect(historyDocument.textContent).toContain('此紀錄建立於舊版，未保存此項');
        expect(historyDocument.textContent).toContain('1.2%');
    });
});
