/**
 * ============================================================================
 * 檔案名稱 (File): RiskAssessmentSettingsPanel.tsx
 * 模組功能 (Description): Step3「風險評估進階設定」：顯示自設定檔匯入的風險評估欄位角色、連結性分組，
 *                         以及可調整的三攻擊實驗參數（n_iter、ctrl_ratio、seed、n_subset、n_repeats、overlap_ratio）。
 * ============================================================================
 * ★ 2026-10-28：統合版設定檔的 risk_attacks／risk_cap 區塊可由 Step2「匯入設定檔」讀入（utils/riskConfigImport.ts）。
 *   使用者決議（TTC Wei）：匯入後照設定檔評估，Step3 可看可改——欄位角色與連結性分組可改回前端原本做法，實驗參數可調整或還原前端預設。
 *   沒有匯入、也沒調整時，本面板只說明目前的做法，Step4 行為與先前完全相同。
 */
import React, { useState } from 'react';
import { Card, Button, Space, Tag, Tooltip, InputNumber, Typography } from 'antd';
import { QuestionCircleOutlined, UndoOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore, type RiskAttackParams } from '../../store/useWorkspaceStore';
import { RISK_ATTACK_DEFAULT_PARAMS, RISK_ATTACK_PARAM_KEYS, RISK_ATTACK_PARAM_RULES, isDefaultRiskAttackParams, isValidRiskAttackParamValue } from '../../utils/riskConfigImport';
import { buildDatasetColumnNameSet, isFieldNameInDataset } from '../../utils/datasetFieldConsistency';
import { scaleFontSize } from '../../utils/fontScale';
import CollapsibleCardHeader from '../../components/CollapsibleCardHeader';

const { Text } = Typography;

/** 實驗參數的畫面標籤與說明（後端 2.0.0 設定檔說明第六節） */
const RISK_ATTACK_PARAM_LABELS: Record<keyof RiskAttackParams, { label: string; hint: string; step: number }> = {
    n_iter: { label: '指認性攻擊迭代次數', hint: '指認性攻擊嘗試的次數。越多結果越穩定，但越慢（預設 500）。', step: 50 },
    ctrl_ratio: { label: '控制組比例', hint: '從原始資料切出多少比例當控制組，用來扣除「亂猜也猜得中」的基準。須小於 1。', step: 0.05 },
    seed: { label: '亂數種子', hint: '固定種子時，同一組設定每次評估的結果相同，可重現。', step: 1 },
    n_subset: { label: '連結性評估樣本數', hint: '連結性攻擊抽樣評估的筆數。', step: 100 },
    n_repeats: { label: '重複實驗輪數', hint: '整組攻擊重複幾輪後取平均；1 表示不重複。輪數越多越慢。', step: 1 },
    overlap_ratio: { label: '跨輪重疊比例', hint: '各輪控制組抽樣可重疊的比例，只有重複實驗輪數大於 1 時才有作用。須小於 1。', step: 0.05 },
};

const ROLE_TAG_COLOR = { quasi_identifier: 'blue', sensitive: 'volcano' } as const;

/**
 * 函數名稱: RiskAssessmentSettingsPanel
 * 函數功能: 渲染「風險評估進階設定」卡片（由 Step3_Rules.tsx 載入，兩種隱私模式共用一份）。
 * 返回值 (Return): React.ReactElement
 */
