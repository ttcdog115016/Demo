/**
 * 設定檔 risk_attacks／risk_cap 區塊匯入（utils/riskConfigImport.ts）與 Step4 組設定檔（2026-10-28）。
 * 測資：期末交付包 04_系統設定檔/config_範例_JSON統合版.json。
 */
import { describe, it, expect } from 'vitest';
import unifiedConfigText from './fixtures/backend_config_unified_v2.json?raw';
import {
    importRiskFromConfig, resolveRiskColumnOverridesForDataset, resolveLinkabilityForRound,
    RISK_ATTACK_DEFAULT_PARAMS, isDefaultRiskAttackParams, isValidRiskAttackParamValue
} from '../riskConfigImport';
import { buildRiskAttackConfigObject, buildOverrideRiskColumnsForCandidate, RISK_ATTACK_DEFAULT_PARAMS as REEXPORTED_DEFAULTS } from '../riskAssessment';

const SAMPLE_COLUMNS = ['姓名', '身分證號', '地址', '出生日期', '就診時間', '年齡', '職業', '婚姻狀況', '疾病', '醫療費用', '檢驗值_血糖', '就醫次數', '保險別'];
const unifiedConfig = () => JSON.parse(unifiedConfigText) as Record<string, Record<string, unknown>>;

describe('importRiskFromConfig', () => {
    it('統合版：欄位角色、連結性分組、族群條件、實驗參數全部帶入', () => {
        const result = importRiskFromConfig(unifiedConfig(), SAMPLE_COLUMNS)!;
        expect(result.columnOverrides).toEqual({
            年齡: { role: 'quasi_identifier', type: 'numeric' },
            地址: { role: 'quasi_identifier', type: 'categorical' },
            職業: { role: 'quasi_identifier', type: 'categorical' },
            婚姻狀況: { role: 'quasi_identifier', type: 'categorical' },
            疾病: { role: 'sensitive', type: 'categorical' },
        });
        expect(result.linkability).toEqual({ A: ['年齡', '婚姻狀況'], B: ['地址', '職業'] });
        expect(result.subgroupFilters).toEqual({
            年齡: { kind: 'range', min: '38', max: '45' },
            職業: { kind: 'categorical', values: ['工程師', '醫師', '教師'] },
        });
        expect(result.attackParams).toEqual({ n_iter: 500, ctrl_ratio: 0.2, seed: 42, n_subset: 500, n_repeats: 3, overlap_ratio: 0.1 });
        // risk_cap 的族群條件只有職業，與 risk_attacks 不同 → 提示採用 risk_attacks；參數比預設重 → 提示會變慢
        expect(result.warnings.join('\n')).toMatch(/risk_cap 的對象族群條件與 risk_attacks 不同/);
        expect(result.warnings.join('\n')).toMatch(/明顯變慢/);
        expect(result.warnings.join('\n')).not.toMatch(/欄位角色與 risk_attacks 不同/);
    });

    it('沒有風險評估區塊、或都未啟用時回傳 null', () => {
        expect(importRiskFromConfig({ k_anonymity: {} }, SAMPLE_COLUMNS)).toBeNull();
        const disabled = unifiedConfig();
        disabled.risk_attacks.enabled = false;
        disabled.risk_cap.enabled = false;
        expect(importRiskFromConfig(disabled, SAMPLE_COLUMNS)).toBeNull();
    });

    it('只有 risk_cap（單一入口 config_risk_cap.json）：用 risk_cap 的欄位與族群條件，不覆寫實驗參數', () => {
        const config = unifiedConfig();
        const result = importRiskFromConfig({ risk_cap: config.risk_cap }, SAMPLE_COLUMNS)!;
        expect(Object.keys(result.columnOverrides!)).toHaveLength(5);
        expect(result.subgroupFilters).toEqual({ 職業: { kind: 'categorical', values: ['工程師', '醫師', '教師'] } });
        expect(result.attackParams).toBeNull();
        expect(result.linkability).toBeNull();
    });

    it('資料沒有的欄位略過；缺敏感欄位時不覆寫欄位角色；連結性分組欄位缺漏時改自動分組', () => {
        const result = importRiskFromConfig(unifiedConfig(), SAMPLE_COLUMNS.filter((name) => name !== '疾病' && name !== '職業'))!;
        expect(result.columnOverrides).toBeNull();
        expect(result.linkability).toBeNull();
        expect(result.subgroupFilters).toEqual({ 年齡: { kind: 'range', min: '38', max: '45' } });
        expect(result.warnings[0]).toBe('風險評估：已略過 2 個資料中沒有的欄位：職業、疾病');
    });

    it('連結性分組重疊、含非間接識別欄位時改自動分組；不合法參數改用預設', () => {
        const config = unifiedConfig();
        config.risk_attacks.linkability = { A: ['年齡', '地址'], B: ['地址'] };
        config.risk_attacks.n_repeats = 0;
        config.risk_attacks.ctrl_ratio = 1;
        let result = importRiskFromConfig(config, SAMPLE_COLUMNS)!;
        expect(result.linkability).toBeNull();
        expect(result.warnings.join('\n')).toMatch(/不可重疊/);
        expect(result.attackParams).toMatchObject({ n_repeats: 1, ctrl_ratio: 0.2, n_iter: 500 });

        config.risk_attacks.linkability = { A: ['年齡'], B: ['疾病'] };
        result = importRiskFromConfig(config, SAMPLE_COLUMNS)!;
        expect(result.linkability).toBeNull();
        expect(result.warnings.join('\n')).toMatch(/只能用間接識別欄位/);
    });

    it('實驗參數一項都沒寫、或與前端預設相同時不覆寫', () => {
        const config = unifiedConfig();
        ['n_iter', 'ctrl_ratio', 'seed', 'n_subset', 'n_repeats', 'overlap_ratio'].forEach((key) => delete config.risk_attacks[key]);
        expect(importRiskFromConfig(config, SAMPLE_COLUMNS)!.attackParams).toBeNull();
        Object.assign(config.risk_attacks, RISK_ATTACK_DEFAULT_PARAMS);
        expect(importRiskFromConfig(config, SAMPLE_COLUMNS)!.attackParams).toBeNull();
    });
});

