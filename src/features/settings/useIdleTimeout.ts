/**
 * ============================================================================
 * 檔案名稱 (File): useIdleTimeout.ts
 * 模組功能 (Description): 使用者閒置連線逾時自動登出 Custom Hook (監聽滑鼠/鍵盤活動，超時自動清除 Session 並提示)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import { useEffect, useRef } from 'react';
import { App as AntdApp } from 'antd';

import { useAuthStore } from '../../store/useAuthStore';

/**
 * 預設連線安全常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 * 
 * 詳細說明:
 * - DEFAULT_IDLE_TIMEOUT_MINUTES: 當外部未提供閒置時間參數時，預設採用之閒置逾時分鐘數 (30 分鐘)。
 * - MIN_IDLE_TIMEOUT_MINUTES: 系統容許之最小閒置分鐘數下限 (1 分鐘)，防止設定錯誤導致無窮迴圈或立即登出。
 * - MILLISECONDS_PER_SECOND: 單位換算常數，1 秒等於 1000 毫秒。
 * - SECONDS_PER_MINUTE: 單位換算常數，1 分鐘等於 60 秒。
 * - CHECK_INTERVAL_MILLISECONDS: 定時器 (setInterval) 之輪詢間隔時間 (1000 毫秒，即 1 秒檢查一次)。
 */
const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;
const MIN_IDLE_TIMEOUT_MINUTES = 1;
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const CHECK_INTERVAL_MILLISECONDS = 1000;

/**
 * 函數名稱: useIdleTimeout
 * 函數功能: 監聽使用者全域 UI 操作事件 (滑鼠移動/點擊/鍵盤/滾動)，於系統閒置達指定時間時自動觸發安全登出與警告提示。
 * 
 * 輸入參數 (Input):
 *   - timeoutMinutesConfig (number): 強制登出之閒置分鐘數 (取值範圍: >= 1，預設: 30)
 * 輸出參數 (Output): 無
 * 返回值 (Return): void
 * 呼叫關係 (Call Relations): 
 *   - 被 App.tsx 或 MainLayout 組件於掛載時調用
 *   - 訂閱用 useAuthStore 讀取登入狀態並調用 logout 方法
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素, d) 防止向全域變數或依賴傳遞不合理值
 */
