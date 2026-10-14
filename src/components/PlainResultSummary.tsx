/**
 * ============================================================================
 * 檔案名稱 (File): PlainResultSummary.tsx
 * 模組功能 (Description): Step4 結果的白話版卡片：保護程度（RiskSummaryCard）、資料可用性（UtilitySummaryCard）。
 * ============================================================================
 * ★ 2026-10-06 使用者要求：以「沒有相關背景的公務員」能看懂為目標重新設計。
 *   兩張卡片同一個結構：上方「大圖示＋結論＋一句白話」，下方幾列「白話問題＋白話答案＋（小字）原始數字」。
 *   - 保護程度：三個問題（認出是誰／和其他資料對上／猜出敏感資料），數字改說「每 100 筆約幾筆」；
 *     「猜出敏感資料」取推斷性攻擊與扣除亂猜基線後 CAP 的較高者。
 *   - 可用性：保留多少筆、欄位怎麼處理（保留原值／去識別化／移除或遮蔽），可展開看每個欄位。
 *   只用 inline style 與 antd icon；問號說明由呼叫端傳入 helpIcon（包 antd Tooltip）。
 */
import type { ReactNode } from 'react';
import { CheckCircleFilled, ExclamationCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { classifyRiskLevel, RISK_LEVEL_THRESHOLDS } from '../utils/riskLevel';
import type { OverallRiskSummary } from '../utils/riskLevel';
import { formatPer100Text, COLUMN_TREATMENT_BUCKET_LABEL } from '../utils/plainResultSummary';
import type { UtilityLevelInfo, ColumnTreatmentItem, ColumnTreatmentBucket } from '../utils/plainResultSummary';

import { scaleFontSize } from '../utils/fontScale';
const LEVEL_ICON_MAP = { 1: CheckCircleFilled, 2: ExclamationCircleFilled, 3: CloseCircleFilled } as const;

export interface PlainCardColors {
    text: string;
    muted: string;
    border: string;
    panel: string;
}

type HelpIconRenderer = (tooltip: ReactNode) => ReactNode;

const RISK_VERDICT_TEXT: Record<1 | 2 | 3, string> = {
    1: '資料被認出、被對上或被猜出敏感資料的機會都很低。',
    2: '仍有一定風險，建議針對下方最高的一項調整設定後重新運算。',
    3: '風險偏高，不建議對外提供；請針對下方最高的一項調整設定後重新運算。',
};

/** 上方結論區：大圖示＋標題＋一句白話（兩張卡片共用） */
function VerdictBanner({ level, color, title, verdictText, helpIcon, helpTooltip, colors, testId }: {
    level: 1 | 2 | 3;
    color: string;
    title: string;
    verdictText: string;
    helpIcon?: HelpIconRenderer;
    helpTooltip?: ReactNode;
    colors: PlainCardColors;
    testId: string;
}) {
    const LevelIcon = LEVEL_ICON_MAP[level];
    return (
        <div data-testid={testId} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 10, background: colors.panel, border: `1px solid ${color}` }}>
            <LevelIcon style={{ fontSize: scaleFontSize(40), color, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: scaleFontSize(22), fontWeight: 700, color, lineHeight: 1.25, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {title}
                    {helpTooltip && helpIcon ? helpIcon(helpTooltip) : null}
                </div>
                <div style={{ fontSize: scaleFontSize(14), color: colors.text, marginTop: 4 }}>{verdictText}</div>
            </div>
        </div>
    );
}

/** 下方一列：左邊白話問題（＋問號），右邊白話答案（＋小字原始數字） */
function PlainRow({ question, tooltip, answer, answerColor, detail, helpIcon, colors, isFirst, testId }: {
    question: string;
    tooltip?: ReactNode;
    answer: ReactNode;
    answerColor?: string;
    detail?: ReactNode;
    helpIcon?: HelpIconRenderer;
    colors: PlainCardColors;
    isFirst: boolean;
    testId: string;
}) {
    return (
        <div data-testid={testId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderTop: isFirst ? 'none' : `1px solid ${colors.border}` }}>
            <div style={{ fontSize: scaleFontSize(14), color: colors.text, display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                {question}
                {tooltip && helpIcon ? helpIcon(tooltip) : null}
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: scaleFontSize(15), fontWeight: 700, color: answerColor || colors.text }}>{answer}</div>
                {detail && <div style={{ fontSize: scaleFontSize(12), color: colors.muted, marginTop: 2 }}>{detail}</div>}
            </div>
        </div>
    );
}

export interface RiskQuestionRow {
    key: string;
    /** 白話問題，例如「能否認出是誰」 */
    question: string;
    tooltip?: ReactNode;
    /** 風險比例（0~1）；未評估傳 null */
    value: number | null | undefined;
    notEvaluatedText?: string;
}

