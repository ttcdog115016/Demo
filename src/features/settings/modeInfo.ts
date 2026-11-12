/**
 * 檔案名稱 (File): modeInfo.ts
 * 模組功能 (Description): 「系統模式」分頁（ModeInfoPanel.tsx）用的純函式。放在獨立檔案，元件檔才只匯出元件（Fast Refresh 的要求）。
 */

const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]', '::1'];

/** 是否從本機連入（localhost、127.0.0.1、::1） */
export const isLoopbackHostname = (hostname: string): boolean => LOOPBACK_HOSTNAMES.includes(hostname.toLowerCase());
