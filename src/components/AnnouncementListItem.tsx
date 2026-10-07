/**
 * ============================================================================
 * 檔案名稱 (File): AnnouncementListItem.tsx
 * 模組功能 (Description): 系統公告單列顯示元件（鈴鐺通知面板、Data Owner 首頁橫幅、
 * Admin 公告列表共用）。版面：左方圖示（emoji）｜中間標題＋訊息｜右方時間。
 * ============================================================================
 */
import React from 'react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

import type { AnnouncementItem } from '../store/useAnnouncementStore';
import { scaleFontSize } from '../utils/fontScale';
import { getAnnouncementIcon, formatAnnouncementTime, formatAnnouncementFullTime } from '../utils/announcementDisplay';


interface AnnouncementListItemProps
{
	item: AnnouncementItem;
	isUnread?: boolean;          // 未讀：標題加粗並於時間下方顯示圓點
	isExpanded?: boolean;        // 展開：顯示完整訊息（否則最多 2 行）
	showMeta?: boolean;          // 展開時顯示發布者／修改時間
	onClick?: () => void;
	trailing?: React.ReactNode;  // 時間右側額外元素（例如首頁橫幅的關閉鈕）
}

export const AnnouncementListItem: React.FC<AnnouncementListItemProps> = ({ item, isUnread = false, isExpanded = false, showMeta = false, onClick, trailing }) =>
{
	const { token } = theme.useToken();
	const { t: translate } = useTranslation();
	const isImportantStatus = item.level === 'important';

	return (
		<div
			className="announcement-list-item"
			role={onClick ? 'button' : undefined}
			tabIndex={onClick ? 0 : undefined}
			onClick={onClick}
			onKeyDown={(keyboardEventObj) => { if (onClick && (keyboardEventObj.key === 'Enter' || keyboardEventObj.key === ' ')) { keyboardEventObj.preventDefault(); onClick(); } }}
			style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 14px', cursor: onClick ? 'pointer' : 'default', borderRadius: '10px' }}
		>
			{/* 左：圖示 */}
			<div
				aria-hidden
				style={{
					flex: '0 0 40px', width: '40px', height: '40px', borderRadius: '50%',
					display: 'flex', alignItems: 'center', justifyContent: 'center',
					fontSize: scaleFontSize(20), lineHeight: 1,
					background: isImportantStatus ? token.colorWarningBg : token.colorPrimaryBg,
					border: `1px solid ${isImportantStatus ? token.colorWarningBorder : token.colorPrimaryBorder}`,
				}}
			>
				{getAnnouncementIcon(item)}
			</div>

			{/* 中：標題＋訊息 */}
			<div style={{ flex: '1 1 auto', minWidth: 0 }}>
				<div style={{ fontWeight: isUnread ? 700 : 500, color: token.colorText, fontSize: scaleFontSize(14), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
					{item.title}
				</div>
				{item.content && (
					<div
						style={{
							marginTop: '2px', color: token.colorTextSecondary, fontSize: scaleFontSize(13), lineHeight: 1.5,
							whiteSpace: 'pre-wrap', wordBreak: 'break-word',
							...(isExpanded ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }),
						}}
					>
						{item.content}
					</div>
				)}
				{isExpanded && showMeta && (
					<div style={{ marginTop: '6px', color: token.colorTextTertiary, fontSize: scaleFontSize(12) }}>
						{item.createdBy} · {formatAnnouncementFullTime(item.createdAt)}
						{item.updatedAt ? `（${translate('notification.edited', '已編輯')} ${formatAnnouncementFullTime(item.updatedAt)}）` : ''}
					</div>
				)}
			</div>

			{/* 右：時間（＋未讀圓點） */}
			<div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
				<span style={{ color: token.colorTextTertiary, fontSize: scaleFontSize(12), whiteSpace: 'nowrap' }}>
					{formatAnnouncementTime(item.updatedAt ?? item.createdAt, translate)}
				</span>
				{isUnread && <span aria-label={translate('notification.unread', '未讀')} style={{ width: '8px', height: '8px', borderRadius: '50%', background: token.colorError }} />}
			</div>

			{trailing}
		</div>
	);
};

export default AnnouncementListItem;
