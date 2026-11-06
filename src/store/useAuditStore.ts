/**
 * ============================================================================
 * 檔案名稱 (File): useAuditStore.ts
 * 模組功能 (Description): 全域歷史審計軌跡數據庫狀態管理 (Zustand Audit Log Store，提供審計憑證紀錄新增與歷次簽發軌跡查詢)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅單字元變數與含義不明之縮寫) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import { create } from 'zustand';
import { fetchHistory, postHistory } from '../api/systemApi';
import type { AuditIntegrityRecord } from '../utils/auditIntegrity';
import type { ComplianceReportSnapshot } from '../utils/complianceReport';

/** 合規結果：達標／未達合規標準／未完成風險評估 */
export type ComplianceStatus = 'passed' | 'failed' | 'unassessed';

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
	inputRowCount: number;   // 輸入資料筆數（原始上傳 CSV 實際資料列數，扣除表頭）
	deletedRowCount: number; // 刪除資料筆數（輸入筆數 - 輸出筆數，抑制／去識別化過程中被移除之列數）
	outputRowCount: number;  // 輸出資料筆數（後端回傳之去識別化 CSV 實際資料列數，扣除表頭）
	status: ComplianceStatus; // 合規結果；★ 2026-11-06 新增 'unassessed'（未完成風險評估，不算達標）。顯示請用 resolveAuditLogComplianceStatus（utils/complianceReport.ts）
	columnsSnapshot: string[];                        // 簽發當下資料集之欄位名稱陣列快照 (不隨後續 WorkspaceStore 變動而改變)
	columnRoleSnapshot: Record<string, string>;       // 簽發當下各欄位最終隱私角色快照 (如 Identifier/Quasi-identifier/DP Sensitive/Retained/Non-sensitive)
	identifierMaskStrategySnapshot: Record<string, string>; // 簽發當下 Identifier 欄位實際套用之遮蔽策略快照 ('hash' | 'remove')，用以區分套用技術對照表顯示「完全遮蔽」或「直接移除」
	dpEnabledFieldNamesSnapshot: string[];            // 簽發當下已啟用差分隱私之欄位名稱清單快照
	qiGeneralizationTechSnapshot?: Record<string, string>; // ★ 2026-10-05：K-匿名間接識別欄位實際套用之泛化技術代碼快照（見 utils/kAnonymityTechLabel.ts）；舊紀錄無此欄位，顯示退回「區間/時間泛化」
	reportSnapshot?: ComplianceReportSnapshot;        // ★ 2026-10-08：簽發當下合規報告所需數值（處理配置、三攻擊、CAP、效用），Step4 報告與歷史紀錄調閱共用同一份，內容一致；舊紀錄無此欄位
	integrity?: AuditIntegrityRecord;                 // ★ 2026-10-02：防篡改指紋（SHA-256）與數位簽章（ECDSA P-256），見 utils/auditIntegrity.ts；舊紀錄無此欄位
	runId?: string;                                   // ★ 2026-10-29：對應的後端處理呼叫（X-Run-Id），存紀錄時後端驗證
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
	 * 返回值 (Return): Promise<boolean>——★ 2026-10-29 是否已存到後端（後端回傳含伺服器簽章的紀錄，取代畫面上那筆）
	 * 呼叫關係 (Call Relations): 被 usePipelineRunner 於處理完成時調用
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素, c) 確保透過正規 Action 修改全域變數
	 */
	addAuditLog: (auditLogEntry: Omit<AuditLogItem, 'id'>) => Promise<boolean>;
	/** ★ 2026-10-29：自後端載入目前帳號的處理紀錄（登入／重新整理接續登入後呼叫） */
	loadAuditLogs: () => Promise<boolean>; // ★ 2026-10-29：回傳是否載入成功（紀錄頁失敗時顯示錯誤與重新載入）
	/** 登出時清空畫面上的紀錄（後端資料不動） */
	clearAuditLogs: () => void;
}