export default function RiskAssessmentSettingsPanel(): React.ReactElement {
    const { t: translate } = useTranslation();
    const privacyMode = useWorkspaceStore((state) => state.privacyMode);
    const datasetColumns = useWorkspaceStore((state) => state.columns);
    const riskColumnOverrides = useWorkspaceStore((state) => state.riskColumnOverrides);
    const riskLinkability = useWorkspaceStore((state) => state.riskLinkability);
    const riskAttackParams = useWorkspaceStore((state) => state.riskAttackParams);

    const effectiveParams = riskAttackParams ?? RISK_ATTACK_DEFAULT_PARAMS;
    const isParamsCustomized = !isDefaultRiskAttackParams(riskAttackParams);
    const isHeavierThanDefault = effectiveParams.n_iter * effectiveParams.n_repeats > RISK_ATTACK_DEFAULT_PARAMS.n_iter * RISK_ATTACK_DEFAULT_PARAMS.n_repeats;
    const datasetColumnNameSet = buildDatasetColumnNameSet(datasetColumns);

    // ★ 2026-11-05：預設收合，點標題才展開；載入時已有匯入或調整過的設定就先展開，避免設定被藏起來
    const isAnyCustomized = Boolean(riskColumnOverrides) || Boolean(riskLinkability) || isParamsCustomized;
    const [isPanelOpenStatus, setIsPanelOpenStatus] = useState<boolean>(isAnyCustomized);

    const handleParamChange = (paramKey: keyof RiskAttackParams, rawValue: number | null): void => {
        if (!isValidRiskAttackParamValue(paramKey, rawValue)) return; // 清空或超出範圍時不寫入，維持原值
        const nextParams: RiskAttackParams = { ...effectiveParams, [paramKey]: rawValue };
        useWorkspaceStore.setState({ riskAttackParams: isDefaultRiskAttackParams(nextParams) ? null : nextParams });
    };

    const derivedRoleText = privacyMode === 'differential-privacy'
        ? translate('step3_risk_settings.roles_derived_dp', '依步驟二的差分隱私欄位判定：點選為敏感的欄位當敏感欄位，其餘已啟用欄位當間接識別（未點選時輪流以類別型欄位當敏感欄位）。')
        : translate('step3_risk_settings.roles_derived_kanon', '依步驟二 K-匿名欄位的「間接識別」「敏感」角色。');

    const renderColumnTags = (role: 'quasi_identifier' | 'sensitive'): React.ReactNode => {
        const names = Object.keys(riskColumnOverrides || {}).filter((name) => riskColumnOverrides![name].role === role);
        if (names.length === 0) return <Text type="secondary">—</Text>;
        return names.map((name) => {
            const isMissing = !isFieldNameInDataset(name, datasetColumnNameSet);
            return (
                <Tooltip key={name} title={isMissing ? translate('step3_risk_settings.column_missing', '目前資料中沒有此欄位，評估時略過') : undefined}>
                    <Tag color={isMissing ? undefined : ROLE_TAG_COLOR[role]} style={isMissing ? { textDecoration: 'line-through' } : undefined}>{name}</Tag>
                </Tooltip>
            );
        });
    };

    return (
        <Card size="small" data-testid="risk-assessment-settings-panel" style={{ borderRadius: 8 }}>
            <CollapsibleCardHeader
                testId="risk-settings-header"
                open={isPanelOpenStatus}
                onToggle={() => setIsPanelOpenStatus(!isPanelOpenStatus)}
                title={translate('step3_risk_settings.title', '風險評估進階設定（選填）')}
                tooltip={translate('step3_risk_settings.title_tooltip', '影響 Step4 三攻擊與 CAP 怎麼評估，不會改變去識別化後的輸出資料。從 Step2 匯入含風險評估區塊的設定檔（例如統合版）時，會自動帶入。')}
                tags={isAnyCustomized
                    ? <Tag color="green">{translate('step3_risk_settings.status_customized', '已調整')}</Tag>
                    : <Tag>{translate('step3_risk_settings.status_default', '預設')}</Tag>}
                note={isPanelOpenStatus ? undefined : translate('step3_risk_settings.collapsed_note', '影響 Step 4 風險怎麼評估，不會改變輸出資料。')}
            />
            {isPanelOpenStatus && (
                <div style={{ marginTop: 12 }}>
                <Space direction="vertical" style={{ width: '100%' }} size={14}>
                    {/* ── 欄位角色 ── */}
                    <div>
                        <Space size={6} wrap style={{ marginBottom: 6 }}>
                            <Text strong>{translate('step3_risk_settings.roles_title', '評估用欄位角色')}</Text>
                            {riskColumnOverrides
                                ? <Tag color="green">{translate('step3_risk_settings.from_import', '依匯入設定')}</Tag>
                                : <Tag>{translate('step3_risk_settings.derived', '沿用原本設定')}</Tag>}
                        </Space>
                        {riskColumnOverrides ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div><Text type="secondary" style={{ fontSize: scaleFontSize(12) }}>{translate('step3_risk_settings.quasi_identifier', '間接識別：')}</Text>{renderColumnTags('quasi_identifier')}</div>
                                <div><Text type="secondary" style={{ fontSize: scaleFontSize(12) }}>{translate('step3_risk_settings.sensitive', '敏感：')}</Text>{renderColumnTags('sensitive')}</div>
                                <div>
                                    <Button size="small" icon={<UndoOutlined />} data-testid="risk-roles-revert" onClick={() => useWorkspaceStore.setState({ riskColumnOverrides: null })}>
                                        {privacyMode === 'differential-privacy'
                                            ? translate('step3_risk_settings.revert_roles_dp', '改回依差分隱私欄位判定')
                                            : translate('step3_risk_settings.revert_roles_kanon', '改回依 K-匿名欄位角色')}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <Text type="secondary" style={{ fontSize: scaleFontSize(12) }}>{derivedRoleText}</Text>
                        )}
                    </div>

                    {/* ── 連結性分組 ── */}
                    <div>
                        <Space size={6} wrap style={{ marginBottom: 6 }}>
                            <Text strong>{translate('step3_risk_settings.linkability_title', '連結性攻擊分組')}</Text>
                            <Tooltip title={translate('step3_risk_settings.linkability_tooltip', '模擬攻擊者手上有兩份資料（A、B 各有部分欄位），看能否把同一個人對起來。兩組不可重疊，且只能用間接識別欄位。')}>
                                <QuestionCircleOutlined style={{ color: '#999', cursor: 'help' }} />
                            </Tooltip>
                        </Space>
                        {riskLinkability ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div><Text type="secondary" style={{ fontSize: scaleFontSize(12) }}>A：</Text>{riskLinkability.A.map((name) => <Tag key={name}>{name}</Tag>)}</div>
                                <div><Text type="secondary" style={{ fontSize: scaleFontSize(12) }}>B：</Text>{riskLinkability.B.map((name) => <Tag key={name}>{name}</Tag>)}</div>
                                <div>
                                    <Button size="small" icon={<UndoOutlined />} data-testid="risk-linkability-revert" onClick={() => useWorkspaceStore.setState({ riskLinkability: null })}>
                                        {translate('step3_risk_settings.revert_linkability', '改由系統自動分組')}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <Text type="secondary" style={{ fontSize: scaleFontSize(12) }}>
                                {translate('step3_risk_settings.linkability_auto', '由系統自動把間接識別欄位對半分成兩組。')}
                            </Text>
                        )}
                    </div>

                    {/* ── 三攻擊實驗參數 ── */}
                    <div>
                        <Space size={6} wrap style={{ marginBottom: 6 }}>
                            <Text strong>{translate('step3_risk_settings.params_title', '三攻擊實驗參數')}</Text>
                            {isParamsCustomized
                                ? <Tag color="green">{translate('step3_risk_settings.params_customized', '已調整')}</Tag>
                                : <Tag>{translate('step3_risk_settings.params_default', '預設')}</Tag>}
                            <Button size="small" icon={<UndoOutlined />} disabled={!isParamsCustomized} data-testid="risk-params-reset" onClick={() => useWorkspaceStore.setState({ riskAttackParams: null })}>
                                {translate('step3_risk_settings.reset_params', '還原預設')}
                            </Button>
                        </Space>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(13em, 1fr))', gap: '8px 16px' }}>
                            {RISK_ATTACK_PARAM_KEYS.map((paramKey) => {
                                const rule = RISK_ATTACK_PARAM_RULES[paramKey];
                                const labelInfo = RISK_ATTACK_PARAM_LABELS[paramKey];
                                const isChanged = effectiveParams[paramKey] !== RISK_ATTACK_DEFAULT_PARAMS[paramKey];
                                return (
                                    <div key={paramKey}>
                                        <div style={{ fontSize: scaleFontSize(12), marginBottom: 2 }}>
                                            <Space size={4}>
                                                <span>{translate(`step3_risk_settings.param_${paramKey}`, labelInfo.label)}</span>
                                                <Text type="secondary" style={{ fontSize: scaleFontSize(11) }}>{paramKey}</Text>
                                                <Tooltip title={`${translate(`step3_risk_settings.param_${paramKey}_hint`, labelInfo.hint)}（${translate('step3_risk_settings.default_value', '預設')} ${RISK_ATTACK_DEFAULT_PARAMS[paramKey]}）`}>
                                                    <QuestionCircleOutlined style={{ color: '#999', cursor: 'help' }} />
                                                </Tooltip>
                                            </Space>
                                        </div>
                                        <InputNumber
                                            size="small"
                                            data-testid={`risk-param-${paramKey}`}
                                            value={effectiveParams[paramKey]}
                                            min={rule.minExclusive ? rule.min + 0.01 : rule.min}
                                            max={rule.max !== undefined ? (rule.maxExclusive ? rule.max - 0.01 : rule.max) : undefined}
                                            step={labelInfo.step}
                                            precision={rule.integer ? 0 : 2}
                                            onChange={(value) => handleParamChange(paramKey, value)}
                                            status={isChanged ? 'warning' : undefined}
                                            style={{ width: '100%' }}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                        {isHeavierThanDefault && (
                            <Text type="warning" style={{ display: 'block', marginTop: 8, fontSize: scaleFontSize(12) }} data-testid="risk-params-slow-hint">
                                {translate('step3_risk_settings.slow_hint', '迭代次數 × 重複輪數為預設的 {{times}} 倍，Step4 風險評估會明顯變慢（大型資料可能逾時）。', {
                                    times: Math.round((effectiveParams.n_iter * effectiveParams.n_repeats) / (RISK_ATTACK_DEFAULT_PARAMS.n_iter * RISK_ATTACK_DEFAULT_PARAMS.n_repeats) * 10) / 10
                                })}
                            </Text>
                        )}
                    </div>
                </Space>
                </div>
            )}
        </Card>
    );
}
