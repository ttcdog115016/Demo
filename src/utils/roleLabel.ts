/**
 * 檔案名稱 (File): roleLabel.ts
 * 模組功能 (Description): 角色代碼 → 畫面顯示名稱。避免直接把 'data_owner'.toUpperCase()
 * 顯示成「DATA_OWNER」。
 */
export const getRoleDisplayName = (roleCode: string | null | undefined): string =>
{
	if (roleCode === 'admin') return 'Admin';
	if (roleCode === 'data_owner') return 'Data Owner';
	return roleCode || '-';
};
