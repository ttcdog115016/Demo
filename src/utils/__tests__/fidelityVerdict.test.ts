/**
 * ★ 2026-10-29：實用性未達標時寫出是哪一項沒達 75%（例：綜合 76% 達標、欄位搭配 69% 未達 → 仍未達標，原因寫欄位搭配）。
 */
import { describe, it, expect } from 'vitest';
import { classifyKAnonymityFidelity } from '../plainResultSummary';

describe('K-匿名實用性判定說明', () => {
    it('綜合達標但欄位搭配未達：仍未達標，原因只寫欄位搭配', () => {
        const verdict = classifyKAnonymityFidelity({ isPassed: false, columnShapes: 0.84, columnPairTrends: 0.69, overall: 0.765 });
        expect(verdict?.labelText).toBe('未達標');
        expect(verdict?.verdictText).toBe('欄位搭配 69% 低於 75%（三項都須達 75%）：部分欄位之間的關聯（一起出現的組合）改變較多，資料效用可能降低。');
    });

    it('多項未達一起列出；達標時沿用原說明', () => {
        expect(classifyKAnonymityFidelity({ isPassed: false, columnShapes: 0.6, columnPairTrends: 0.7, overall: 0.65 })?.verdictText)
            .toContain('欄位分布 60%、欄位搭配 70%、綜合 65% 低於 75%');
        expect(classifyKAnonymityFidelity({ isPassed: true, columnShapes: 0.9, columnPairTrends: 0.8, overall: 0.85 })?.labelText).toBe('達標');
        expect(classifyKAnonymityFidelity(null)).toBeNull();
    });
});
