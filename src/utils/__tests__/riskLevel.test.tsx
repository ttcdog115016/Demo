import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { classifyRiskLevel, describeRiskLevelScale, computeOverallRiskLevel } from '../riskLevel';
import RiskLevelBadge, { OverallRiskLevelPanel } from '../../components/RiskLevelBadge';

describe('classifyRiskLevel', () => {
    it('依 5%／20% 門檻分成 L1／L2／L3（邊界值歸入較高一級）', () => {
        expect(classifyRiskLevel(0)?.code).toBe('L1');
        expect(classifyRiskLevel(0.0499)?.code).toBe('L1');
        expect(classifyRiskLevel(0.05)?.code).toBe('L2');
        expect(classifyRiskLevel(0.1999)?.code).toBe('L2');
        expect(classifyRiskLevel(0.2)?.code).toBe('L3');
        expect(classifyRiskLevel(1)?.code).toBe('L3');
    });

    it('未評估（-1）、NaN、null 不分級', () => {
        expect(classifyRiskLevel(-1)).toBeNull();
        expect(classifyRiskLevel(Number.NaN)).toBeNull();
        expect(classifyRiskLevel(null)).toBeNull();
        expect(classifyRiskLevel(undefined)).toBeNull();
    });

    it('分級說明文字', () => {
        expect(describeRiskLevelScale()).toBe('L1 低風險 < 5%｜L2 中風險 5%～20%｜L3 高風險 ≥ 20%');
    });
});

describe('RiskLevelBadge', () => {
    it('顯示等級代號與中文', () => {
        render(<RiskLevelBadge riskRatio={0.12} />);
        expect(screen.getByTestId('risk-level-badge-L2').textContent).toContain('L2 中風險');
    });

    it('未評估時不渲染', () => {
        const { container } = render(<RiskLevelBadge riskRatio={-1} />);
        expect(container.innerHTML).toBe('');
    });
});

describe('computeOverallRiskLevel', () => {
    it('取已評估指標中最高者的等級，並回報是哪一項', () => {
        const summary = computeOverallRiskLevel([
            { label: '指認風險', value: 0 },
            { label: '推斷風險', value: 0.003 },
            { label: 'CAP 處理後', value: 0.225 },
        ]);
        expect(summary?.info.code).toBe('L3');
        expect(summary?.driver).toEqual({ label: 'CAP 處理後', value: 0.225 });
    });

    it('忽略未評估（-1／undefined）；全部未評估回傳 null', () => {
        expect(computeOverallRiskLevel([{ label: 'a', value: -1 }, { label: 'b', value: 0.01 }])?.info.code).toBe('L1');
        expect(computeOverallRiskLevel([{ label: 'a', value: -1 }, { label: 'b', value: undefined }])).toBeNull();
    });

    it('整體結果圖只顯示一個等級', () => {
        const summary = computeOverallRiskLevel([{ label: '連結風險', value: 0.1 }])!;
        render(<OverallRiskLevelPanel summary={summary} title="整體風險等級" driverText="x" textColor="#333" mutedColor="#666" trackColor="#eee" />);
        expect(screen.getByTestId('overall-risk-level').textContent).toContain('L2 中風險');
    });
});
