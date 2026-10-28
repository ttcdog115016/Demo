/**
 * 後端 preprocess 區塊匯入（utils/preprocessConfigImport.ts）。
 * 測資取自期末交付包：04_系統設定檔/config_範例_JSON統合版.json、docs/manual_test/config_preprocess.json、
 * 03_測試腳本/實務應用情境/configs/金融分析_preprocess.json。
 */
import { describe, it, expect } from 'vitest';
import { parseBackendPreprocessBlock, importPreprocessFromConfig, hasBackendPreprocessBlock } from '../preprocessConfigImport';
import { buildPreprocessBlock } from '../preprocessConfig';
import { buildBackendConfigDocumentFromWorkspace } from '../pipelineConfig';
import { detectConfigPrivacyMode } from '../configModeDetect';

const UNIFIED_PREPROCESS_BLOCK = {
    enabled: true,
    algorithm: 'sha3-256',
    columns: [
        { column: '姓名', actions: [{ action: 'hash', params: { salt: 'use_timestamp' } }] },
        { column: '身分證號', actions: [{ action: 'normalize', params: { case: 'upper', width: 'half' } }, { action: 'hash', params: { salt: 'use_timestamp' } }] },
        { column: '地址', actions: [{ action: 'trim', params: { mode: 'edges' } }, { action: 'regex_replace', params: { pattern: '(?<=區).*$', replacement: '' } }] },
        { column: '出生日期', actions: [{ action: 'anchor_truncate', params: { anchor: '-', direction: 'after', keep: 0 } }] },
        { column: '醫療費用', actions: [{ action: 'clamp', params: { min: 0, max: 100000 } }, { action: 'cast', params: { type: 'int', rounding: 'round' } }] },
        { column: '檢驗值_血糖', actions: [{ action: 'cast', params: { type: 'float' } }] },
        { column: '職業', actions: [{ action: 'fill_default', params: { value: '未填' } }] },
        { column: '保險別', actions: [{ action: 'drop_nulls', params: {} }] },
    ],
};

describe('parseBackendPreprocessBlock', () => {
    it('統合版範例的 8 欄全部轉成 Step2 設定，且無警告', () => {
        const result = parseBackendPreprocessBlock(UNIFIED_PREPROCESS_BLOCK);
        expect(result.warnings).toEqual([]);
        expect(result.columnNames).toHaveLength(8);
        expect(result.preprocessingRules['姓名']).toEqual([{ action: 'hash', params: { algorithm: 'sha3-256', seedMode: 'random' } }]);
        expect(result.preprocessingRules['身分證號'][0]).toEqual({ action: 'normalize', params: { caseMode: 'upper', widthMode: 'full_to_half' } });
        expect(result.preprocessingRules['地址'][1]).toEqual({ action: 'regex_replace', params: { pattern: '(?<=區).*$', placeholder: '' } });
        expect(result.preprocessingRules['出生日期']).toEqual([{ action: 'anchor_truncate', params: { anchor: '-', direction: 'back', keepCount: 0 } }]);
        expect(result.preprocessingRules['醫療費用']).toEqual([
            { action: 'clamp', params: { min: 0, max: 100000 } },
            { action: 'type_cast', params: { targetType: 'integer' } },
        ]);
        expect(result.missingValueRules['職業']).toEqual({ strategy: 'constant', constantValue: '未填' });
        expect(result.missingValueRules['保險別']).toEqual({ strategy: 'drop' });
        expect(result.preprocessingRules['職業']).toBeUndefined();
    });

    it('匯入後再組回後端格式，與原設定檔相同（往返一致）', () => {
        const result = parseBackendPreprocessBlock(UNIFIED_PREPROCESS_BLOCK);
        const rebuilt = buildPreprocessBlock(result.columnNames, result.preprocessingRules, result.missingValueRules);
        expect(rebuilt).toEqual(UNIFIED_PREPROCESS_BLOCK);
    });

    it('未填 algorithm 時依後端預設 sha3-256；salt 自訂／未填分別對應自訂鹽值／伺服器預設', () => {
        const result = parseBackendPreprocessBlock({
            enabled: true,
            columns: [
                { column: 'A', actions: [{ action: 'hash', params: { salt: 'manual-test-salt' } }] },
                { column: 'B', actions: [{ action: 'hash', params: {} }] },
            ],
        });
        expect(result.preprocessingRules.A[0].params).toEqual({ algorithm: 'sha3-256', seedMode: 'fixed', seedValue: 'manual-test-salt' });
        expect(result.preprocessingRules.B[0].params).toEqual({ algorithm: 'sha3-256', seedMode: 'none' });
    });

    it('手動測試設定：slice、只設上限的 clamp（下限存空字串＝不限制）', () => {
        const result = parseBackendPreprocessBlock({
            enabled: true,
            columns: [
                { column: '身分證號', actions: [{ action: 'slice', params: { side: 'right', count: 6 } }] },
                { column: '薪資', actions: [{ action: 'clamp', params: { max: 90000 } }] },
            ],
        });
        expect(result.preprocessingRules['身分證號'][0]).toEqual({ action: 'slice', params: { direction: 'right', count: 6 } });
        expect(result.preprocessingRules['薪資'][0]).toEqual({ action: 'clamp', params: { min: '', max: 90000 } });
        expect(buildPreprocessBlock(['薪資'], result.preprocessingRules, {})?.columns[0].actions[0]).toEqual({ action: 'clamp', params: { max: 90000 } });
    });

    it('情境測資：空白當鎖定字元、逾期天數補 0（數字）', () => {
        const result = parseBackendPreprocessBlock({
            enabled: true,
            columns: [
                { column: '交易時間', actions: [{ action: 'anchor_truncate', params: { anchor: ' ', direction: 'after', keep: 0 } }] },
                { column: '逾期天數', actions: [{ action: 'fill_default', params: { value: 0 } }] },
            ],
        });
        expect(result.preprocessingRules['交易時間'][0].params.anchor).toBe(' ');
        expect(result.missingValueRules['逾期天數']).toEqual({ strategy: 'constant', constantValue: '0' });
        expect(buildPreprocessBlock(['逾期天數'], {}, result.missingValueRules)?.columns[0].actions[0]).toEqual({ action: 'fill_default', params: { value: 0 } });
    });

    it('同欄位出現多次依序接續；本工具表達不了的寫法調整並提示', () => {
        const result = parseBackendPreprocessBlock({
            enabled: true,
            columns: [
                { column: 'X', actions: [{ action: 'trim', params: { mode: 'all' } }] },
                { column: 'X', actions: [{ action: 'cast', params: { type: 'int', rounding: 'floor' } }, { action: 'hash', params: {} }, { action: 'trim', params: {} }] },
                { column: 'Y', actions: [{ action: 'impute', params: { strategy: 'ffill' } }, { action: 'normalize', params: { width: 'full' } }, { action: 'unknown_action', params: {} }] },
            ],
        });
        expect(result.preprocessingRules.X.map((stepItem) => stepItem.action)).toEqual(['trim', 'type_cast', 'hash']);
        expect(result.missingValueRules.Y).toEqual({ strategy: 'fill', fillMethod: 'forward' });
        expect(result.preprocessingRules.Y).toBeUndefined();
        expect(result.warnings.join('\n')).toMatch(/四捨五入/);
        expect(result.warnings.join('\n')).toMatch(/雜湊之後的步驟已略過/);
        expect(result.warnings.join('\n')).toMatch(/半形轉全形/);
        expect(result.warnings.join('\n')).toMatch(/unknown_action/);
    });

    it('enabled: false 時不匯入任何規則', () => {
        const result = parseBackendPreprocessBlock({ ...UNIFIED_PREPROCESS_BLOCK, enabled: false });
        expect(result.disabled).toBe(true);
        expect(result.preprocessingRules).toEqual({});
    });
});

