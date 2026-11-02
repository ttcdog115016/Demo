// @vitest-environment jsdom
/**
 * ★ 2026-10-28：K-匿名欄位處理方式對齊後端 v2.0.0
 *   - 識別欄位：刪除／雜湊／清空＋雜湊演算法（k_anonymity.algorithm）
 *   - 敏感／非敏感欄位選「刪除」要實際送到後端（先前沒送，輸出仍保留該欄）
 *   - 合規報告補充：l／t、雜湊演算法、資料預先處理、風險評估對象、DP 各欄 ε、後端說明
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen } from '@testing-library/react';
import unifiedConfigText from './fixtures/backend_config_unified_v2.json?raw';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
const stableTranslation = vi.hoisted(() => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
        const template = typeof fallback === 'string' ? fallback : ((fallback as { defaultValue?: string } | undefined)?.defaultValue ?? key);
        return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    }
}));
vi.mock('react-i18next', () => ({ useTranslation: () => stableTranslation }));
vi.mock('echarts-for-react', () => ({ default: () => null }));
const messageMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), destroy: vi.fn() }));
vi.mock('antd', async () => {
    const actual = await vi.importActual<typeof import('antd')>('antd');
    const MockApp = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    MockApp.useApp = () => ({ message: messageMock, modal: { confirm: vi.fn() }, notification: { error: vi.fn(), warning: vi.fn() } });
    return { ...actual, App: MockApp };
});

import KAnonymityMapping from '../../features/step2_mapping/KAnonymityMapping';
import ComplianceReportDocument from '../../components/ComplianceReportDocument';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { buildBackendConfigDocumentFromWorkspace, buildKAnonymityConfig } from '../pipelineConfig';
import { resolveKAnonymityRiskColumns } from '../riskAssessment';
import { buildComplianceReportSnapshot, resolveReportColumnTechText } from '../complianceReport';
import { buildPipelineAuditLogEntry } from '../../features/step4_result/pipeline/pipelineResults';
import { RISK_ATTACK_DEFAULT_PARAMS } from '../riskConfigImport';
import { describePreprocessingForReport, describeRiskSubgroupForReport } from '../reportDescriptions';

const SAMPLE_COLUMNS = ['姓名', '身分證號', '地址', '出生日期', '就診時間', '年齡', '職業', '婚姻狀況', '疾病', '醫療費用', '檢驗值_血糖', '就醫次數', '保險別'];
const baseSettings = { kValue: 5, lValue: 2, tValue: 0.7, enableLDiversity: false, enableTCloseness: false, maxSuppression: 20, suppressionMethod: 'row_suppression', cellFillMethod: 'star' as const, limitExceededAction: 'allow_with_warning' };

describe('K-匿名欄位處理方式（後端 v2.0.0）', () => {
    afterEach(() => cleanup());

    it('識別欄位 雜湊／清空／刪除 照送；有雜湊時帶演算法；敏感／非敏感欄位「刪除」也送出', () => {
        const config = buildKAnonymityConfig({
            ...baseSettings, hashAlgorithm: 'sha256',
            processedColumnNames: ['姓名', '身分證號', '電話', '備註', '疾病', '收入'],
            kAnonymityFields: [
                { name: '姓名', role: 'Identifier', type: 'string', maskStrategy: 'hash' },
                { name: '身分證號', role: 'Identifier', type: 'string', maskStrategy: 'clear' },
                { name: '電話', role: 'Identifier', type: 'string', maskStrategy: 'remove' },
                { name: '備註', role: 'Non-sensitive', type: 'string', maskStrategy: 'remove' },
                { name: '疾病', role: 'Sensitive', type: 'categorical', maskStrategy: 'none' },
                { name: '收入', role: 'Sensitive', type: 'numeric', maskStrategy: 'remove' },
            ],
            kAnonymityHierarchies: [], resolveFallbackUiRole: () => 'Non-sensitive'
        }).k_anonymity as { algorithm?: string; columns: Record<string, { strategy?: string }> };
        expect(config.algorithm).toBe('sha256');
        expect(config.columns['姓名'].strategy).toBe('hash');
        expect(config.columns['身分證號'].strategy).toBe('clear');
        expect(config.columns['電話'].strategy).toBe('remove');
        expect(config.columns['備註'].strategy).toBe('remove');
        expect(config.columns['收入'].strategy).toBe('remove');
        expect(config.columns['疾病'].strategy).toBeUndefined();
    });

    it('沒有欄位用雜湊時不送 algorithm', () => {
        const config = buildKAnonymityConfig({
            ...baseSettings, hashAlgorithm: 'sha256', processedColumnNames: ['姓名'],
            kAnonymityFields: [{ name: '姓名', role: 'Identifier', type: 'string', maskStrategy: 'remove' }],
            kAnonymityHierarchies: [], resolveFallbackUiRole: () => 'Non-sensitive'
        }).k_anonymity as Record<string, unknown>;
        expect(config).not.toHaveProperty('algorithm');
    });

    it('敏感欄位選刪除時不當風險評估欄位（處理後資料沒有這一欄）', () => {
        const { riskColumnsMap } = resolveKAnonymityRiskColumns({
            processedColumnNames: ['年齡', '疾病', '收入'],
            kAnonymityFields: [
                { name: '年齡', role: 'Quasi-identifier', type: 'numeric' },
                { name: '疾病', role: 'Sensitive', type: 'categorical', maskStrategy: 'none' },
                { name: '收入', role: 'Sensitive', type: 'numeric', maskStrategy: 'remove' },
            ],
            resolveFallbackUiRole: () => 'Non-sensitive'
        });
        expect(Object.keys(riskColumnsMap)).toEqual(['年齡', '疾病']);
    });

    it('匯入統合版：姓名＝雜湊、身分證號＝清空，送出的設定檔與統合版相同', async () => {
        useWorkspaceStore.setState({
            columns: SAMPLE_COLUMNS, previewData: [], fileName: '範例資料.csv', preprocessingRules: {}, missingValueRules: {},
            privacyMode: 'k-anonymity', kAnonymityFields: [], kAnonymityHierarchies: [], columnRoles: {}, columnTypes: {}, kAnonymityHashAlgorithm: 'sha256'
        } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
        const { container } = render(<KAnonymityMapping />);
        fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File([unifiedConfigText], 'config.json', { type: 'application/json' })] } });
        await waitFor(() => expect(messageMock.success).toHaveBeenCalled());
        expect(screen.getByTestId('kanon-hash-algorithm')).toBeTruthy();
        cleanup();
        const state = useWorkspaceStore.getState();
        expect(state.kAnonymityHashAlgorithm).toBe('sha3-256');
        const configDocument = buildBackendConfigDocumentFromWorkspace(state) as { k_anonymity: { algorithm?: string; columns: Record<string, { strategy?: string }> } };
        expect(configDocument.k_anonymity.algorithm).toBe('sha3-256');
        expect(configDocument.k_anonymity.columns['姓名'].strategy).toBe('hash');
        expect(configDocument.k_anonymity.columns['身分證號'].strategy).toBe('clear');
    });
});

describe('合規報告補充資訊', () => {
    afterEach(() => cleanup());

    const buildEntry = (privacyMode: 'k-anonymity' | 'differential-privacy') => buildPipelineAuditLogEntry({
        certificateId: 'PAC-9', auditTime: '2026/10/28', auditTimestamp: 1, fileName: '範例資料.csv', privacyMode,
        operatorName: 't', operatorRole: 'data_owner', kValue: 5, queryCount: 0, hasAttackReport: true,
        simulationMetrics: { singling: { risk: 0.01 }, linkability: { risk: 0.02 }, inference: { risk: 0.03 }, overallRiskPercent: '3.0' },
        datasetRowStats: { input: 10, deleted: 0, output: 10 }, isComplianceValid: true,
        columnNames: ['姓名', '身分證號', '備註', '年齡'],
        resolveColumnRole: (name) => ({
            姓名: { role: 'Identifier', maskStrategy: 'hash' }, 身分證號: { role: 'Identifier', maskStrategy: 'clear' },
            備註: { role: 'Non-sensitive', maskStrategy: 'remove' }, 年齡: { role: 'Quasi-identifier' }
        } as Record<string, { role: string; maskStrategy?: string }>)[name],
        dpEnabledFieldNames: ['年齡'],
        reportSnapshot: buildComplianceReportSnapshot({
            privacyMode, kValue: 5, maxSuppressionPercent: 20, limitExceededAction: 'allow_with_warning', suppressionMethod: 'row_suppression', cellFillMethod: 'star',
            dpAccumulatedEpsilon: 1, dpAccumulatedDelta: 0, dpDefaultDelta: 1e-5, riskAttackParams: RISK_ATTACK_DEFAULT_PARAMS,
            attackRisks: { singling: 0.01, linkability: 0.02, inference: 0.03 }, capReport: null,
            suppressionRatePercent: 0, consumedEpsilon: 1, consumedDelta: 1e-5, deidentifiedColumnsCount: 3, totalColumnsCount: 4,
            lValue: 2, tValue: null, hashAlgorithm: 'sha3-256', hashSalted: true,
            preprocessing: describePreprocessingForReport(['地址', '職業'], { 地址: [{ action: 'trim', params: { mode: 'edges' } }, { action: 'regex_replace', params: { pattern: '(?<=區).*$', placeholder: '' } }] }, { 職業: { strategy: 'constant', constantValue: '未填' } }),
            riskTargets: { source: 'imported', quasiIdentifiers: ['年齡', '職業'], sensitive: ['疾病'], subgroupLines: describeRiskSubgroupForReport({ 年齡: { kind: 'range', min: '38', max: '45' } }), linkability: { A: ['年齡'], B: ['職業'] } },
            dpColumnEpsilon: { 年齡: 2 },
            backendNotes: ['系統套用預設值：algorithm=sha3-256', '子群體篩選後 120 筆']
        })
    });

    it('K-匿名報告：l 值、雜湊演算法、資料預先處理、風險評估對象（依匯入設定）、識別欄位處理方式、後端說明', () => {
        render(<ComplianceReportDocument entry={buildEntry('k-anonymity')} isExportingPdf={false} containerId="r" />);
        const text = document.body.textContent || '';
        expect(text).toContain('l 值（l-多樣性）2');
        expect(text).not.toContain('t 值（t-緊密度）');
        expect(text).toContain('SHA3-256（加鹽）');
        expect(text).toContain('資料預先處理：地址去除前後空白 → 正則替換 (?<=區).*$ → 「」');
        expect(text).toContain('資料預先處理：職業缺值填入「未填」');
        expect(text).toContain('依匯入的風險評估設定（與去識別化的欄位角色不同）');
        expect(text).toContain('年齡：38～45');
        expect(text).toContain('A：年齡／B：職業');
        expect(text).toContain('雜湊（假名化）');
        expect(text).toContain('清空值（保留欄位）');
        expect(screen.getByTestId('compliance-report-backend-notes').textContent).toContain('子群體篩選後 120 筆');
        const entry = buildEntry('k-anonymity');
        expect(resolveReportColumnTechText(entry, '備註', (_key, fallback) => fallback).techText).toBe('直接移除');
    });

    it('差分隱私報告：各加噪欄位列出 ε，並列本次消耗 δ', () => {
        render(<ComplianceReportDocument entry={buildEntry('differential-privacy')} isExportingPdf={false} containerId="r" />);
        const text = document.body.textContent || '';
        expect(text).toContain('差分隱私加噪（ε = 2）');
        expect(text).toContain('本次消耗 δ：0.00001');
    });

    it('差分隱私報告：δ 為 0（未設定全域 δ、全為純 ε 欄位）時加註純 ε-DP，不再誤印 0.00001（★ 2026-10-31）', () => {
        const entry = buildEntry('differential-privacy');
        const snapshot = entry.reportSnapshot!;
        const zeroDeltaEntry = {
            ...entry,
            reportSnapshot: { ...snapshot, dpConfig: { ...snapshot.dpConfig!, defaultDelta: 0 }, utility: { ...snapshot.utility, consumedDelta: 0 } }
        };
        render(<ComplianceReportDocument entry={zeroDeltaEntry} isExportingPdf={false} containerId="r" />);
        const text = document.body.textContent || '';
        expect(text).toContain('0（未設定，純 ε-DP）');
        expect(text).toContain('本次消耗 δ：0（純 ε-DP）');
        expect(text).not.toContain('0.00001');
        expect(buildComplianceReportSnapshot({
            privacyMode: 'differential-privacy', kValue: 5, maxSuppressionPercent: 20, limitExceededAction: 'allow_with_warning', suppressionMethod: 'row_suppression', cellFillMethod: 'star',
            dpAccumulatedEpsilon: 1, dpAccumulatedDelta: 0, dpDefaultDelta: undefined, riskAttackParams: RISK_ATTACK_DEFAULT_PARAMS, attackRisks: null, capReport: null,
            suppressionRatePercent: null, consumedEpsilon: 1, consumedDelta: 0, deidentifiedColumnsCount: 1, totalColumnsCount: 1
        }).dpConfig?.defaultDelta).toBe(0);
    });

    it('舊紀錄（沒有補充欄位）照常繪製，不列新項目', () => {
        const entry = buildEntry('k-anonymity');
        const legacySnapshot = { ...entry.reportSnapshot! };
        delete legacySnapshot.preprocessing; delete legacySnapshot.riskTargets; delete legacySnapshot.backendNotes;
        render(<ComplianceReportDocument entry={{ ...entry, reportSnapshot: legacySnapshot }} isExportingPdf={false} containerId="r" />);
        expect(screen.queryByTestId('compliance-report-risk-targets')).toBeNull();
        expect(screen.queryByTestId('compliance-report-backend-notes')).toBeNull();
        expect(document.body.textContent).not.toContain('資料預先處理');
    });
});
