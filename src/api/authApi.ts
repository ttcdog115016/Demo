/**
 * ============================================================================
 * 檔案名稱 (File): authApi.ts
 * 模組功能 (Description): 後端會員系統串接（依《會員系統架構圖》民國 115 年 10 月版）。
 *
 * ★ 2026-10-27：依最終版後端（v2.0.0，auth_router.py／users_router.py）接到畫面，
 *   取代前端 Demo 帳號資料庫。登入、接續登入、登出、變更密碼、帳號管理皆經由本檔。
 *
 *   - 10 個端點：/auth/login、/auth/refresh、/auth/logout、/auth/password、
 *     /users（GET／POST）、/users/{username}/role、/users/{username}/reset-password、
 *     /users/{username}/active、DELETE /users/{username}
 *   - access token（JWT，15 分鐘）只放在記憶體；refresh token（7 天）放 sessionStorage，
 *     重新整理頁面可接續登入，關閉分頁即需重新登入。
 *   - 帶 access token 的請求收到 401 時，自動用 refresh token 換發一次並重送；
 *     換發失敗即視為登入逾期，清除 Session 並通知 useAuthStore 登出。
 *   - 使用獨立的 axios 實例，不經過全域攔截器（apiErrorInterceptor.ts，只處理處理 API）。
 *
 * 角色對照：後端 admin／user ↔ 前端 admin／data_owner（前端內部代碼沿用 data_owner，
 * 畫面顯示名稱改為「User」，見 utils/roleLabel.ts）。
 *
 * ★ 欄位名稱已依最終版後端原始碼核對：登入回應帶 username／role；變更密碼主體為
 *   { current_password, new_password }；GET /users 回 { users: [{ username, role, is_active, created_at,
 *   failed_login_count, login_locked_until }], total }（★ 2026-10-29 後端補上鎖定欄位；無密碼變更時間）。
 * ============================================================================
 */

import axios, { type AxiosError, type AxiosRequestConfig } from 'axios';

export const MEMBER_API_PREFIX = '/api/v1';
export const REFRESH_TOKEN_STORAGE_KEY = 'ppt_refresh_token';
export const SESSION_USERNAME_STORAGE_KEY = 'ppt_session_username';
const MEMBER_API_TIMEOUT_MS = 20 * 1000;

// 後端固定的登入失敗鎖定規則（app/governance/auth.py；不開放調整，畫面僅作說明）
export const LOGIN_MAX_ATTEMPTS = 5;               // 累計失敗 5 次
export const LOGIN_ATTEMPT_WINDOW_SECONDS = 180;   // 自本輪第一次失敗起 180 秒內
export const LOGIN_LOCKOUT_SECONDS = 900;          // 鎖定 900 秒（15 分鐘）

export type BackendRole = 'admin' | 'user';
export type FrontendRole = 'admin' | 'data_owner';

/** 後端 user ↔ 前端 data_owner */
export const toFrontendRole = (backendRole: unknown): FrontendRole => (backendRole === 'admin' ? 'admin' : 'data_owner');
export const toBackendRole = (frontendRole: FrontendRole): BackendRole => (frontendRole === 'admin' ? 'admin' : 'user');

/** 會員端點錯誤（已解析後端 error_code／message 與 Retry-After） */
export class MemberApiError extends Error
{
	status: number | null;          // HTTP 狀態碼；null 表示沒有收到回應（網路中斷、逾時、代理找不到後端）
	errorCode: string | null;       // ERR_UNAUTHORIZED、ERR_ACCOUNT_LOCKED…
	retryAfterSeconds: number | null; // 423 鎖定剩餘秒數

