import { describe, it, expect } from 'vitest';
import { calculatePasswordStrength, toStrengthBarPercent, MIN_VISIBLE_STRENGTH_PERCENT } from '../passwordStrength';

describe('密碼強度評分', () => {
    it('沒有輸入時不顯示強度', () => {
        expect(calculatePasswordStrength('')).toEqual({ score: 0, level: 'none', issues: [] });
        expect(toStrengthBarPercent(calculatePasswordStrength(''))).toBe(0);
    });

    it('$Qt123456789：連續數字只扣一次，不會被扣到 0 分（強度條原本整條空白）', () => {
        const result = calculatePasswordStrength('$Qt123456789');
        expect(result.score).toBe(50);
        expect(result.level).toBe('medium');
        expect(result.issues).toEqual(['sequential_digits']);
    });

    it('0 分時強度條仍顯示一小段', () => {
        const result = calculatePasswordStrength('password1234');
        expect(result.score).toBe(0);
        expect(toStrengthBarPercent(result)).toBe(MIN_VISIBLE_STRENGTH_PERCENT);
        expect(result.issues).toEqual(expect.arrayContaining(['common_word', 'sequential_digits', 'missing_types']));
    });

    it('長且四種字元齊全、無規律的密碼為強', () => {
        const result = calculatePasswordStrength('Tw!PrivacyKit#2026');
        expect(result.level).toBe('strong');
        expect(result.issues).toEqual([]);
    });

    it('過短與字元種類不足列出原因', () => {
        expect(calculatePasswordStrength('abcxyz').issues).toEqual(['too_short', 'missing_types']);
        expect(calculatePasswordStrength('Aaaa@Bbbb#9xyz').issues).toEqual(['repeated_chars']);
    });
});
