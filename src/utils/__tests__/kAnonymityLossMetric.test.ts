/**
 * ★ 2026-10-14：K-匿名失真程度（LM）＝(H_avg − 1) ÷ (H_max − 1)，以處理前後資料配對計算
 */
import { describe, it, expect } from 'vitest';
import { computeKAnonymityLossMetric, formatLossPercent } from '../kAnonymityLossMetric';
import { classifyKAnonymityUtility } from '../plainResultSummary';

const original = [
    '年齡,地區,疾病',
    '31,中正區,感冒',
    '35,大安區,糖尿病',
    '42,中正區,感冒',
    '48,板橋區,高血壓',
    '55,板橋區,感冒',
].join('\n');

describe('computeKAnonymityLossMetric', () => {
    it('保留原值為 0；年齡改區間、地區改縣市時依涵蓋的原始值數計算', () => {
        const processed = [
            '年齡,地區,疾病',
            '30-39,臺北市,感冒',
            '30-39,臺北市,糖尿病',
            '40-49,臺北市,感冒',
            '40-49,新北市,高血壓',
            '55,新北市,感冒',
        ].join('\n');
        const result = computeKAnonymityLossMetric({ originalCsvText: original, processedCsvText: processed, qiColumns: ['年齡', '地區'], anchorColumns: ['疾病'] })!;
        // 年齡：H_max=5；30-39 涵蓋 2 個 → 1/4；40-49 涵蓋 2 個 → 1/4；55 → 0。平均 (0.25×4 + 0)/5 = 0.2
        expect(result.columns.find((c) => c.column === '年齡')!.loss).toBeCloseTo(0.2);
        // 地區：H_max=3（中正、大安、板橋）；臺北市涵蓋 2 → 1/2；新北市涵蓋 1 → 0。平均 (0.5×3)/5 = 0.3
        expect(result.columns.find((c) => c.column === '地區')!.loss).toBeCloseTo(0.3);
        expect(result.overall).toBeCloseTo(0.25);
    });

    it('遮成 * 或填空為 100%', () => {
        const processed = ['年齡,地區,疾病', '*,中正區,感冒', '35,大安區,糖尿病', '42,,感冒', '48,板橋區,高血壓', '55,板橋區,感冒'].join('\n');
        const result = computeKAnonymityLossMetric({ originalCsvText: original, processedCsvText: processed, qiColumns: ['年齡', '地區'], anchorColumns: ['疾病'] })!;
        expect(result.columns[0].loss).toBeCloseTo(1 / 5);
        expect(result.columns[1].loss).toBeCloseTo(1 / 5);
    });

    it('有列被刪除時以未處理欄位依序配對；被刪除的列不計入', () => {
        const processed = ['年齡,地區,疾病', '30-39,臺北市,感冒', '30-39,臺北市,糖尿病', '40-59,新北市,高血壓', '40-59,新北市,感冒'].join('\n');
        const result = computeKAnonymityLossMetric({ originalCsvText: original, processedCsvText: processed, qiColumns: ['年齡'], anchorColumns: ['疾病'] })!;
        // 配對：31,35,48,55；30-39 涵蓋 {31,35}、40-59 涵蓋 {48,55} → 每筆 1/4
        expect(result.columns[0].loss).toBeCloseTo(0.25);
    });

    it('對不上或沒有可配對欄位時回傳 null', () => {
        const processed = ['年齡,地區,疾病', '30-39,臺北市,感冒', '40-49,新北市,其他'].join('\n');
        expect(computeKAnonymityLossMetric({ originalCsvText: original, processedCsvText: processed, qiColumns: ['年齡'], anchorColumns: ['疾病'] })).toBeNull();
        expect(computeKAnonymityLossMetric({ originalCsvText: original, processedCsvText: processed, qiColumns: ['年齡'], anchorColumns: [] })).toBeNull();
    });

    it('顯示格式', () => {
        expect(formatLossPercent(0.123)).toBe('12%');
        expect(formatLossPercent(0.004)).toBe('不到 1%');
        expect(formatLossPercent(0)).toBe('0%');
    });
});

describe('K-匿名可用性：資料釋出率與失真程度取較差', () => {
    it('釋出率 95% 以上且失真 < 20% 才是高', () => {
        expect(classifyKAnonymityUtility(0.01, 0.1)!.labelText).toBe('高');
        expect(classifyKAnonymityUtility(0.01, 0.3)!.labelText).toBe('中');
        expect(classifyKAnonymityUtility(0.01, 0.6)!.labelText).toBe('低');
        expect(classifyKAnonymityUtility(0.1, 0.1)!.labelText).toBe('中');
        expect(classifyKAnonymityUtility(0.01, null)!.labelText).toBe('高');
    });
});
