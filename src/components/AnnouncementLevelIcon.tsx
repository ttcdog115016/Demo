/**
 * 檔案名稱 (File): AnnouncementLevelIcon.tsx
 * 模組功能 (Description): 系統公告左側圖示。依重要程度顯示單色線條圖示
 * （一般＝公告喇叭／主色、重要＝驚嘆號／警告色），取代原本可自選的 emoji，畫面較素淨。
 */
import React from 'react';
import { theme } from 'antd';
import { NotificationOutlined, ExclamationCircleOutlined } from '@ant-design/icons';

import type { AnnouncementLevel } from '../store/useAnnouncementStore';

interface AnnouncementLevelIconProps
{
	level: AnnouncementLevel;
}

export const AnnouncementLevelIcon: React.FC<AnnouncementLevelIconProps> = ({ level }) =>
{
	const { token } = theme.useToken();
	return level === 'important'
		? <ExclamationCircleOutlined style={{ color: token.colorWarning }} />
		: <NotificationOutlined style={{ color: token.colorPrimary }} />;
};

export default AnnouncementLevelIcon;
