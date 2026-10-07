import { describe, it, expect } from 'vitest';
import { isDpBudgetExceeded } from '../pipelineConfig';
import { evaluateComplianceValidity } from '../../features/step4_result/pipeline/pipelineResults';

const sumOfEvenSplit = (total: number, fieldCount: number): number => {
    let sum = 0;
    for (let i = 0; i < fieldCount; i++) sum += total / fieldCount;
    return sum;
};

describe('DP 預算上限比較容許浮點誤差（Step3 套用高隱私、9 個欄位）', () => {
    it('總預算 1 平分 9 欄，加總為 1.0000000000000002，不算超支', () => {
        expect(sumOfEvenSplit(1, 9)).toBeGreaterThan(1);
        expect(isDpBudgetExceeded(sumOfEvenSplit(1, 9), 1)).toBe(false);
        expect(isDpBudgetExceeded(sumOfEvenSplit(1, 11), 1)).toBe(false);
        expect(isDpBudgetExceeded(sumOfEvenSplit(5, 13), 5)).toBe(false);
    });

    it('高／中／低隱私平分 1～50 欄皆不會被判超支', () => {
        for (const total of [1, 5, 15]) {
            for (let n = 1; n <= 50; n++) expect(isDpBudgetExceeded(sumOfEvenSplit(total, n), total)).toBe(false);
        }
    });

    it('真的超過上限仍判定超支', () => {
        expect(isDpBudgetExceeded(1.001, 1)).toBe(true);
        expect(isDpBudgetExceeded(1.0000001, 1)).toBe(true);
        expect(isDpBudgetExceeded(15.01, 15)).toBe(true);
    });

    it('Step4 合規判定：後端回報 1.0000000000000002 時仍為達標', () => {
        expect(evaluateComplianceValidity('differential-privacy', { consumed_epsilon: sumOfEvenSplit(1, 9) } as never, 1)).toBe(true);
        expect(evaluateComplianceValidity('differential-privacy', { consumed_epsilon: 1.2 } as never, 1)).toBe(false);
    });
});