/**
 * 函數名稱: generateAuditLogId
 * 函數功能: 產生審計紀錄的唯一 ID。
 * ★ 2026-10-02：crypto.randomUUID() 只在安全連線（HTTPS 或 localhost）才存在；Demo 改用內網 IP
 *   （例如 http://172.20.10.2:5173）連線時會拋出「crypto.randomUUID is not a function」，
 *   導致 Step4 去識別化流程在寫入稽核紀錄時失敗。改為：有 randomUUID 就用；否則以
 *   crypto.getRandomValues（非安全連線也可用）組出 RFC 4122 v4 格式；兩者皆無時退回時間戳＋亂數。
 */
export const generateAuditLogId = (): string => {
    const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
        const randomBytes = cryptoApi.getRandomValues(new Uint8Array(16));
        randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40; // version 4
        randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80; // variant 10xx
        const hex = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
};

/**
 * ★ 2026-10-29：處理紀錄改存後端資料庫（GET／POST /api/v1/history，見 api/systemApi.ts）。
 *   先前（2026-10-28）存在瀏覽器 localStorage，換電腦或清快取就不見；舊資料直接捨棄（main.tsx 啟動時清除舊鍵）。
 *   後端每個帳號保留最新 MAX_AUDIT_LOG_ENTRIES_COUNT 筆。
 */
export const LEGACY_AUDIT_LOG_STORAGE_KEY = 'privacy_audit_logs_v1';
export const MAX_AUDIT_LOG_ENTRIES_COUNT = 200;

/** 目前帳號的紀錄（依 operator 比對；未登入時不顯示任何紀錄） */
export const selectAuditLogsForUser = (auditLogs: AuditLogItem[], operatorName: string | null | undefined): AuditLogItem[] =>
	operatorName ? auditLogs.filter((logItem) => logItem.operator === operatorName) : [];

/**
 * 全域歷史審計軌跡 Store 實例 (useAuditStore)
 * 規範對照: 符合規範 i) 全域變數/狀態詳細註記
 */
export const useAuditStore = create<AuditState>()(
	(setStoreStateAction) =>
	(
		{
			// 初始化時，清單預設為空陣列（登入後由 loadAuditLogs 自後端載入）
			auditLogs: [],

			// 新增審計紀錄：先更新畫面（Step4 立即讀得到），再寫入後端；後端簽章後以回傳的紀錄取代
			addAuditLog: async (auditLogEntryData) =>
			{
				// 自動生成 UUID 唯一碼並插入清單最前端 (最新的紀錄顯示在最上面)
				// 規範對照: 符合規範 g) 確保每次呼叫皆產生合理不衝突之 ID 鍵值
				const newAuditLogItem: AuditLogItem = { ...auditLogEntryData, id: generateAuditLogId() };
				setStoreStateAction((currentStoreStateData) => ({
					auditLogs: [newAuditLogItem, ...currentStoreStateData.auditLogs].slice(0, MAX_AUDIT_LOG_ENTRIES_COUNT),
				}));
				try
				{
					const savedAuditLogItem = await postHistory(newAuditLogItem);
					setStoreStateAction((currentStoreStateData) => ({
						auditLogs: currentStoreStateData.auditLogs.map((logItem) => logItem.id === newAuditLogItem.id ? savedAuditLogItem : logItem),
					}));
					return true;
				}
				catch (saveErrorValue)
				{
					console.warn('[處理紀錄] 寫入後端失敗：', saveErrorValue);
					return false;
				}
			},

			loadAuditLogs: async () =>
			{
				try
				{
					const historyRecordsList = await fetchHistory();
					setStoreStateAction({ auditLogs: historyRecordsList.slice(0, MAX_AUDIT_LOG_ENTRIES_COUNT) });
					return true;
				}
				catch (loadErrorValue)
				{
					console.warn('[處理紀錄] 自後端載入失敗：', loadErrorValue);
					return false;
				}
			},

			clearAuditLogs: () => setStoreStateAction({ auditLogs: [] }),
		}
	)
);
