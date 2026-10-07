/**
 * 檔案名稱 (File): announcementDisplay.ts
 * 模組功能 (Description): 系統公告顯示用的共用常數與函式（圖示選項、預設圖示、相對時間）。
 * 與 AnnouncementListItem.tsx 分開，避免元件檔匯出非元件而影響 Fast Refresh。
 */
import type { AnnouncementItem } from '../store/useAnnouncementStore';

// Admin 發布公告時可選的圖示（emoji 不需額外載入圖檔，各平台皆可顯示）
export const ANNOUNCEMENT_ICON_OPTIONS: { value: string; labelKey: string; fallback: string }[] = [
	{ value: '📢', labelKey: 'admin.announce_icon_notice', fallback: '公告' },
	{ value: '🛠️', labelKey: 'admin.announce_icon_maintenance', fallback: '維護' },
	{ value: '🚀', labelKey: 'admin.announce_icon_release', fallback: '更新' },
	{ value: '⚠️', labelKey: 'admin.announce_icon_warning', fallback: '注意' },
	{ value: '💡', labelKey: 'admin.announce_icon_tip', fallback: '提示' },
	{ value: '🎉', labelKey: 'admin.announce_icon_celebrate', fallback: '好消息' },
];

/**
 * 函數名稱: getAnnouncementIcon
 * 函數功能: 取公告圖示；舊資料沒有 icon 欄位時依重要程度給預設值。
 */
export const getAnnouncementIcon = (item: AnnouncementItem): string =>
	item.icon || (item.level === 'important' ? '⚠️' : '📢');

/**
 * 函數名稱: formatAnnouncementTime
 * 函數功能: 右側時間顯示——1 分鐘內「剛剛」、1 小時內「N 分鐘前」、今天「HH:mm」、
 *           昨天「昨天 HH:mm」、今年「M/D」、更早「YYYY/M/D」。
 */
export const formatAnnouncementTime = (timestampMsValue: number, translate: (key: string, fallback: string, options?: Record<string, unknown>) => string): string =>
{
	const nowDateObj = new Date();
	const targetDateObj = new Date(timestampMsValue);
	const elapsedMinutesValue = Math.floor((nowDateObj.getTime() - timestampMsValue) / 60000);
	const hourMinuteString = `${String(targetDateObj.getHours()).padStart(2, '0')}:${String(targetDateObj.getMinutes()).padStart(2, '0')}`;

	if (elapsedMinutesValue < 1) return translate('notification.time_just_now', '剛剛');
	if (elapsedMinutesValue < 60) return translate('notification.time_minutes_ago', '{{count}} 分鐘前', { count: elapsedMinutesValue });

	const startOfTodayMs = new Date(nowDateObj.getFullYear(), nowDateObj.getMonth(), nowDateObj.getDate()).getTime();
	if (timestampMsValue >= startOfTodayMs) return hourMinuteString;
	if (timestampMsValue >= startOfTodayMs - 86400000) return translate('notification.time_yesterday', '昨天 {{time}}', { time: hourMinuteString });
	if (targetDateObj.getFullYear() === nowDateObj.getFullYear()) return `${targetDateObj.getMonth() + 1}/${targetDateObj.getDate()}`;
	return `${targetDateObj.getFullYear()}/${targetDateObj.getMonth() + 1}/${targetDateObj.getDate()}`;
};

/**
 * 函數名稱: formatAnnouncementFullTime
 * 函數功能: 完整時間 YYYY-MM-DD HH:mm（展開明細用，不受瀏覽器語系影響）。
 */
export const formatAnnouncementFullTime = (timestampMsValue: number): string =>
{
	const dateObj = new Date(timestampMsValue);
	const padTwoDigits = (numberValue: number): string => String(numberValue).padStart(2, '0');
	return `${dateObj.getFullYear()}-${padTwoDigits(dateObj.getMonth() + 1)}-${padTwoDigits(dateObj.getDate())} ${padTwoDigits(dateObj.getHours())}:${padTwoDigits(dateObj.getMinutes())}`;
};