export function RiskSummaryCard({ summary, rows, colors, helpIcon }: {
    summary: OverallRiskSummary | null;
    rows: RiskQuestionRow[];
    colors: PlainCardColors;
    helpIcon?: HelpIconRenderer;
}) {
    const lowPct = `${RISK_LEVEL_THRESHOLDS.low * 100}%`;
    const highPct = `${RISK_LEVEL_THRESHOLDS.high * 100}%`;
    const info = summary?.info;
    return (
        <div data-testid="risk-summary-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {info && summary && (
                <VerdictBanner
                    testId="overall-risk-level"
                    level={info.level}
                    color={info.color}
                    title={`${info.code} ${info.labelText}`}
                    verdictText={RISK_VERDICT_TEXT[info.level]}
                    helpIcon={helpIcon}
                    helpTooltip={`依下方三項中最高的一項判定（目前最高：${summary.driver.label}）。分級：L1 低風險 < ${lowPct}｜L2 中風險 ${lowPct}～${highPct}｜L3 高風險 ≥ ${highPct}。這是對處理後資料實際模擬攻擊的結果；只要是 L1，就代表目前的設定已足夠安全，不必為了更安全而犧牲資料可用性。`}
                    colors={colors}
                />
            )}
            <div style={{ borderRadius: 10, border: `1px solid ${colors.border}`, overflow: 'hidden' }}>
                {rows.map((row, rowIndex) => {
                    const rowInfo = classifyRiskLevel(row.value);
                    const per100Text = formatPer100Text(row.value);
                    return (
                        <PlainRow
                            key={row.key}
                            testId={`risk-row-${row.key}`}
                            isFirst={rowIndex === 0}
                            question={row.question}
                            tooltip={row.tooltip}
                            helpIcon={helpIcon}
                            colors={colors}
                            answer={rowInfo && per100Text ? per100Text : (row.notEvaluatedText || '未評估')}
                            answerColor={rowInfo ? rowInfo.color : colors.muted}
                            detail={rowInfo ? `${((row.value as number) * 100).toFixed(1)}%・${rowInfo.code} ${rowInfo.labelText}` : undefined}
                        />
                    );
                })}
            </div>
        </div>
    );
}

const BUCKET_ORDER: ColumnTreatmentBucket[] = ['kept', 'blurred', 'removed'];
// ★ 2026-10-13 使用者要求：「每個欄位怎麼處理」一律預設收起（原本欄位 ≤ 12 個時預設展開）

export function UtilitySummaryCard({ info, recordRow, extraRow, columnItems, colors, helpIcon }: {
    info: UtilityLevelInfo | null;
    /** 第一列：資料筆數保留情形（或差分隱私雜訊程度） */
    recordRow: { question: string; tooltip?: ReactNode; answer: ReactNode; detail?: ReactNode } | null;
    /** 選用的第二列（例如差分隱私的雜訊程度） */
    extraRow?: { question: string; tooltip?: ReactNode; answer: ReactNode; detail?: ReactNode } | null;
    columnItems: ColumnTreatmentItem[];
    colors: PlainCardColors;
    helpIcon?: HelpIconRenderer;
}) {
    const bucketCountMap = BUCKET_ORDER.reduce((countMap, bucket) => ({ ...countMap, [bucket]: columnItems.filter((item) => item.bucket === bucket).length }), {} as Record<ColumnTreatmentBucket, number>);
    const rowList = [recordRow, extraRow].filter((row): row is NonNullable<typeof recordRow> => Boolean(row));
    return (
        <div data-testid="utility-summary-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {info && (
                <VerdictBanner
                    testId="overall-utility-level"
                    level={info.level}
                    color={info.color}
                    title={`可用性${info.labelText}`}
                    verdictText={info.verdictText}
                    colors={colors}
                />
            )}
            <div style={{ borderRadius: 10, border: `1px solid ${colors.border}`, overflow: 'hidden' }}>
                {rowList.map((row, rowIndex) => (
                    <PlainRow key={row.question} testId={`utility-row-${rowIndex}`} isFirst={rowIndex === 0} question={row.question} tooltip={row.tooltip} answer={row.answer} detail={row.detail} helpIcon={helpIcon} colors={colors} />
                ))}
                <div style={{ padding: '12px 16px', borderTop: rowList.length > 0 ? `1px solid ${colors.border}` : 'none' }}>
                    <div style={{ fontSize: scaleFontSize(14), color: colors.text, marginBottom: 8 }}>{columnItems.length} 個欄位的處理方式</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {BUCKET_ORDER.map((bucket) => (
                            <div key={bucket} data-testid={`utility-bucket-${bucket}`} style={{ flex: 1, textAlign: 'center', padding: '8px 4px', borderRadius: 8, background: colors.panel, border: `1px solid ${colors.border}` }}>
                                <div style={{ fontSize: scaleFontSize(20), fontWeight: 700, color: colors.text }}>{bucketCountMap[bucket]}</div>
                                <div style={{ fontSize: scaleFontSize(12), color: colors.muted }}>{COLUMN_TREATMENT_BUCKET_LABEL[bucket]}</div>
                            </div>
                        ))}
                    </div>
                    {columnItems.length > 0 && (
                        // 2026-10-13 起一律預設收起，點選展開
                        <details style={{ marginTop: 10 }}>
                            <summary style={{ fontSize: scaleFontSize(13), color: colors.muted, cursor: 'pointer' }}>每個欄位怎麼處理</summary>
                            <div style={{ marginTop: 6 }}>
                                {columnItems.map((item) => (
                                    <div key={item.columnName} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: scaleFontSize(13), padding: '4px 0', borderBottom: `1px dashed ${colors.border}` }}>
                                        <span style={{ color: colors.text, fontWeight: 600, whiteSpace: 'nowrap' }}>{item.columnName}</span>
                                        <span style={{ color: colors.muted, textAlign: 'right' }}>
                                            {item.plainText}
                                            {item.exampleText && <span style={{ color: colors.text, marginLeft: 6 }}>例：{item.exampleText}</span>}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </details>
                    )}
                </div>
            </div>
        </div>
    );
}
