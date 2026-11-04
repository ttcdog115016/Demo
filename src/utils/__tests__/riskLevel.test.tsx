// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { classifyRiskLevel, describeRiskLevelScale, computeOverallRiskLevel } from '../riskLevel';
import RiskLevelBadge, { OverallRiskLevelPanel } from '../../components/RiskLevelBadge';

describe('classifyRiskLevel', () => {
    // ★ 2026-11-04：依 Anonymeter／PETsARD 改為 risk < 0.09 通過，否則不通過
    it('risk < 0.09 通過，≥ 0.09 不通過（邊界值不通過）', () => {
        expect(classifyRiskLevel(0)?.code).toBe('PASS');
        expect(classifyRiskLevel(0.0899)?.code).toBe('PASS');
        expect(classifyRiskLevel(0.09)?.code).toBe('FAIL');
        expect(classifyRiskLevel(1)?.code).toBe('FAIL');
        expect(classifyRiskLevel(0.05)?.labelText).toBe('通過');
        expect(classifyRiskLevel(0.2)?.labelText).toBe('不通過');
    });

    it('未評估（-1）、NaN、null 不分級', () => {
        expect(classifyRiskLevel(-1)).toBeNull();
        expect(classifyRiskLevel(Number.NaN)).toBeNull();
        expect(classifyRiskLevel(null)).toBeNull();
        expect(classifyRiskLevel(undefined)).toBeNull();
    });

    it('分級說明文字', () => {
        expect(describeRiskLevelScale()).toBe('通過：各項風險皆 < 9%｜不通過：任一項 ≥ 9%');
    });
});

describe('RiskLevelBadge', () => {
    it('顯示判定文字', () => {
        render(<RiskLevelBadge riskRatio={0.12} />);
        expect(screen.getByTestId('risk-level-badge-FAIL').textContent).toBe('不通過');
    });

    it('未評估時不渲染', () => {
        const { container } = render(<RiskLevelBadge riskRatio={-1} />);
        expect(container.innerHTML).toBe('');
    });
});

describe('computeOverallRiskLevel', () => {
    it('取已評估指標中最高者判定（任一項 ≥ 門檻即不通過），並回報是哪一項', () => {
        const summary = computeOverallRiskLevel([
            { label: '指認風險', value: 0 },
            { label: '推斷風險', value: 0.003 },
            { label: 'CAP 處理後', value: 0.225 },
        ]);
        expect(summary?.info.code).toBe('FAIL');
        expect(summary?.driver).toEqual({ label: 'CAP 處理後', value: 0.225 });
    });

    it('忽略未評估（-1／undefined）；全部未評估回傳 null', () => {
        expect(computeOverallRiskLevel([{ label: 'a', value: -1 }, { label: 'b', value: 0.01 }])?.info.code).toBe('PASS');
        expect(computeOverallRiskLevel([{ label: 'a', value: -1 }, { label: 'b', value: undefined }])).toBeNull();
    });

    it('整體結果圖顯示判定與門檻', () => {
        const summary = computeOverallRiskLevel([{ label: '連結風險', value: 0.05 }])!;
        render(<OverallRiskLevelPanel summary={summary} title="整體風險評估" driverText="x" textColor="#333" mutedColor="#666" trackColor="#eee" />);
        const text = screen.getByTestId('overall-risk-level').textContent;
        expect(text).toContain('通過');
        expect(text).toContain('各項 < 9%');
    });
});
