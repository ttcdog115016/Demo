// @vitest-environment jsdom
/**
 * ★ 2026-10-08 諮詢會（10/05）後續：
 *   (1) Step2 設定變更後自動捲到該列（scrollTableRowIntoView）
 *   (2) Step3 資料規模提示（datasetScaleHint／DatasetScaleHint）
 *   (3) Step4 下載時附上資料使用注意事項（dataUsageNotes）
 */
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: unknown, vars?: Record<string, unknown>) =>
        {
            const template = typeof fallback === 'string' ? fallback : key;
            return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? ''));
        }
    }),
}));

import { scrollTableRowIntoView } from '../tableRowScroll';
import { classifyDatasetScale, computeKGroupShare, formatSharePercentText } from '../datasetScaleHint';
import { getDataUsageNotes, buildDataUsageNotesText, describeProcessingMethod } from '../dataUsageNotes';
import DatasetScaleHint from '../../components/DatasetScaleHint';

describe('Step2：設定變更後捲到該列', () => {
    it('找到 data-row-key 對應的列並以 nearest 捲動；欄位名含引號也能找到', () => {
        const container = document.createElement('div');
        container.innerHTML = '<table><tbody><tr data-row-key="年齡"></tr><tr data-row-key=\'就醫"次數\'></tr></tbody></table>';
        const rows = container.querySelectorAll('tr');
        const spy = vi.fn();
        rows.forEach((row) => { (row as HTMLElement).scrollIntoView = spy; });
        expect(scrollTableRowIntoView(container, '就醫"次數')).toBe(true);
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }));
        expect(scrollTableRowIntoView(container, '不存在')).toBe(false);
        expect(scrollTableRowIntoView(null, '年齡')).toBe(false);
    });
});

describe('Step3：資料規模提示', () => {
    it('依筆數分級', () => {
        expect(classifyDatasetScale(0)).toBe('unknown');
        expect(classifyDatasetScale(999)).toBe('small');
        expect(classifyDatasetScale(1000)).toBe('medium');
        expect(classifyDatasetScale(1_000_000)).toBe('large');
    });

    it('K 佔比與群數', () => {
        expect(computeKGroupShare(5, 200)).toEqual({ groupSharePercent: 2.5, maxGroupCount: 40 });
        expect(computeKGroupShare(5, 0)).toBeNull();
        expect(formatSharePercentText(2.5)).toBe('2.5%');
        expect(formatSharePercentText(5 / 20_000_000 * 100)).toBe('0.000025%');
    });

    afterEach(cleanup);

    it('K-匿名：小型資料顯示提醒；未載入資料不顯示', () => {
        render(<DatasetScaleHint mode="k-anonymity" rowCount={200} kValue={5} />);
        const hint = screen.getByTestId('dataset-scale-hint');
        expect(hint.getAttribute('data-scale-level')).toBe('small');
        expect(hint.textContent).toContain('2.5%');
        expect(hint.textContent).toContain('40 群');
        cleanup();
        const { container } = render(<DatasetScaleHint mode="k-anonymity" rowCount={0} kValue={5} />);
        expect(container.innerHTML).toBe('');
    });

    it('差分隱私：大型資料提示分組誤差', () => {
        render(<DatasetScaleHint mode="differential-privacy" rowCount={20_000_000} />);
        expect(screen.getByTestId('dataset-scale-hint').textContent).toContain('分組後筆數很少');
    });
});

describe('Step4：資料使用注意事項', () => {
    it('差分隱私包含百分位提醒；K-匿名包含區間提醒', () => {
        expect(getDataUsageNotes('differential-privacy').join('')).toContain('年齡最大的 10%');
        expect(getDataUsageNotes('k-anonymity').join('')).toContain('區間');
        expect(getDataUsageNotes('k-anonymity').join('')).not.toContain('年齡最大的 10%');
    });

    it('文字檔含檔名、處理方式、編號與 CRLF', () => {
        const text = buildDataUsageNotesText({ mode: 'differential-privacy', sourceFileName: 'a.csv', consumedEpsilon: 1.5000000001, generatedAt: new Date(2026, 9, 8, 9, 5) });
        expect(text).toContain('原始資料：a.csv');
        expect(text).toContain('ε = 1.5');
        expect(text).toContain('產出時間：2026-10-08 09:05');
        expect(text).toContain('\r\n1. ');
        expect(describeProcessingMethod({ mode: 'k-anonymity', kValue: 5 })).toContain('K = 5');
    });
});
