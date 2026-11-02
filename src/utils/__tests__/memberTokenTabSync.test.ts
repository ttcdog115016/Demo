// @vitest-environment jsdom
/**
 * ★ 2026-11-02（F8）：複製分頁共用同一張 refresh token。後端換發後舊 token 作廢、再出現即撤銷整個帳號的登入，
 *   兩個分頁各自換發就會一起被登出。改為：換發後以 BroadcastChannel 通知持有同一張舊 token 的分頁改用新 token；
 *   瀏覽器支援 Web Locks 時，各分頁的換發依序進行，排到時發現 token 已被別的分頁換過就不再送出。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import {
	__memberHttpClientForTest, __resetMemberApiStateForTest, memberLogin, refreshTokensOnce, getAccessToken,
	AUTH_TAB_SYNC_CHANNEL_NAME, REFRESH_TOKEN_STORAGE_KEY,
} from '../../api/authApi';

const toBase64Url = (jsonText: string): string =>
	btoa(Array.from(new TextEncoder().encode(jsonText), (byteValue) => String.fromCharCode(byteValue)).join('')).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const makeJwt = (payloadObj: Record<string, unknown>): string => `h.${toBase64Url(JSON.stringify(payloadObj))}.s`;

const refreshRequests: string[] = [];
const installFakeBackend = (): void =>
{
	let rotation = 0;
	__memberHttpClientForTest.defaults.adapter = async (config) =>
	{
		const bodyValue = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
		let status = 200;
		let data: unknown;
		if (config.url === '/auth/login') data = { access_token: makeJwt({ sub: 'u', role: 'user' }), refresh_token: 'r1', username: 'u', role: 'user' };
		else if (config.url === '/auth/refresh')
		{
			refreshRequests.push(bodyValue.refresh_token);
			rotation += 1;
			data = { access_token: makeJwt({ sub: 'u', role: 'user', n: rotation }), refresh_token: `r${rotation + 1}` };
		}
		else status = 404;
		const responseObj: AxiosResponse = { status, statusText: String(status), data, headers: new AxiosHeaders(), config };
		if (status >= 200 && status < 300) return responseObj;
		throw new AxiosError(`HTTP ${status}`, 'ERR_BAD_RESPONSE', config, null, responseObj);
	};
};

/** 另一個分頁：同名頻道的另一個實例 */
let otherTab: BroadcastChannel;
const nextMessage = (): Promise<Record<string, unknown>> =>
	new Promise((resolve) => { otherTab.onmessage = (event) => resolve(event.data); });
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(async () =>
{
	__resetMemberApiStateForTest();
	window.sessionStorage.clear();
	refreshRequests.length = 0;
	otherTab = new BroadcastChannel(AUTH_TAB_SYNC_CHANNEL_NAME);
	installFakeBackend();
	await memberLogin('u', 'pw');
});
afterEach(() =>
{
	otherTab.close();
	vi.unstubAllGlobals();
});

describe('複製分頁共用 refresh token（★ 2026-11-02 F8）', () =>
{
	it('換發成功後通知其他分頁：舊 token → 新 token', async () =>
	{
		const messagePromise = nextMessage();
		await refreshTokensOnce();
		const message = await messagePromise;
		expect(message).toMatchObject({ type: 'token-rotated', previousRefreshToken: 'r1', refreshToken: 'r2' });
		expect(typeof message.accessToken).toBe('string');
	});

	it('別的分頁換掉了同一張 token：本分頁改用新的，之後換發用新 token、不用已作廢的舊 token', async () =>
	{
		otherTab.postMessage({ type: 'token-rotated', previousRefreshToken: 'r1', refreshToken: 'r-from-other-tab', accessToken: 'access-from-other-tab' });
		await flush();
		expect(window.sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('r-from-other-tab');
		expect(getAccessToken()).toBe('access-from-other-tab');
		await refreshTokensOnce();
		expect(refreshRequests).toEqual(['r-from-other-tab']);
	});

	it('別的分頁是另一次登入（舊 token 不同）：不採用', async () =>
	{
		otherTab.postMessage({ type: 'token-rotated', previousRefreshToken: 'someone-else', refreshToken: 'r-x', accessToken: 'a-x' });
		await flush();
		expect(window.sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('r1');
		expect(getAccessToken()).not.toBe('a-x');
	});

	it('支援 Web Locks 時：排到換發時 token 已被別的分頁換過，就不再送出換發請求', async () =>
	{
		let releaseLock: () => void = () => {};
		const lockGate = new Promise<void>((resolve) => { releaseLock = resolve; });
		vi.stubGlobal('navigator', {
			...navigator,
			locks: { request: async (_name: string, callback: () => Promise<unknown>) => { await lockGate; return callback(); } },
		});
		const refreshPromise = refreshTokensOnce();
		// 等待鎖期間，另一個分頁完成換發並通知
		otherTab.postMessage({ type: 'token-rotated', previousRefreshToken: 'r1', refreshToken: 'r-from-other-tab', accessToken: 'access-from-other-tab' });
		await flush();
		releaseLock();
		await refreshPromise;
		expect(refreshRequests).toEqual([]);
		expect(getAccessToken()).toBe('access-from-other-tab');
	});
});
