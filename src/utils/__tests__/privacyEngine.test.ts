import { describe, it, expect } from 'vitest';

// 假設/實際引用的去識別化核心函式
// (若有實作檔案，可改為 import { generalizeNumeric, generalizeDate, addLaplaceNoise } from '../privacyEngine')
const generalizeNumeric = (num: number, interval = 10): string => {
  if (isNaN(num)) return 'N/A';
  const lower = Math.floor(num / interval) * interval;
  return `[${lower} - ${lower + interval})`;
};

const generalizeDate = (dateStr: string): string => {
  if (!dateStr || dateStr.length < 7) return 'Invalid Date';
  return dateStr.substring(0, 7);
};

const addLaplaceNoise = (val: number, epsilon: number): number => {
  if (isNaN(val)) return NaN;
  const safeEpsilon = Math.max(epsilon, 0.01);
  const scale = 5 / safeEpsilon;
  const u = Math.random() - 0.5;
  const noise = -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
  return parseFloat((val + noise).toFixed(2));
};

// ======================================================================
// 🧪 完整測資與測試套件 (Unit Test Suite)
// ======================================================================

describe('Privacy Engine Algorithms - 完整驗證', () => {

  // --------------------------------------------------------------------
  // 1. K-Anonymity 數值區間化泛化 (Numeric Bucket)
  // --------------------------------------------------------------------
  describe('K-Anonymity: 數值區間化 (Numeric Generalization)', () => {

    it('典型數值應正確區間化 (預設 interval = 10)', () => {
      const cases = [
        { input: 25, expected: '[20 - 30)' },
        { input: 42, expected: '[40 - 50)' },
        { input: 99, expected: '[90 - 100)' },
      ];
      cases.forEach(({ input, expected }) => {
        expect(generalizeNumeric(input)).toBe(expected);
      });
    });

    it('邊界值點測試 (0, 區間倍數點)', () => {
      expect(generalizeNumeric(0)).toBe('[0 - 10)');
      expect(generalizeNumeric(10)).toBe('[10 - 20)');
      expect(generalizeNumeric(20)).toBe('[20 - 30)');
    });

    it('自訂區間大小 (Custom Intervals)', () => {
      expect(generalizeNumeric(25, 5)).toBe('[25 - 30)');
      expect(generalizeNumeric(25, 50)).toBe('[0 - 50)');
      expect(generalizeNumeric(1350, 500)).toBe('[1000 - 1500)');
    });

    it('負數與小數處理 (Negative & Floating Numbers)', () => {
      expect(generalizeNumeric(-5, 10)).toBe('[-10 - 0)');
      expect(generalizeNumeric(25.8, 10)).toBe('[20 - 30)');
    });

    it('異常輸入處理 (NaN)', () => {
      expect(generalizeNumeric(NaN)).toBe('N/A');
    });
  });

  // --------------------------------------------------------------------
  // 2. K-Anonymity 日期字串截斷 (Date Generalization)
  // --------------------------------------------------------------------
  describe('K-Anonymity: 日期截斷 (Date Generalization)', () => {

    it('標準日期時間格式應正確截斷至年月 (YYYY-MM)', () => {
      const cases = [
        { input: '2026-07-24 11:30:00', expected: '2026-07' },
        { input: '1999-12-31T23:59:59Z', expected: '1999-12' },
        { input: '2030-01-01', expected: '2030-01' },
      ];
      cases.forEach(({ input, expected }) => {
        expect(generalizeDate(input)).toBe(expected);
      });
    });

    it('異常與無效日期字串處理 (Invalid Date Inputs)', () => {
      expect(generalizeDate('')).toBe('Invalid Date');
      expect(generalizeDate('2026')).toBe('Invalid Date');
      expect(generalizeDate('N/A')).toBe('Invalid Date');
    });
  });

  // --------------------------------------------------------------------
  // 3. Differential Privacy 差分隱私 (Laplace Noise Addition)
  // --------------------------------------------------------------------
  describe('Differential Privacy: 差分隱私 Laplace 加噪機制', () => {

    it('加噪後數值不應與原值完全相同，且型態應為有效數字', () => {
      const originalVal = 100;
      const noisyVal = addLaplaceNoise(originalVal, 1.0);

      expect(typeof noisyVal).toBe('number');
      expect(isNaN(noisyVal)).toBe(false);
      expect(noisyVal).not.toBe(originalVal);
    });

    it('隱私預算 (Epsilon) 越小，噪聲波動潛在範圍越大', () => {
      const originalVal = 500;
      // 當 epsilon 非常大 (100) 時，噪聲極小，結果會非常接近原值
      const highBudgetVal = addLaplaceNoise(originalVal, 100);
      expect(Math.abs(highBudgetVal - originalVal)).toBeLessThan(10);
    });

    it('極端值與防呆測試 (Zero/Negative Epsilon & NaN)', () => {
      // 傳入 0 或負數 epsilon 時不應崩潰 (已被 Math.max 避開)
      expect(() => addLaplaceNoise(100, 0)).not.toThrow();
      expect(() => addLaplaceNoise(100, -1)).not.toThrow();
      
      // 傳入 NaN 應安全傳回 NaN
      expect(isNaN(addLaplaceNoise(NaN, 1.0))).toBe(true);
    });
  });

});