describe('importPreprocessFromConfig', () => {
    it('沒有 preprocess 區塊回傳 null', () => {
        expect(importPreprocessFromConfig({ k_anonymity: { enabled: true } }, ['A'])).toBeNull();
        expect(hasBackendPreprocessBlock([])).toBe(false);
    });

    it('只保留資料中存在的欄位，並以資料的原始欄名（含 BOM）為鍵', () => {
        const result = importPreprocessFromConfig({ preprocess: UNIFIED_PREPROCESS_BLOCK }, ['﻿姓名', '地址', '年齡']);
        expect(result?.columnNames).toEqual(['﻿姓名', '地址']);
        expect(Object.keys(result?.preprocessingRules ?? {})).toEqual(['﻿姓名', '地址']);
        expect(result?.skippedColumnNames).toEqual(['身分證號', '出生日期', '醫療費用', '檢驗值_血糖', '職業', '保險別']);
    });

    it('純前處理設定檔與統合版都不會被判成單一隱私模式（兩頁都可匯入）', () => {
        expect(detectConfigPrivacyMode({ preprocess: UNIFIED_PREPROCESS_BLOCK })).toBe('unknown');
        expect(detectConfigPrivacyMode({ preprocess: UNIFIED_PREPROCESS_BLOCK, k_anonymity: { enabled: true }, differential_privacy: { enabled: true } })).toBe('unknown');
    });
});

describe('匯出設定檔帶 preprocess 區塊', () => {
    const baseWorkspace = {
        privacyMode: 'differential-privacy', fileName: 'x.csv', columns: ['職業', '年齡'],
        kValue: 5, lValue: 2, tValue: 0.7, enableLDiversity: false, enableTCloseness: false,
        maxSuppression: 10, suppressionMethod: 'row_suppression', cellFillMethod: 'star' as const, limitExceededAction: 'abort',
        dpFields: [], targetDelta: 1e-5,
    };

    it('有缺失值處理時，preprocess 排在隱私區塊之前', () => {
        const configDocument = buildBackendConfigDocumentFromWorkspace({ ...baseWorkspace, missingValueRules: { 職業: { strategy: 'constant', constantValue: '未填' } } });
        expect(Object.keys(configDocument ?? {})).toEqual(['version', 'dataset', 'input_format', 'preprocess', 'differential_privacy']);
        expect(importPreprocessFromConfig(configDocument, baseWorkspace.columns)?.missingValueRules).toEqual({ 職業: { strategy: 'constant', constantValue: '未填' } });
    });

    it('沒有任何清洗設定時不加 preprocess', () => {
        const configDocument = buildBackendConfigDocumentFromWorkspace({ ...baseWorkspace, preprocessingRules: {}, missingValueRules: {} });
        expect(configDocument).not.toHaveProperty('preprocess');
    });
});
