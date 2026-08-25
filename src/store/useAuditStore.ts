/**
 * ============================================================================
 * 檔案名稱 (File): useAuditStore.ts
 * 模組功能 (Description): 全域歷史審計軌跡數據庫狀態管理 (Zustand Audit Log Store，提供審計憑證紀錄新增與歷次簽發軌跡查詢)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅單字元變數與含義不明之縮寫) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import { create } from 'zustand';

/**
 * 歷史審計軌跡單筆紀錄資料結構介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export interface AuditLogItem 
{
	id: string;              // 審計紀錄唯一識別碼 (UUID)
	certificateId: string;   // 數據合規審計憑證編號 (如: CERT-20260730-8F3C)
	fileName: string;        // 處置資料集之檔案名稱
	privacyMode: string;     // 套用之脫敏保護模式 ('k-anonymity' | 'differential-privacy')
	operator: string;        // 執行簽發處置之操作者名稱
	operatorRole: string;    // 操作者之系統角色 (如: 'data_owner' | 'admin')
	auditTime: string;       // 審計簽發時間顯示字串 (依當地語系格式化，如: '2026/7/30 上午10:00:00'，僅供畫面顯示，不可用於日期運算)
	auditTimestamp: number;  // 審計簽發時間之 Unix 時間戳記 (毫秒)，供月份/區間篩選等日期運算使用
	parameters: string;      // 該次處置套用之關鍵參數摘要字串
	singlingRisk: string;    // 指認性攻擊殘餘風險百分比字串 (如: '12.5%')
	linkabilityRisk: string; // 連結性攻擊殘餘風險百分比字串 (如: '18.2%')
	inferenceRisk: string;   // 推斷性攻擊殘餘風險百分比字串 (如: '15.0%')
	overallRisk: string;     // 綜合殘餘風險百分比字串 (如: '18.2%')
	status: 'passed' | 'failed'; // 審計驗證結果狀態 ('passed' | 'failed')
	columnsSnapshot: string[];                  // 簽發當下資料集之欄位名稱陣列快照 (不隨後續 WorkspaceStore 變動而改變)
	columnRoleSnapshot: Record<string, string>; // 簽發當下各欄位最終隱私角色快照 (如 Identifier/Quasi-identifier/DP Sensitive/Retained/Non-sensitive)
	dpEnabledFieldNamesSnapshot: string[];      // 簽發當下已啟用差分隱私之欄位名稱清單快照
}

/**
 * 歷史審計軌跡 Store 狀態與 Actions 介面
 * 規範對照: 符合規範 h) 資料結構宣告註記
 */
interface AuditState 
{
	auditLogs: AuditLogItem[]; // 歷史審計紀錄陣列
	
	/**
	 * 函數名稱: addAuditLog
	 * 函數功能: 於 Store 頂部新增一筆歷史審計憑證紀錄 (自動生成唯一 UUID)，並即時同步至審計數據庫清單。
	 * 
	 * 輸入參數 (Input):
	 *   - auditLogEntry (Omit<AuditLogItem, 'id'>): 包含簽發憑證編號、風險量測結果等不含 id 之憑證物件
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 被 Step4_Result 組件於簽發憑證並完成驗證時調用
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素, c) 確保透過正規 Action 修改全域變數
	 */
	addAuditLog: (auditLogEntry: Omit<AuditLogItem, 'id'>) => void;
}

/**
 * 全域歷史審計軌跡 Store 實例 (useAuditStore)
 * 規範對照: 符合規範 i) 全域變數/狀態詳細註記
 */
export const useAuditStore = create<AuditState>(
	(setStoreStateAction) => 
	(
		{
			// 初始化時，清單預設為空陣列
			auditLogs: [],

			// 實作新增審計紀錄之 Action 函式
			addAuditLog: (auditLogEntryData) => setStoreStateAction(
				(currentStoreStateData) => 
				(
					{
						// 自動生成 UUID 唯一碼並插入清單最前端 (最新的紀錄顯示在最上面)
						// 規範對照: 符合規範 g) 確保每次呼叫皆產生合理不衝突之 ID 鍵值
						auditLogs: [
							{ ...auditLogEntryData, id: crypto.randomUUID() }, 
							...currentStoreStateData.auditLogs
						]
					}
				)
			),
		}
	)
);