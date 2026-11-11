/**
 * ============================================================================
 * 檔案名稱 (File): CollapsibleCardHeader.tsx
 * 模組功能 (Description): 可點選展開／收合的卡片標題列（標題、問號說明、狀態標籤、箭頭、收合時也看得到的一行說明）。
 * ============================================================================
 * ★ 2026-11-05：Step3「限定特定族群評估風險」「風險評估進階設定」改為預設收合、點標題才展開，
 *   外觀與行為比照 K-匿名／差分隱私頁的「進階」區塊標題列（整列可點、鍵盤 Enter／空白鍵可切換、aria-expanded、右側箭頭）。
 *   問號說明與右側按鈕（extra）點擊時不會觸發展開／收合。
 */
import React from 'react';
import { Tooltip, theme } from 'antd';
import { DownOutlined, UpOutlined, QuestionCircleOutlined } from '@ant-design/icons';

import { scaleFontSize } from '../utils/fontScale';

export interface CollapsibleCardHeaderProps {
    title: React.ReactNode;
    /** 標題旁問號的說明內容；不給就不顯示問號 */
    tooltip?: React.ReactNode;
    /** 標題旁的狀態標籤（例如「已設定 2 個條件」） */
    tags?: React.ReactNode;
    /** 標題下方的一行說明，收合時也看得到 */
    note?: React.ReactNode;
    open: boolean;
    onToggle: () => void;
    /** 標題列右側的按鈕（不會觸發展開／收合） */
    extra?: React.ReactNode;
    testId?: string;
}

export default function CollapsibleCardHeader({ title, tooltip, tags, note, open, onToggle, extra, testId }: CollapsibleCardHeaderProps): React.ReactElement {
    const { token } = theme.useToken();
    return (
        <div data-testid={testId}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    data-testid={testId ? `${testId}-toggle` : undefined}
                    onClick={onToggle}
                    onKeyDown={(keyboardEvent) => {
                        // 只處理標題列本身的按鍵，避免問號或標籤裡的操作被當成切換
                        if (keyboardEvent.target !== keyboardEvent.currentTarget) return;
                        if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
                            keyboardEvent.preventDefault();
                            onToggle();
                        }
                    }}
                    style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, cursor: 'pointer', fontSize: scaleFontSize(16), fontWeight: 700, color: token.colorText }}
                >
                    <span>{title}</span>
                    {tooltip && (
                        <Tooltip title={tooltip}>
                            <span onClick={(clickEvent) => clickEvent.stopPropagation()} style={{ display: 'inline-flex' }}>
                                <QuestionCircleOutlined style={{ color: '#999', cursor: 'help', fontSize: scaleFontSize(14) }} />
                            </span>
                        </Tooltip>
                    )}
                    {tags}
                </div>
                {extra}
                <span aria-hidden="true" onClick={onToggle} style={{ cursor: 'pointer', color: token.colorTextSecondary }}>
                    {open ? <UpOutlined /> : <DownOutlined />}
                </span>
            </div>
            {note && (
                <div style={{ marginTop: 6, fontSize: scaleFontSize(13), color: token.colorTextSecondary }}>{note}</div>
            )}
        </div>
    );
}
