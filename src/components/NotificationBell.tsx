/**
 * ============================================================================
 * 檔案名稱 (File): NotificationBell.tsx
 * 模組功能 (Description): 右上角鈴鐺通知面板。資料來自 Admin 發布之系統公告
 * (useAnnouncementStore)，依登入者角色篩選；點選一則會標為已讀並開啟獨立視窗顯示全文
 * （內容較長時視窗內可捲動）。
 * ============================================================================
 */
import React, { useState } from 'react';
import { Badge, Button, Dropdown, Empty, Modal, Tag, theme } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../store/useAuthStore';
import { useAnnouncementStore, isAnnouncementVisibleToRole, getAnnouncementUserKey } from '../store/useAnnouncementStore';
import { AnnouncementListItem } from './AnnouncementListItem';
import { scaleFontSize } from '../utils/fontScale';
import { AnnouncementLevelIcon } from './AnnouncementLevelIcon';
import { formatAnnouncementFullTime } from '../utils/announcementDisplay';

// 鈴鐺面板最多顯示之公告筆數
const NOTIFICATION_PANEL_MAX_ITEMS = 10;

interface NotificationBellProps
{
	iconColor: string; // 鈴鐺圖示顏色（跟隨頁首主題）
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ iconColor }) =>
{
	const { token } = theme.useToken();
	const { t: translate } = useTranslation();
	const currentUserSessionData = useAuthStore((state) => state.user);
	const allAnnouncementsList = useAnnouncementStore((state) => state.announcements);
	const readIdsByUserDict = useAnnouncementStore((state) => state.readIdsByUser);
	const markAnnouncementsAsReadAction = useAnnouncementStore((state) => state.markAsRead);
	const [isPanelOpenStatus, setIsPanelOpenStatus] = useState<boolean>(false);
	const [viewingAnnouncementId, setViewingAnnouncementId] = useState<string | null>(null); // 目前開啟於視窗中的公告

	const announcementUserKeyString = getAnnouncementUserKey(currentUserSessionData);
	const readIdsList = readIdsByUserDict[announcementUserKeyString] ?? [];
	const visibleAnnouncementsList = allAnnouncementsList
		.filter(announcementItem => isAnnouncementVisibleToRole(announcementItem, currentUserSessionData?.role))
		.slice(0, NOTIFICATION_PANEL_MAX_ITEMS);
	const unreadCountValue = visibleAnnouncementsList.filter(announcementItem => !readIdsList.includes(announcementItem.id)).length;

	// 視窗內容直接從 store 取，Admin 若在視窗開啟期間修改或撤下公告也能即時反映
	const viewingAnnouncementItem = viewingAnnouncementId ? allAnnouncementsList.find(announcementItem => announcementItem.id === viewingAnnouncementId) ?? null : null;

	const handleItemClick = (announcementId: string): void =>
	{
		markAnnouncementsAsReadAction(announcementUserKeyString, [announcementId]);
		setIsPanelOpenStatus(false);
		setViewingAnnouncementId(announcementId);
	};

	const notificationPanelNode = (
		<div
			style={{
				width: 'min(400px, calc(100vw - 32px))', background: token.colorBgElevated, borderRadius: token.borderRadiusLG,
				boxShadow: token.boxShadowSecondary, overflow: 'hidden',
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${token.colorSplit}` }}>
				<span style={{ fontWeight: 600, fontSize: scaleFontSize(15), color: token.colorText }}>
					{translate('notification.panel_title', '通知')}
					{unreadCountValue > 0 && <span style={{ marginLeft: '8px', color: token.colorTextTertiary, fontWeight: 400, fontSize: scaleFontSize(12) }}>{translate('notification.unread_count', '{{count}} 則未讀', { count: unreadCountValue })}</span>}
				</span>
				{unreadCountValue > 0 && (
					<Button type="link" size="small" style={{ padding: 0 }} onClick={() => markAnnouncementsAsReadAction(announcementUserKeyString, visibleAnnouncementsList.map(announcementItem => announcementItem.id))}>
						{translate('notification.mark_all_read', '全部標為已讀')}
					</Button>
				)}
			</div>

			{visibleAnnouncementsList.length === 0 ? (
				<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate('notification.empty', '目前沒有新通知')} style={{ padding: '24px 0' }} />
			) : (
				<div style={{ maxHeight: '420px', overflowY: 'auto', padding: '6px' }}>
					{visibleAnnouncementsList.map(announcementItem => (
						<AnnouncementListItem
							key={announcementItem.id}
							item={announcementItem}
							isUnread={!readIdsList.includes(announcementItem.id)}
							onClick={() => handleItemClick(announcementItem.id)}
						/>
					))}
				</div>
			)}
		</div>
	);

	return (
		<>
			<Dropdown
				trigger={['click']}
				placement="bottomRight"
				open={isPanelOpenStatus}
				onOpenChange={setIsPanelOpenStatus}
				popupRender={() => notificationPanelNode}
			>
				<Badge count={unreadCountValue} size="small" offset={[-2, 2]}>
					<BellOutlined
						aria-label={translate('notification.panel_title', '通知')}
						style={{ fontSize: scaleFontSize(18), color: iconColor, cursor: 'pointer' }}
					/>
				</Badge>
			</Dropdown>

			{/* 公告全文視窗：標題列（圖示＋標題＋標籤）、發布資訊、可捲動內文 */}
			<Modal
				open={viewingAnnouncementItem !== null}
				onCancel={() => setViewingAnnouncementId(null)}
				width={640}
				centered
				destroyOnHidden
				title={viewingAnnouncementItem && (
					<div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingRight: '24px' }}>
						<div
							aria-hidden
							style={{
								flex: '0 0 44px', width: '44px', height: '44px', borderRadius: '50%',
								display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: scaleFontSize(22), lineHeight: 1,
								background: viewingAnnouncementItem.level === 'important' ? token.colorWarningBg : token.colorPrimaryBg,
								border: `1px solid ${viewingAnnouncementItem.level === 'important' ? token.colorWarningBorder : token.colorPrimaryBorder}`,
							}}
						>
							<AnnouncementLevelIcon level={viewingAnnouncementItem.level} />
						</div>
						<div style={{ minWidth: 0 }}>
							<div style={{ fontSize: scaleFontSize(17), fontWeight: 600, wordBreak: 'break-word' }}>{viewingAnnouncementItem.title}</div>
							{viewingAnnouncementItem.level === 'important' && (
								<Tag color="orange" style={{ marginTop: '4px', fontWeight: 400 }}>{translate('notification.important', '重要')}</Tag>
							)}
						</div>
					</div>
				)}
				footer={
					<Button type="primary" onClick={() => setViewingAnnouncementId(null)}>
						{translate('modal.confirm', '確認')}
					</Button>
				}
			>
				{viewingAnnouncementItem && (
					<div>
						<div style={{ color: token.colorTextTertiary, fontSize: scaleFontSize(12), paddingBottom: '12px', marginBottom: '12px', borderBottom: `1px solid ${token.colorSplit}` }}>
							{viewingAnnouncementItem.createdBy} · {formatAnnouncementFullTime(viewingAnnouncementItem.createdAt)}
							{viewingAnnouncementItem.updatedAt ? `（${translate('notification.edited', '已編輯')} ${formatAnnouncementFullTime(viewingAnnouncementItem.updatedAt)}）` : ''}
						</div>
						<div style={{ maxHeight: '60vh', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.8, fontSize: scaleFontSize(14), color: token.colorText }}>
							{viewingAnnouncementItem.content || <span style={{ color: token.colorTextTertiary }}>{translate('notification.no_content', '（此公告沒有內文）')}</span>}
						</div>
					</div>
				)}
			</Modal>
		</>
	);
};

export default NotificationBell;
