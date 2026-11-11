/**
 * 檔案名稱 (File): roleLabel.ts
 * 模組功能 (Description): 角色代碼 → 畫面顯示名稱。避免直接把 'data_owner'.toUpperCase()
 * 顯示成「DATA_OWNER」。
 * ★ 2026-10-27：串接後端會員系統，後端角色為 admin／user，前端 data_owner 對應後端 user，畫面顯示為「User」（10/16 決議）。
 */
export const getRoleDisplayName = (roleCode: string | null | undefined): string =>
{
	if (roleCode === 'admin') return 'Admin';
	if (roleCode === 'data_owner') return 'User';
	return roleCode || '-';
};
