// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { App as AntdApp } from 'antd';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }) }));

import AuditLogHub from '../AuditLogHub';
import { useAuditStore, type AuditLogItem } from '../../../store/useAuditStore';
import { useAuthStore } from '../../../store/useAuthStore';

const makeLog = (id: string, status: AuditLogItem['status'], privacyMode = 'k-anonymity'): AuditLogItem => ({
    id, certificateId: `CERT-${id}`, fileName: `${id}.csv`, privacyMode, operator: 'tester', operatorRole: 'user',
    auditTime: '2026/11/3', auditTimestamp: 0, parameters: '', singlingRisk: '', linkabilityRisk: '', inferenceRisk: '', overallRisk: '',
    inputRowCount: 0, deletedRowCount: 0, outputRowCount: 0, status,
    columnsSnapshot: [], columnRoleSnapshot: {}, identifierMaskStrategySnapshot: {}, dpEnabledFieldNamesSnapshot: [],
});

const LOGS = [makeLog('p1', 'passed'), makeLog('p2', 'passed', 'differential-privacy'), makeLog('f1', 'failed'), makeLog('f2', 'failed', 'differential-privacy')];

const shownCertificates = (): string[] => screen.queryAllByText(/^CERT-/).map((node) => node.textContent ?? '').sort();

describe('處理紀錄：合規結果篩選', () => {
    beforeEach(() => {
        useAuthStore.setState({ user: { name: 'tester', role: 'user' } } as unknown as Parameters<typeof useAuthStore.setState>[0]);
        useAuditStore.setState({ auditLogs: LOGS, loadAuditLogs: async () => true });
        render(<AntdApp><AuditLogHub /></AntdApp>);
    });
    afterEach(() => cleanup());

    it('預設列出全部紀錄', () => {
        expect(shownCertificates()).toEqual(['CERT-f1', 'CERT-f2', 'CERT-p1', 'CERT-p2']);
    });

    it('點統計卡切換篩選，再點一次回到全部', () => {
        fireEvent.click(screen.getByTestId('audit-stats-card-failed'));
        expect(shownCertificates()).toEqual(['CERT-f1', 'CERT-f2']);
        fireEvent.click(screen.getByTestId('audit-stats-card-passed'));
        expect(shownCertificates()).toEqual(['CERT-p1', 'CERT-p2']);
        fireEvent.click(screen.getByTestId('audit-stats-card-passed'));
        expect(shownCertificates()).toHaveLength(4);
    });

    it('下拉選單與統計卡同步，且可與關鍵字搜尋並用', () => {
        fireEvent.click(screen.getByTestId('audit-stats-card-failed'));
        expect(within(screen.getByTestId('audit-compliance-filter')).getByText('未達合規標準')).toBeTruthy();
        fireEvent.change(screen.getByPlaceholderText('搜尋憑證編號、檔案名稱、操作者...'), { target: { value: 'f2' } });
        expect(shownCertificates()).toEqual(['CERT-f2']);
    });
});
