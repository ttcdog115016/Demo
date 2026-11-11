/**
 * ============================================================================
 * 檔案名稱 (File): serverHashPreview.ts
 * 模組功能 (Description): 「伺服器預設鹽值」雜湊預覽的取值與快取。
 * ============================================================================
 * ★ 2026-11-04：伺服器鹽值（.env OPEN_PETS_DEFAULT_SALT）不會傳到瀏覽器，前端算不出實際結果；
 *   改由後端 POST /api/v1/preprocess/hash-preview 以同一把鹽計算少量預覽值（只回雜湊值，不回鹽值）。
 *   預覽函式（preprocessSteps.ts）是同步的：查不到時先回「計算中」並排入請求，結果回來後更新 store，
 *   訂閱 version 的元件即重新繪製。後端是舊版或呼叫失敗時，改回原本的說明文字。
 */
import { create } from 'zustand';
import { authorizedRequest } from '../api/authApi';
import { registerWorkspaceReleaseHook } from '../store/useWorkspaceStore';

const REQUEST_DEBOUNCE_MS = 300;
const MAX_VALUES_PER_REQUEST = 20;   // 與後端 HASH_PREVIEW_MAX_VALUES 一致
const MAX_VALUE_LENGTH = 256;        // 與後端 HASH_PREVIEW_MAX_LENGTH 一致

export const SERVER_HASH_PREVIEW_FAILED = Symbol('server-hash-preview-failed');
type ServerHashEntry = string | typeof SERVER_HASH_PREVIEW_FAILED;

interface ServerHashPreviewState
{
	entries: Record<string, ServerHashEntry>;
	version: number;   // 每次有結果寫入就 +1，供元件訂閱重繪
}

export const useServerHashPreviewStore = create<ServerHashPreviewState>(() => ({ entries: {}, version: 0 }));

const toCacheKey = (algorithm: string, value: string): string => `${algorithm}\u0000${value}`;

const pendingValuesByAlgorithm = new Map<string, Set<string>>();
const inFlightKeys = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let cacheGeneration = 0;   // 清除快取後，之前送出的請求回來時不再寫入

const storeEntries = (newEntries: Record<string, ServerHashEntry>): void =>
	useServerHashPreviewStore.setState((state) => ({ entries: { ...state.entries, ...newEntries }, version: state.version + 1 }));

const fetchBatch = async (algorithm: string, values: string[]): Promise<void> =>
{
	const requestGeneration = cacheGeneration;
	try
	{
		const response = await authorizedRequest<{ hashes: string[] }>({ method: 'POST', url: '/preprocess/hash-preview', data: { values, algorithm } });
		const hashes = Array.isArray(response?.hashes) ? response.hashes : [];
		if (requestGeneration !== cacheGeneration) return;
		storeEntries(Object.fromEntries(values.map((value, index) => [toCacheKey(algorithm, value), typeof hashes[index] === 'string' ? hashes[index] : SERVER_HASH_PREVIEW_FAILED])));
	}
	catch
	{
		if (requestGeneration !== cacheGeneration) return;
		storeEntries(Object.fromEntries(values.map((value) => [toCacheKey(algorithm, value), SERVER_HASH_PREVIEW_FAILED])));
	}
	finally
	{
		if (requestGeneration === cacheGeneration) values.forEach((value) => inFlightKeys.delete(toCacheKey(algorithm, value)));
	}
};

const flushPendingRequests = (): void =>
{
	flushTimer = null;
	pendingValuesByAlgorithm.forEach((valueSet, algorithm) =>
	{
		const values = Array.from(valueSet);
		for (let start = 0; start < values.length; start += MAX_VALUES_PER_REQUEST)
			void fetchBatch(algorithm, values.slice(start, start + MAX_VALUES_PER_REQUEST));
	});
	pendingValuesByAlgorithm.clear();
};

/**
 * 函數名稱: getServerHashPreview
 * 函數功能: 取伺服器鹽值的雜湊預覽。已有結果回傳雜湊字串；失敗回傳 SERVER_HASH_PREVIEW_FAILED；
 *           尚無結果回傳 undefined，並排入（防抖後的）批次請求。
 */
export const getServerHashPreview = (value: string, algorithm: string): ServerHashEntry | undefined =>
{
	if (value.length > MAX_VALUE_LENGTH) return SERVER_HASH_PREVIEW_FAILED;
	const cacheKey = toCacheKey(algorithm, value);
	const cachedEntry = useServerHashPreviewStore.getState().entries[cacheKey];
	if (cachedEntry !== undefined) return cachedEntry;
	if (!inFlightKeys.has(cacheKey))
	{
		inFlightKeys.add(cacheKey);
		if (!pendingValuesByAlgorithm.has(algorithm)) pendingValuesByAlgorithm.set(algorithm, new Set());
		pendingValuesByAlgorithm.get(algorithm)!.add(value);
		if (flushTimer === null) flushTimer = setTimeout(flushPendingRequests, REQUEST_DEBOUNCE_MS);
	}
	return undefined;
};

/**
 * 登出或換帳號時清掉快取（伺服器鹽值可能不同）。
 * ★ 2026-11-06：快取的鍵是原始欄位值，重新開始／重新上傳時也一併清除（含尚未送出與進行中的請求）。
 */
export const clearServerHashPreviewCache = (): void =>
{
	cacheGeneration += 1;
	if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
	pendingValuesByAlgorithm.clear();
	inFlightKeys.clear();
	useServerHashPreviewStore.setState((state) => ({ entries: {}, version: state.version + 1 }));
};

registerWorkspaceReleaseHook(clearServerHashPreviewCache);
