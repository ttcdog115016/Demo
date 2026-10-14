/**
 * ============================================================================
 * 檔案名稱 (File): RiskLevelBadge.tsx
 * 模組功能 (Description): 風險等級徽章（圖示＋L1/L2/L3＋低/中/高風險），Step4 畫面與合規報告 PDF 共用。
 * ============================================================================
 * 只用 inline style 與 antd icon（SVG），html2canvas 轉 PDF 時顏色不會跑掉；
 * 等級同時以圖示形狀與文字表示，不只靠顏色區分。
 */
import type { CSSProperties } from 'react';
import { CheckCircleFilled, ExclamationCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { classifyRiskLevel, getRiskLevelInfo, RISK_LEVEL_THRESHOLDS } from '../utils/riskLevel';
import type { RiskLevelNumber, OverallRiskSummary } from '../utils/riskLevel';

import { scaleFontSize } from '../utils/fontScale';
interface RiskLevelBadgeProps {
    /** 風險值（0~1）；與 level 擇一 */
    riskRatio?: number | null;
    /** 直接指定等級（分級說明用） */
    level?: RiskLevelNumber;
    size?: 'small' | 'default';
    /** 只顯示 L1/L2/L3，不顯示「低風險」等文字 */
    compact?: boolean;
    style?: CSSProperties;
}

const LEVEL_ICON_MAP = { 1: CheckCircleFilled, 2: ExclamationCircleFilled, 3: CloseCircleFilled } as const;

export default function RiskLevelBadge({ riskRatio, level, size = 'default', compact = false, style }: RiskLevelBadgeProps) {
    const info = level ? getRiskLevelInfo(level) : classifyRiskLevel(riskRatio);
    if (!info) return null;
    const LevelIcon = LEVEL_ICON_MAP[info.level];
    const isSmall = size === 'small';
    return (
        <span
            data-testid={`risk-level-badge-${info.code}`}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                padding: isSmall ? '0 6px' : '2px 8px', borderRadius: 999,
                fontSize: scaleFontSize(isSmall ? 12 : 13), fontWeight: 600, lineHeight: isSmall ? '20px' : '22px',
                color: info.color, background: info.backgroundColor, border: `1px solid ${info.color}`,
                ...style,
            }}
        >
            <LevelIcon />
            {compact ? info.code : `${info.code} ${info.labelText}`}
        </span>
    );
}

/** 分級說明列：三個徽章＋門檻，放在圖表或報告下方 */
export function RiskLevelLegend({ style, textColor }: { style?: CSSProperties; textColor?: string }) {
    const lowPct = `${RISK_LEVEL_THRESHOLDS.low * 100}%`;
    const highPct = `${RISK_LEVEL_THRESHOLDS.high * 100}%`;
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: scaleFontSize(12), color: textColor, ...style }}>
            <RiskLevelBadge level={1} size="small" /><span>&lt; {lowPct}</span>
            <RiskLevelBadge level={2} size="small" /><span>{lowPct}～{highPct}</span>
            <RiskLevelBadge level={3} size="small" /><span>≥ {highPct}</span>
        </div>
    );
}

/**
 * ★ 2026-10-06：整體風險等級結果圖（唯一一處顯示等級）。
 *   左側大圖示＋等級，右側 L1｜L2｜L3 三段刻度條，只有目前等級上色、其餘灰階，刻度下標門檻。
 *   textColor／mutedColor／trackColor 由呼叫端傳入，Step4 跟深淺色主題、PDF 固定白底。
 */
export function OverallRiskLevelPanel({ summary, title, driverText, textColor, mutedColor, trackColor }: {
    summary: OverallRiskSummary;
    title: string;
    driverText: string;
    textColor: string;
    mutedColor: string;
    trackColor: string;
}) {
    const { info } = summary;
    const LevelIcon = LEVEL_ICON_MAP[info.level];
    const lowPct = `${RISK_LEVEL_THRESHOLDS.low * 100}%`;
    const highPct = `${RISK_LEVEL_THRESHOLDS.high * 100}%`;
    const segmentRangeTextList = [`< ${lowPct}`, `${lowPct}～${highPct}`, `≥ ${highPct}`];
    return (
        <div data-testid="overall-risk-level" style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: '13em' }}>
                <LevelIcon style={{ fontSize: scaleFontSize(36), color: info.color }} />
                <div>
                    <div style={{ fontSize: scaleFontSize(12), color: mutedColor }}>{title}</div>
                    <div style={{ fontSize: scaleFontSize(22), fontWeight: 700, color: info.color, lineHeight: 1.2 }}>{info.code} {info.labelText}</div>
                </div>
            </div>
            <div style={{ flex: 1, minWidth: '17em' }}>
                <div style={{ display: 'flex', gap: 4 }}>
                    {([1, 2, 3] as RiskLevelNumber[]).map((levelNumber, index) => {
                        const segmentInfo = getRiskLevelInfo(levelNumber);
                        const isActive = levelNumber === info.level;
                        return (
                            <div key={levelNumber} style={{ flex: 1, textAlign: 'center' }}>
                                <div style={{
                                    height: 26, lineHeight: '26px', borderRadius: 4, fontSize: scaleFontSize(12), fontWeight: isActive ? 700 : 400,
                                    background: isActive ? segmentInfo.color : trackColor,
                                    color: isActive ? '#ffffff' : mutedColor,
                                }}>
                                    {segmentInfo.code} {segmentInfo.labelText}
                                </div>
                                <div style={{ fontSize: scaleFontSize(11), color: mutedColor, marginTop: 2 }}>{segmentRangeTextList[index]}</div>
                            </div>
                        );
                    })}
                </div>
                <div style={{ fontSize: scaleFontSize(12), color: textColor, marginTop: 4 }}>{driverText}</div>
            </div>
        </div>
    );
}