	constructor(message: string, status: number | null, errorCode: string | null, retryAfterSeconds: number | null)
	{
		super(message);
		this.name = 'MemberApiError';
		this.status = status;
		this.errorCode = errorCode;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

export const isMemberApiError = (errorValue: unknown): errorValue is MemberApiError => errorValue instanceof MemberApiError;

/** 帳號清單之單一帳號（已轉成前端格式） */
export interface MemberAccount
{
	username: string;
	role: FrontendRole;
	isActive: boolean;
	failedLoginCount: number;
	lockedUntil: number | null; // epoch ms；null 表示未鎖定
	createdAt: number | null;   // epoch ms
}

export interface MemberSession
{
	username: string;
	role: FrontendRole;
}

// ============================================================================
// Token 保存
// ============================================================================

let accessTokenInMemory: string | null = null;
// 每次登入成功加 1（換發 token 不變），供延後執行的登出判斷是否仍是同一次登入
// ★ 2026-11-02：清除本機 Session（登出、逾期）時也加 1，讓登出前就開始的換發／運算在完成時能判斷「已不是同一次登入」
let loginGeneration = 0;
export const getLoginGeneration = (): number => loginGeneration;
let sessionExpiredListener: (() => void) | null = null;

const readSessionStorage = (storageKey: string): string | null =>
{
	try { return window.sessionStorage.getItem(storageKey); } catch { return null; }
};
const writeSessionStorage = (storageKey: string, storageValue: string | null): void =>
{
	try
	{
		if (storageValue === null) window.sessionStorage.removeItem(storageKey);
		else window.sessionStorage.setItem(storageKey, storageValue);
	}
	catch
	{
		// 隱私模式等環境無法寫入，Session 只存在記憶體，重新整理需重新登入
	}
};

let refreshTokenInMemory: string | null = null;
const getRefreshToken = (): string | null => refreshTokenInMemory ?? readSessionStorage(REFRESH_TOKEN_STORAGE_KEY);

const storeTokens = (accessToken: string, refreshToken: string, username?: string): void =>
{
	accessTokenInMemory = accessToken;
	refreshTokenInMemory = refreshToken;
	writeSessionStorage(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
	if (username) writeSessionStorage(SESSION_USERNAME_STORAGE_KEY, username);
};

// ============================================================================
// ★ 2026-11-02（F8）：複製分頁共用 refresh token
// ============================================================================
// 「複製分頁」會連 sessionStorage 一起複製，兩個分頁拿著同一張 refresh token。後端換發後舊 token 作廢，
// 已換發的 token 再出現即視為外流、撤銷整個帳號的登入——兩個分頁各自換發就會一起被登出。
// 換發成功後以 BroadcastChannel 通知：仍持有那張舊 token 的分頁（即複製出來的分頁）改用新 token。
// 各自登入的分頁 token 不同，不受影響，也不會拿到別人的 token。
export const AUTH_TAB_SYNC_CHANNEL_NAME = 'open-pets-auth-tab-sync';
const TOKEN_REFRESH_LOCK_NAME = 'open-pets-token-refresh';
// 換發完成後多握住鎖一下，讓通知先送到其他分頁，再讓排隊的分頁進來檢查
const TOKEN_REFRESH_LOCK_HOLD_MS = 150;

interface TokenRotatedMessage
{
	type: 'token-rotated';
	previousRefreshToken: string;
	refreshToken: string;
	accessToken: string;
}

let tabSyncChannel: BroadcastChannel | null = null;
const getTabSyncChannel = (): BroadcastChannel | null =>
{
	if (tabSyncChannel || typeof BroadcastChannel === 'undefined') return tabSyncChannel;
	try
	{
		tabSyncChannel = new BroadcastChannel(AUTH_TAB_SYNC_CHANNEL_NAME);
		tabSyncChannel.onmessage = (event: MessageEvent) =>
		{
			const message = event.data as Partial<TokenRotatedMessage> | null;
			if (message?.type !== 'token-rotated' || !message.refreshToken || !message.accessToken) return;
			// 只接手「同一張舊 token」的換發結果：本分頁是從那個分頁複製出來的同一次登入
			if (!message.previousRefreshToken || message.previousRefreshToken !== getRefreshToken()) return;
			storeTokens(message.accessToken, message.refreshToken);
		};
	}
	catch
	{
		tabSyncChannel = null;
	}
	return tabSyncChannel;
};

const announceTokenRotation = (previousRefreshToken: string, refreshToken: string, accessToken: string): void =>
{
	try
	{
		getTabSyncChannel()?.postMessage({ type: 'token-rotated', previousRefreshToken, refreshToken, accessToken } satisfies TokenRotatedMessage);
	}
	catch
	{
		// 通知失敗不影響本分頁；複製出來的分頁之後換發會被後端拒絕，回登入頁重新登入
	}
};

/** 瀏覽器支援 Web Locks（HTTPS 或 localhost）時，各分頁的換發依序進行；不支援時直接執行 */
const withTokenRefreshLock = async <ResultType>(task: () => Promise<ResultType>): Promise<ResultType> =>
{
	const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
	if (!locks?.request) return task();
	return locks.request(TOKEN_REFRESH_LOCK_NAME, async () =>
	{
		const result = await task();
		await new Promise((resolve) => setTimeout(resolve, TOKEN_REFRESH_LOCK_HOLD_MS));
		return result;
	}) as Promise<ResultType>;
};

/** 清除本機保存的 token（不呼叫後端） */
export const clearMemberSession = (): void =>
{
	loginGeneration += 1;
	accessTokenInMemory = null;
	refreshTokenInMemory = null;
	writeSessionStorage(REFRESH_TOKEN_STORAGE_KEY, null);
	writeSessionStorage(SESSION_USERNAME_STORAGE_KEY, null);
};

export const hasStoredRefreshToken = (): boolean => !!getRefreshToken();

/** ★ 2026-10-29：目前是否持有 access token（系統維運日誌未登入時不送後端，見 useSystemLogStore） */
export const hasAccessToken = (): boolean => !!accessTokenInMemory;

/** ★ 2026-10-29：目前的 access token（處理 API 的全域 axios 請求帶上，見 apiErrorInterceptor） */
export const getAccessToken = (): string | null => accessTokenInMemory;

/** 換發失敗（refresh token 失效）時要執行的動作；接線時由 useAuthStore 註冊（例如呼叫 logout） */
export const setSessionExpiredListener = (listenerFn: (() => void) | null): void =>
{
	sessionExpiredListener = listenerFn;
};

// ============================================================================
// HTTP 與錯誤解析
// ============================================================================

const memberHttpClient = axios.create({ baseURL: MEMBER_API_PREFIX, timeout: MEMBER_API_TIMEOUT_MS });

const FALLBACK_MESSAGE_BY_STATUS: Record<number, string> = {
	400: '參數不正確。',
	401: '帳號或密碼錯誤，或登入已逾期。',
	403: '權限不足，或此操作不被允許。',
	404: '找不到此帳號。',
	409: '帳號已存在。',
	422: '欄位內容不正確。',
	423: '登入失敗次數過多，帳號暫時鎖定。',
	503: '會員系統尚未啟用（後端未設定簽章金鑰）。',
};

/** 把 axios 錯誤轉成 MemberApiError；後端格式 { error_code, message }，亦相容 FastAPI 預設 { detail } */
export const toMemberApiError = (errorValue: unknown): MemberApiError =>
{
	if (isMemberApiError(errorValue)) return errorValue;
	const axiosErrorObj = errorValue as AxiosError<Record<string, unknown>>;
	const responseObj = axiosErrorObj?.response;
	if (!responseObj)
	{
		return new MemberApiError('無法連線至伺服器，請稍後再試。', null, null, null);
	}
	const bodyObj = (responseObj.data && typeof responseObj.data === 'object') ? responseObj.data : {};
	const errorCode = typeof bodyObj.error_code === 'string' ? bodyObj.error_code : null;
	const detailValue = bodyObj.detail;
	const messageText = typeof bodyObj.message === 'string' ? bodyObj.message
		: typeof detailValue === 'string' ? detailValue
		: (FALLBACK_MESSAGE_BY_STATUS[responseObj.status] ?? `伺服器回應錯誤（HTTP ${responseObj.status}）。`);
	const retryAfterHeader = responseObj.headers?.['retry-after'] ?? responseObj.headers?.['Retry-After'];
	const retryAfterNumber = retryAfterHeader !== undefined ? Number(retryAfterHeader) : NaN;
	return new MemberApiError(messageText, responseObj.status, errorCode, Number.isFinite(retryAfterNumber) ? retryAfterNumber : null);
};

/** 會員系統未啟用或後端沒回應（應顯示「無法登入」而非「帳密錯誤」） */
export const isMemberServiceUnavailable = (errorValue: unknown): boolean =>
{
	const memberErrorObj = toMemberApiError(errorValue);
	return memberErrorObj.status === null || memberErrorObj.status === 503 || memberErrorObj.status >= 500;
};

const pickString = (sourceObj: Record<string, unknown>, ...candidateKeys: string[]): string | undefined =>
{
	for (const candidateKey of candidateKeys)
	{
		const candidateValue = sourceObj[candidateKey];
		if (typeof candidateValue === 'string' && candidateValue) return candidateValue;
	}
	return undefined;
};

/** 解析 token 回應：{ access_token, refresh_token, role?, username? } */
const parseTokenResponse = (responseData: unknown): { accessToken: string; refreshToken: string; role?: string; username?: string } =>
{
	const dataObj = (responseData && typeof responseData === 'object') ? responseData as Record<string, unknown> : {};
	const accessToken = pickString(dataObj, 'access_token', 'accessToken');
	const refreshToken = pickString(dataObj, 'refresh_token', 'refreshToken');
	if (!accessToken || !refreshToken)
	{
		throw new MemberApiError('伺服器回應缺少 token，無法完成登入。', 200, null, null);
	}
	const userObj = (dataObj.user && typeof dataObj.user === 'object') ? dataObj.user as Record<string, unknown> : {};
	return {
		accessToken,
		refreshToken,
		role: pickString(dataObj, 'role') ?? pickString(userObj, 'role'),
		username: pickString(dataObj, 'username') ?? pickString(userObj, 'username'),
	};
};

/** 解析 JWT payload（僅讀取顯示用的帳號與角色，不驗章；驗章由後端負責） */
export const decodeJwtPayload = (jwtToken: string): Record<string, unknown> | null =>
{
	try
	{
		const payloadSegment = jwtToken.split('.')[1];
		if (!payloadSegment) return null;
		const base64Text = payloadSegment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=');
		const jsonText = decodeURIComponent(Array.from(atob(base64Text), (charValue) => '%' + charValue.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
		const payloadObj = JSON.parse(jsonText);
		return payloadObj && typeof payloadObj === 'object' ? payloadObj as Record<string, unknown> : null;
	}
	catch
	{
		return null;
	}
};

// ============================================================================
// 帶 access token 的請求（401 時自動換發一次）
// ============================================================================

let refreshInFlightPromise: Promise<void> | null = null;
// ★ 2026-11-02：進行中的換發是在哪一次登入開始的；登入世代不同時不共用、結果也不採用
let refreshInFlightLoginGeneration = -1;

/** ★ 2026-11-02：換發途中已登出或換人登入，舊的換發結果一律捨棄 */
const SESSION_CHANGED_ERROR_MESSAGE = '登入狀態已變更，已捨棄先前的換發結果，請重新操作。';

// ★ 2026-10-29：export 給 apiErrorInterceptor（處理 API 改須登入，全域 axios 也要帶 token、401 時換發）
export const refreshTokensOnce = (): Promise<void> =>
{
	if (!refreshInFlightPromise || refreshInFlightLoginGeneration !== loginGeneration)
	{
		// ★ 2026-11-02：記下開始時的登入世代。換發完成前若已登出或換人登入，完成時不可 storeTokens()
		//   蓋掉新登入的 token（或把已登出的 Session 寫回），被拒（401）時也不可清除新登入、通知登出。
		const refreshStartLoginGeneration = loginGeneration;
		getTabSyncChannel();
		const refreshTokenAtRequest = getRefreshToken();
		const thisRefreshPromise: Promise<void> = withTokenRefreshLock(async () =>
		{
			const refreshToken = getRefreshToken();
			if (!refreshToken) throw new MemberApiError('登入已逾期，請重新登入。', 401, 'ERR_UNAUTHORIZED', null);
			// ★ 2026-11-02（F8）：等待換發鎖期間，複製出來的另一個分頁已換發並通知、本分頁已改用新 token：
			//   不再送出（拿舊 token 換發會被後端當成外流而撤銷整個帳號的登入）
			if (refreshToken !== refreshTokenAtRequest && accessTokenInMemory) return;
			// 狀態碼刻意給 null（不是 401），避免 authorizedRequest 把它當成 token 過期、改用新登入的 token 重送舊請求
			const throwIfSessionChanged = () =>
			{
				if (loginGeneration !== refreshStartLoginGeneration) throw new MemberApiError(SESSION_CHANGED_ERROR_MESSAGE, null, 'ERR_SESSION_CHANGED', null);
			};
			let responseObj;
			try
			{
				responseObj = await memberHttpClient.post('/auth/refresh', { refresh_token: refreshToken });
			}
			catch (refreshErrorValue)
			{
				throwIfSessionChanged();
				const memberErrorObj = toMemberApiError(refreshErrorValue);
				// 只有後端明確拒絕（401）才清除 Session；網路中斷不清，讓使用者稍後再試
				if (memberErrorObj.status === 401)
				{
					clearMemberSession();
					sessionExpiredListener?.();
				}
				throw memberErrorObj;
			}
			throwIfSessionChanged();
			try
			{
				const parsedTokens = parseTokenResponse(responseObj.data);
				storeTokens(parsedTokens.accessToken, parsedTokens.refreshToken);
				announceTokenRotation(refreshToken, parsedTokens.refreshToken, parsedTokens.accessToken);
			}
			catch (parseErrorValue)
			{
				throw toMemberApiError(parseErrorValue);
			}
		}).finally(() =>
		{
			if (refreshInFlightPromise === thisRefreshPromise) refreshInFlightPromise = null;
		});
		refreshInFlightPromise = thisRefreshPromise;
		refreshInFlightLoginGeneration = refreshStartLoginGeneration;
	}
	return refreshInFlightPromise;
};

// ★ 2026-10-29：export 給 systemApi.ts（處理紀錄、維運日誌、系統設定、公告）共用
export const authorizedRequest = async <ResponseType>(requestConfig: AxiosRequestConfig): Promise<ResponseType> =>
{
	const sendWithCurrentToken = () => memberHttpClient.request<ResponseType>({
		...requestConfig,
		headers: { ...(requestConfig.headers ?? {}), Authorization: `Bearer ${accessTokenInMemory ?? ''}` },
	});
	try
	{
		if (!accessTokenInMemory) await refreshTokensOnce();
		return (await sendWithCurrentToken()).data;
	}
	catch (firstErrorValue)
	{
		const firstMemberErrorObj = toMemberApiError(firstErrorValue);
		// 401 可能是 access token 過期 → 換發後重送一次；變更密碼的 401 則是舊密碼錯誤，不換發
		if (firstMemberErrorObj.status !== 401 || requestConfig.url === '/auth/password') throw firstMemberErrorObj;
		const requestLoginGeneration = loginGeneration;
		await refreshTokensOnce();
		try
		{
			return (await sendWithCurrentToken()).data;
		}
		catch (secondErrorValue)
		{
			const secondMemberErrorObj = toMemberApiError(secondErrorValue);
			// ★ 2026-11-02：重送途中已登出或換人登入時，不可清除新登入的 Session
			if (secondMemberErrorObj.status === 401 && loginGeneration === requestLoginGeneration)
			{
				// 換發成功卻仍 401：帳號已停用或刪除
				clearMemberSession();
				sessionExpiredListener?.();
			}
			throw secondMemberErrorObj;
		}
	}
};

// ============================================================================
// 身分驗證端點
// ============================================================================

/**
 * 取得目前登入者角色：登入回應有 role 用之；否則讀 JWT 的 role；仍沒有則以 GET /users 探測
 * （200 → admin，403 → user）。
 */
const resolveSessionRole = async (accessToken: string, roleFromResponse?: string): Promise<FrontendRole> =>
{
	if (roleFromResponse) return toFrontendRole(roleFromResponse);
	const jwtPayloadObj = decodeJwtPayload(accessToken);
	const roleFromJwt = jwtPayloadObj && typeof jwtPayloadObj.role === 'string' ? jwtPayloadObj.role : undefined;
	if (roleFromJwt) return toFrontendRole(roleFromJwt);
	try
	{
		await authorizedRequest({ method: 'GET', url: '/users' });
		return 'admin';
	}
	catch (probeErrorValue)
	{
		if (toMemberApiError(probeErrorValue).status === 403) return 'data_owner';
		throw probeErrorValue;
	}
};

const resolveSessionUsername = (accessToken: string, usernameFromResponse?: string, fallbackUsername?: string): string =>
{
	if (usernameFromResponse) return usernameFromResponse;
	const jwtPayloadObj = decodeJwtPayload(accessToken);
	const usernameFromJwt = jwtPayloadObj ? (pickString(jwtPayloadObj, 'sub', 'username')) : undefined;
	return usernameFromJwt ?? fallbackUsername ?? readSessionStorage(SESSION_USERNAME_STORAGE_KEY) ?? '';
};

/** POST /auth/login */
export const memberLogin = async (username: string, password: string): Promise<MemberSession> =>
{
	try
	{
		const responseObj = await memberHttpClient.post('/auth/login', { username, password });
		const parsedTokens = parseTokenResponse(responseObj.data);
		const sessionUsername = resolveSessionUsername(parsedTokens.accessToken, parsedTokens.username, username);
		loginGeneration += 1;
		storeTokens(parsedTokens.accessToken, parsedTokens.refreshToken, sessionUsername);
		const sessionRole = await resolveSessionRole(parsedTokens.accessToken, parsedTokens.role);
		return { username: sessionUsername, role: sessionRole };
	}
	catch (loginErrorValue)
	{
		throw toMemberApiError(loginErrorValue);
	}
};

/** 重新整理頁面時以 sessionStorage 的 refresh token 接續登入；沒有 token 或已失效回傳 null */
export const restoreMemberSession = async (): Promise<MemberSession | null> =>
{
	if (!getRefreshToken()) return null;
	try
	{
		await refreshTokensOnce();
		const accessToken = accessTokenInMemory ?? '';
		const sessionUsername = resolveSessionUsername(accessToken);
		const sessionRole = await resolveSessionRole(accessToken);
		return sessionUsername ? { username: sessionUsername, role: sessionRole } : null;
	}
	catch
	{
		return null;
	}
};

/** POST /auth/logout：作廢 refresh token；後端失敗也一律清除本機 Session */
export const memberLogout = async (expectedLoginGeneration?: number): Promise<void> =>
{
	// ★ 2026-10-29：延後登出（例如閒置逾時先等日誌送達）期間若已重新登入，不可登出新的那一次
	if (expectedLoginGeneration !== undefined && expectedLoginGeneration !== loginGeneration) return;
	const refreshToken = getRefreshToken();
	clearMemberSession();
	if (!refreshToken) return;
	try
	{
		await memberHttpClient.post('/auth/logout', { refresh_token: refreshToken });
	}
	catch
	{
		// 後端無法連線時 refresh token 仍會在 7 天後到期；本機已清除即可
	}
};

/** PATCH /auth/password：變更自己的密碼（須帶舊密碼）；401 表示舊密碼錯誤 */
export const changeOwnPassword = async (oldPassword: string, newPassword: string): Promise<void> =>
{
	// 此端點的 401 代表「目前密碼錯誤」，不會自動換發重送；為免 access token 恰好過期（15 分鐘）被誤判為密碼錯誤，
	// 送出前先換發一次（換發被拒時會丟出 401 並通知登出）
	await refreshTokensOnce();
	await authorizedRequest({ method: 'PATCH', url: '/auth/password', data: { current_password: oldPassword, new_password: newPassword, refresh_token: getRefreshToken() } });
};

// ============================================================================
// 帳號管理端點（限 admin）
// ============================================================================

/** 時間欄位：ISO 字串、epoch 秒或 epoch 毫秒 → epoch ms */
export const parseBackendTimestamp = (timeValue: unknown): number | null =>
{
	if (timeValue === null || timeValue === undefined || timeValue === '') return null;
	if (typeof timeValue === 'number' && Number.isFinite(timeValue)) return timeValue < 1e12 ? timeValue * 1000 : timeValue;
	if (typeof timeValue === 'string')
	{
		const numericValue = Number(timeValue);
		if (Number.isFinite(numericValue)) return numericValue < 1e12 ? numericValue * 1000 : numericValue;
		// 無時區的 ISO 字串視為 UTC（SQLite 常見寫法）
		const isoText = /[zZ]|[+-]\d\d:?\d\d$/.test(timeValue) ? timeValue : `${timeValue.replace(' ', 'T')}Z`;
		const parsedMs = Date.parse(isoText);
		return Number.isFinite(parsedMs) ? parsedMs : null;
	}
	return null;
};

export const normalizeMemberAccount = (rawValue: unknown): MemberAccount | null =>
{
	if (!rawValue || typeof rawValue !== 'object') return null;
	const rawObj = rawValue as Record<string, unknown>;
	const username = pickString(rawObj, 'username', 'name');
	if (!username) return null;
	const activeValue = rawObj.is_active ?? rawObj.isActive ?? rawObj.active;
	const failedCountValue = Number(rawObj.failed_login_count ?? rawObj.failedLoginCount ?? 0);
	return {
		username,
		role: toFrontendRole(rawObj.role),
		isActive: activeValue === undefined ? true : (activeValue === true || activeValue === 1 || activeValue === '1' || activeValue === 'true'),
		failedLoginCount: Number.isFinite(failedCountValue) ? failedCountValue : 0,
		lockedUntil: parseBackendTimestamp(rawObj.login_locked_until ?? rawObj.loginLockedUntil),
		createdAt: parseBackendTimestamp(rawObj.created_at ?? rawObj.createdAt),
	};
};

export const isMemberAccountLocked = (accountObj: MemberAccount, nowMs: number = Date.now()): boolean =>
	accountObj.lockedUntil !== null && accountObj.lockedUntil > nowMs;

/** GET /users；回應可為陣列或 { users: [...] } */
export const listMemberAccounts = async (): Promise<MemberAccount[]> =>
{
	const responseData = await authorizedRequest<unknown>({ method: 'GET', url: '/users' });
	const rawList = Array.isArray(responseData) ? responseData
		: (responseData && typeof responseData === 'object')
			? ((responseData as Record<string, unknown>).users ?? (responseData as Record<string, unknown>).items ?? [])
			: [];
	return (Array.isArray(rawList) ? rawList : []).map(normalizeMemberAccount).filter((accountObj): accountObj is MemberAccount => accountObj !== null);
};

const encodeUsername = (username: string): string => encodeURIComponent(username);

/** POST /users */
export const createMemberAccount = async (username: string, password: string, role: FrontendRole): Promise<void> =>
{
	await authorizedRequest({ method: 'POST', url: '/users', data: { username, password, role: toBackendRole(role) } });
};

/** PATCH /users/{username}/role */
export const changeMemberRole = async (username: string, role: FrontendRole, currentPassword?: string): Promise<void> =>
{
	// ★ 2026-11-02（B4）：把管理員降級時須帶操作者自己的密碼（current_password），後端再次驗證
	await authorizedRequest({
		method: 'PATCH',
		url: `/users/${encodeUsername(username)}/role`,
		data: { role: toBackendRole(role), ...(currentPassword ? { current_password: currentPassword } : {}) },
	});
};

/** POST /users/{username}/reset-password（不能重設 admin 的密碼） */
export const resetMemberPassword = async (username: string, newPassword: string): Promise<void> =>
{
	await authorizedRequest({ method: 'POST', url: `/users/${encodeUsername(username)}/reset-password`, data: { new_password: newPassword } });
};

/** PATCH /users/{username}/active */
export const setMemberActive = async (username: string, isActive: boolean): Promise<void> =>
{
	await authorizedRequest({ method: 'PATCH', url: `/users/${encodeUsername(username)}/active`, data: { is_active: isActive } });
};

/** DELETE /users/{username} */
export const deleteMemberAccount = async (username: string): Promise<void> =>
{
	await authorizedRequest({ method: 'DELETE', url: `/users/${encodeUsername(username)}` });
};

/** 僅供單元測試：重設模組內狀態 */
export const __resetMemberApiStateForTest = (): void =>
{
	clearMemberSession();
	refreshInFlightPromise = null;
	sessionExpiredListener = null;
};

/** 僅供單元測試：取得 axios 實例以掛 mock adapter */
/** ★ 2026-10-29：免登入的請求（GET /settings：登入前讀閒置登出時間、檢查後端是否連得上） */
export const publicRequest = async <ResponseType>(requestConfig: AxiosRequestConfig): Promise<ResponseType> =>
{
	try { return (await memberHttpClient.request<ResponseType>(requestConfig)).data; }
	catch (requestErrorValue) { throw toMemberApiError(requestErrorValue); }
};

export const __memberHttpClientForTest = memberHttpClient;