describe('Step4 使用匯入的風險評估設定', () => {
    const overrides = importRiskFromConfig(unifiedConfig(), SAMPLE_COLUMNS)!.columnOverrides!;

    it('欄位角色只保留實際處理的欄位；缺敏感欄位時退回原本推導（null）', () => {
        expect(Object.keys(resolveRiskColumnOverridesForDataset(overrides, SAMPLE_COLUMNS)!)).toHaveLength(5);
        expect(resolveRiskColumnOverridesForDataset(overrides, ['年齡', '地址'])).toBeNull();
        expect(resolveRiskColumnOverridesForDataset(null, SAMPLE_COLUMNS)).toBeNull();
    });

    it('每輪 columns：本輪敏感欄位為 sensitive，其他敏感欄位不放入；分級距欄位改類別型', () => {
        const twoSensitive = { ...overrides, 醫療費用: { role: 'sensitive' as const, type: 'numeric' } };
        expect(buildOverrideRiskColumnsForCandidate(twoSensitive, { 醫療費用: 10000 }, '醫療費用')).toEqual({
            年齡: { role: 'quasi_identifier', type: 'numeric' },
            地址: { role: 'quasi_identifier', type: 'categorical' },
            職業: { role: 'quasi_identifier', type: 'categorical' },
            婚姻狀況: { role: 'quasi_identifier', type: 'categorical' },
            醫療費用: { role: 'sensitive', type: 'categorical' },
        });
    });

    it('三攻擊設定檔帶入連結性分組與實驗參數；未提供時與先前相同', () => {
        const linkability = { A: ['年齡', '婚姻狀況'], B: ['地址', '職業'] };
        const params = { n_iter: 500, ctrl_ratio: 0.2, seed: 42, n_subset: 500, n_repeats: 3, overlap_ratio: 0.1 };
        const columns = buildOverrideRiskColumnsForCandidate(overrides, {}, '疾病');
        const withImport = buildRiskAttackConfigObject({ version: 'v', dataset: 'd', columns, subgroup: undefined, privacyBlock: {}, attackParams: params, linkability: resolveLinkabilityForRound(linkability, columns) });
        expect(withImport.risk_attacks).toEqual({ enabled: true, columns, linkability, ...params });
        const plain = buildRiskAttackConfigObject({ version: 'v', dataset: 'd', columns, subgroup: undefined, privacyBlock: {} });
        expect(plain.risk_attacks).toEqual({ enabled: true, columns, ...RISK_ATTACK_DEFAULT_PARAMS });
        expect(REEXPORTED_DEFAULTS).toBe(RISK_ATTACK_DEFAULT_PARAMS);
    });

    it('本輪 A／B 有欄位不是間接識別時不送連結性分組', () => {
        expect(resolveLinkabilityForRound({ A: ['年齡'], B: ['疾病'] }, { 年齡: { role: 'quasi_identifier' }, 疾病: { role: 'sensitive' } })).toBeNull();
        expect(resolveLinkabilityForRound(null, {})).toBeNull();
    });

    it('參數合法範圍', () => {
        expect(isValidRiskAttackParamValue('n_iter', 1.5)).toBe(false);
        expect(isValidRiskAttackParamValue('ctrl_ratio', 0.99)).toBe(true);
        expect(isValidRiskAttackParamValue('ctrl_ratio', 0)).toBe(false); // ★ 2026-10-29 後端要求 0 < ctrl_ratio < 1
        expect(isValidRiskAttackParamValue('overlap_ratio', 1)).toBe(true); // ★ 2026-10-29 後端允許 overlap_ratio = 1
        expect(isValidRiskAttackParamValue('seed', 0)).toBe(true);
        expect(isDefaultRiskAttackParams(null)).toBe(true);
    });
});
