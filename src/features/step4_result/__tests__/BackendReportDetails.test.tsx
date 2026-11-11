// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }) }));

import BackendReportDetails from '../BackendReportDetails';
import { describeDpColumnStep, formatReportListItem } from '../pipeline/backendReportFormat';
import type { KAnonymityQualityReport, DpQualityReport } from '../../../api/apiService';

// 後端 2_操作說明.md 2-5 節的品質報告範例
const K_REPORT: KAnonymityQualityReport = {
    is_valid: true, k_passed: true, l_passed: true, t_passed: true, suppression_rate_percent: 0.4703, suppression_unit: 'row',
    suppressed_count: 4703, suppression_total_count: 1000000, hash_algorithm: 'sha3-256', hash_salted: false,
    message: 'K-匿名化處理成功', recommendations: ['泛化層級 min/max 範圍評估：目前套用最小層級（min），落單比例約 0.5%'], applied_defaults: ['algorithm=sha3-256']
};
// 後端 3-5 節的預算報告範例（節錄）
const DP_REPORT: DpQualityReport = {
    consumed_epsilon: 17, consumed_delta: 2e-5, accumulated_epsilon: 17, accumulated_delta: 2e-5, message: '',
    per_column: [
        { column: '薪資', type: 'continuous', mechanism: 'DiscreteGaussian', epsilon: 5, delta: 1e-5, sensitivity: 125, sensitivity_source: 'user', minimum_unit: 1000, out_of_bounds_strategy: 'fold' },
        { column: '地區', type: 'categorical', mechanism: 'k-RR', epsilon: 1, delta: 0, sensitivity: null, sensitivity_source: null },
        { column: '生日', type: 'datetime', mechanism: 'DiscreteLaplace', epsilon: 1, delta: 0, sensitivity: 53, sensitivity_source: 'user', noise_unit: 'day', noise_step: 7, out_of_bounds_strategy: 'clamp' }
    ]
};

const expand = () => fireEvent.click(screen.getByText('後端處理報告明細'));

describe('Step4 後端處理報告明細', () => {
    afterEach(() => cleanup());

    it('沒有報告時不顯示', () => {
        const { container } = render(<BackendReportDetails kReport={null} dpReport={null} />);
        expect(container.textContent).toBe('');
    });

    it('K-匿名：顯示雜湊演算法、是否加鹽、系統預設值與後端建議原文', () => {
        render(<BackendReportDetails kReport={K_REPORT} dpReport={null} />);
        expand();
        const detailsText = screen.getByTestId('kanon-report-details').textContent;
        expect(detailsText).toContain('sha3-256');
        expect(detailsText).toContain('未加鹽');
        expect(detailsText).toContain('algorithm=sha3-256');
        expect(detailsText).toContain('泛化層級 min/max 範圍評估');
    });

    it('差分隱私：逐欄列出機制、δ、刻度數敏感度、刻度與溢出處理', () => {
        render(<BackendReportDetails kReport={null} dpReport={DP_REPORT} />);
        expand();
        const rowTexts = Array.from(screen.getByTestId('dp-report-details').querySelectorAll('tbody tr[data-row-key]')).map((row) => row.textContent);
        expect(rowTexts[0]).toBe('薪資連續數值離散型 Gaussian50.000011251000鏡像 (fold)');
        expect(rowTexts[1]).toBe('地區類別k-RR（隨機回應）10---');
        expect(rowTexts[2]).toBe('生日日期時間離散型 Laplace10537 天截斷 (clamp)');
    });

    it('格式化工具', () => {
        expect(formatReportListItem({ k: 5 })).toBe('{"k":5}');
        expect(describeDpColumnStep({ column: 't', type: 'datetime', mechanism: 'DiscreteLaplace', epsilon: 1, sensitivity: 1, sensitivity_source: 'user', noise_unit: 'second' })).toBe('1 秒');
        expect(describeDpColumnStep({ column: 'n', type: 'continuous', mechanism: 'DiscreteLaplace', epsilon: 1, sensitivity: 1, sensitivity_source: 'user' })).toBe('1');
    });
});