export const useIdleTimeout = (timeoutMinutesConfig: number = DEFAULT_IDLE_TIMEOUT_MINUTES): void => 
{
	// 訂閱全域 AuthStore 之登出動作函數，用於觸發強制登出
	const executeLogoutAction = useAuthStore(
		(state) => state.logout
	);

	// 訂閱全域 AuthStore 之登入狀態，用以判斷是否需要啟用閒置監聽
	const isUserAuthenticatedStatus = useAuthStore(
		(state) => state.isAuthenticated
	);
	
	// 取得 Ant Design 全域提示訊息 API (用於彈出登出警告)
	const { message: messageApi } = AntdApp.useApp();
	
	// 使用 useRef 儲存最後活動時間戳記，避免狀態更新引發元件不必要的重新渲染
	// 取值範圍: 系統時間毫秒數，初始值為 0
	const lastActivityTimestampRef = useRef<number>(0);
	
	// 使用 useRef 儲存 setInterval 之計時器 ID，以便在元件卸載或條件改變時進行清除 (Cleanup)
	const checkIntervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// 核心副作用處理區塊 (Effect Hook)
	useEffect(
		() => 
		{
			// 若使用者尚未登入，則不啟動任何監聽器與定時器 (提早返回，節省資源)
			if (!isUserAuthenticatedStatus) 
			{
				return;
			}

			/**
			 * 函數名稱: updateLastActivityTimestamp
			 * 函數功能: 更新最後活動時間戳至當前系統時間。
			 * 
			 * 輸入參數 (Input): 無
			 * 返回值 (Return): void
			 * 說明: 綁定於各項 UI 事件，一旦觸發即刷新時間，代表使用者「仍在活動中」。
			 */
			const updateLastActivityTimestamp = (): void => 
			{
				lastActivityTimestampRef.current = Date.now();
			};

			// 定義欲監聽之瀏覽器全域事件列表 (涵蓋滑鼠、鍵盤、滾動及觸控)
			const monitoredUserEventsList = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

			// 針對列表中之每一個事件，向 window 註冊監聽器
			// { passive: true } 屬性可提升滾動等事件之效能，告知瀏覽器該監聽器不會呼叫 preventDefault
			monitoredUserEventsList.forEach(
				(userEventNameString) => window.addEventListener(userEventNameString, updateLastActivityTimestamp, { passive: true })
			);

			// 啟動監聽時，先進行第一次時間戳更新，設定初始活動基準點
			updateLastActivityTimestamp();

			// 設定定時器 (setInterval)，每隔 CHECK_INTERVAL_MILLISECONDS (1秒) 檢查一次閒置狀態
			checkIntervalIdRef.current = setInterval(
				() => 
				{
					// ============================================================================
					// 1. 閒置門檻計算區塊
					// 規範對照: 符合變數撰寫規範 b) 確認變數取值範圍、d) 防止不合理值發生
					// ============================================================================
					
					// 防呆處理：確保閒置判定時間不會小於合理下限 (MIN_IDLE_TIMEOUT_MINUTES)
					// 若外部傳入 null, undefined 或小於 1 的數值，皆會被校正為安全下限
					const effectiveTimeoutMinutesValue = Math.max(MIN_IDLE_TIMEOUT_MINUTES, timeoutMinutesConfig || DEFAULT_IDLE_TIMEOUT_MINUTES);

					// 將分鐘數轉換為系統比對用之毫秒數 (毫秒 = 分鐘 * 60秒 * 1000毫秒)
					const timeoutThresholdMillisecondsValue = effectiveTimeoutMinutesValue * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
					
					// ============================================================================
					// 2. 當前狀態判定區塊
					// ============================================================================

					// 計算自最後一次活動 (lastActivityTimestampRef) 至今，總共經過了多少毫秒
					const currentIdleDurationMillisecondsValue = Date.now() - lastActivityTimestampRef.current;

					// 判斷條件：
					// a. lastActivityTimestampRef.current !== 0 確保已成功捕捉過活動 (非初始未啟動狀態)
					// b. currentIdleDurationMillisecondsValue >= timeoutThresholdMillisecondsValue 代表閒置時間已達標
					if (lastActivityTimestampRef.current !== 0 && currentIdleDurationMillisecondsValue >= timeoutThresholdMillisecondsValue) 
					{
						// ============================================================================
						// 3. 逾時觸發處置區塊
						// ============================================================================
						
						console.log(`[閒置偵測] 已閒置超過 ${effectiveTimeoutMinutesValue} 分鐘，觸發強制登出！`);

						// 執行全域 AuthStore 之登出程序以清除 Session
						executeLogoutAction('idle');

						// 彈出 UI 系統提示告知使用者已被登出 (符合變數撰寫規範 g 異常回饋)
						messageApi.warning('由於您已閒置過久，系統已自動將您登出。');
						
						// 登出後立即停止並清除目前的檢查定時器，避免重複執行 (防呆與記憶體保護)
						if (checkIntervalIdRef.current) 
						{
							clearInterval(checkIntervalIdRef.current);
						}
					}
				}, 
				CHECK_INTERVAL_MILLISECONDS
			);

			/**
			 * useEffect 清除函式 (Cleanup Function)
			 * 執行時機：當 Component 卸載 (Unmount) 或依賴變數陣列更新時觸發
			 * 規範對照: 符合變數撰寫規範 c) 確實管理全域監聽器與記憶體，避免 Memory Leak
			 */
			return () => 
			{
				// 卸載時移除所有綁定於 window 上的使用者活動事件監聽器
				monitoredUserEventsList.forEach(
					(userEventNameString) => window.removeEventListener(userEventNameString, updateLastActivityTimestamp)
				);

				// 卸載時若定時器仍在運行，則將其徹底清除
				if (checkIntervalIdRef.current) 
				{
					clearInterval(checkIntervalIdRef.current);
				}
			};
		}, 
		// 依賴陣列：當這些變數發生變化時，將重新執行 useEffect (並先執行 cleanup)
		[timeoutMinutesConfig, executeLogoutAction, isUserAuthenticatedStatus, messageApi]
	);
};