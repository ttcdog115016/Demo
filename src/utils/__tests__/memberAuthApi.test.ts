// @vitest-environment jsdom
/**
 * 後端會員系統串接（api/authApi.ts）：token 保存、401 自動換發、錯誤碼解析、帳號清單格式轉換
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import {
	__memberHttpClientForTest, __resetMemberApiStateForTest, setSessionExpiredListener,
	memberLogin, memberLogout, restoreMemberSession, listMemberAccounts, changeOwnPassword, createMemberAccount,
	normalizeMemberAccount, parseBackendTimestamp, toFrontendRole, toBackendRole, decodeJwtPayload,
	REFRESH_TOKEN_STORAGE_KEY, type MemberApiError,
} from '../../api/authApi';

type FakeRoute = (config: InternalAxiosRequestConfig) => { status: number; data?: unknown; headers?: Record<string, string> };

const toBase64Url = (jsonText: string): string =>
	btoa(Array.from(new TextEncoder().encode(jsonText), (byteValue) => String.fromCharCode(byteValue)).join('')).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const makeJwt = (payloadObj: Record<string, unknown>): string => `h.${toBase64Url(JSON.stringify(payloadObj))}.s`;

const requestLog: { method: string; url: string; data: unknown; auth: string | undefined }[] = [];

const installFakeBackend = (routeFn: FakeRoute): void =>
{
	__memberHttpClientForTest.defaults.adapter = async (config) =>
	{
		const bodyValue = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
		requestLog.push({ method: (config.method || 'get').toUpperCase(), url: config.url || '', data: bodyValue, auth: config.headers?.Authorization as string | undefined });
		const { status, data, headers } = routeFn({ ...config, data: bodyValue });
		const responseObj: AxiosResponse = { status, statusText: String(status), data, headers: new AxiosHeaders(headers ?? {}), config };
		if (status >= 200 && status < 300) return responseObj;
		throw new AxiosError(`HTTP ${status}`, 'ERR_BAD_RESPONSE', config, null, responseObj);
	};
};

beforeEach(() =>
{
	__resetMemberApiStateForTest();
	window.sessionStorage.clear();
	requestLog.length = 0;
});

describe('角色與格式轉換', () =>
{
	it('後端 user ↔ 前端 data_owner', () =>
	{
		expect(toFrontendRole('user')).toBe('data_owner');
		expect(toFrontendRole('admin')).toBe('admin');
		expect(toBackendRole('data_owner')).toBe('user');
	});

	it('時間欄位：ISO（無時區視為 UTC）、epoch 秒、epoch 毫秒', () =>
	{
		expect(parseBackendTimestamp('2026-10-16T00:00:00')).toBe(Date.UTC(2026, 9, 16));
		expect(parseBackendTimestamp('2026-10-16 00:00:00')).toBe(Date.UTC(2026, 9, 16));
		expect(parseBackendTimestamp(1_790_000_000)).toBe(1_790_000_000_000);
		expect(parseBackendTimestamp(1_790_000_000_000)).toBe(1_790_000_000_000);
		expect(parseBackendTimestamp(null)).toBeNull();
	});

	it('帳號清單轉成前端格式（is_active 可為 0／1）', () =>
	{
		expect(normalizeMemberAccount({ username: 'amy', role: 'user', is_active: 0, failed_login_count: 2, login_locked_until: null, created_at: '2026-10-01T08:00:00Z' }))
			.toEqual({ username: 'amy', role: 'data_owner', isActive: false, failedLoginCount: 2, lockedUntil: null, createdAt: Date.UTC(2026, 9, 1, 8) });
		expect(normalizeMemberAccount({ role: 'admin' })).toBeNull();
	});

	it('JWT payload 解碼', () =>
	{
		expect(decodeJwtPayload(makeJwt({ sub: '王小明', role: 'admin' }))).toEqual({ sub: '王小明', role: 'admin' });
		expect(decodeJwtPayload('not-a-jwt')).toBeNull();
	});
});

describe('登入', () =>
{
	it('成功：refresh token 存 sessionStorage，角色取自 JWT', async () =>
	{
		installFakeBackend((config) => config.url === '/auth/login'
			? { status: 200, data: { access_token: makeJwt({ sub: 'admin1', role: 'admin' }), refresh_token: 'r1' } }
			: { status: 404 });
		const sessionObj = await memberLogin('admin1', 'pw');
		expect(sessionObj).toEqual({ username: 'admin1', role: 'admin' });
		expect(window.sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('r1');
		expect(requestLog[0].data).toEqual({ username: 'admin1', password: 'pw' });
	});

	it('JWT 沒有 role 時以 GET /users 探測：403 → User', async () =>
	{
		installFakeBackend((config) => config.url === '/auth/login'
			? { status: 200, data: { access_token: makeJwt({ sub: 'amy' }), refresh_token: 'r1' } }
			: { status: 403, data: { error_code: 'ERR_FORBIDDEN', message: '權限不足' } });
		expect(await memberLogin('amy', 'pw')).toEqual({ username: 'amy', role: 'data_owner' });
	});

	it('423 鎖定：帶出 Retry-After 秒數', async () =>
	{
		installFakeBackend(() => ({ status: 423, data: { error_code: 'ERR_ACCOUNT_LOCKED', message: '帳號鎖定中' }, headers: { 'retry-after': '600' } }));
		const errorObj = await memberLogin('amy', 'x').catch((caughtError: MemberApiError) => caughtError);
		expect(errorObj).toMatchObject({ status: 423, errorCode: 'ERR_ACCOUNT_LOCKED', retryAfterSeconds: 600, message: '帳號鎖定中' });
	});

	it('503 會員系統未啟用', async () =>
	{
		installFakeBackend(() => ({ status: 503, data: { error_code: 'ERR_AUTH_DISABLED', message: '會員系統未啟用' } }));
		await expect(memberLogin('a', 'b')).rejects.toMatchObject({ status: 503, errorCode: 'ERR_AUTH_DISABLED' });
	});
});

describe('access token 過期自動換發', () =>
{
	it('401 → POST /auth/refresh → 帶新 token 重送；refresh token 輪替', async () =>
	{
		let refreshCount = 0;
		installFakeBackend((config) =>
		{
			if (config.url === '/auth/login') return { status: 200, data: { access_token: makeJwt({ sub: 'adm', role: 'admin', v: 1 }), refresh_token: 'r1' } };
			if (config.url === '/auth/refresh')
			{
				refreshCount++;
				expect(config.data).toEqual({ refresh_token: 'r1' });
				return { status: 200, data: { access_token: makeJwt({ sub: 'adm', role: 'admin', v: 2 }), refresh_token: 'r2' } };
			}
			const isNewToken = String(config.headers?.Authorization) === `Bearer ${makeJwt({ sub: 'adm', role: 'admin', v: 2 })}`;
			return isNewToken ? { status: 200, data: { users: [{ username: 'adm', role: 'admin', is_active: true }] } } : { status: 401, data: { error_code: 'ERR_UNAUTHORIZED' } };
		});
		await memberLogin('adm', 'pw');
		const accountList = await listMemberAccounts();
		expect(refreshCount).toBe(1);
		expect(accountList.map(accountItem => accountItem.username)).toEqual(['adm']);
		expect(window.sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('r2');
	});

	it('refresh 被拒（401）→ 清除 Session 並通知登出', async () =>
	{
		const expiredListener = vi.fn();
		setSessionExpiredListener(expiredListener);
		installFakeBackend((config) =>
		{
			if (config.url === '/auth/login') return { status: 200, data: { access_token: makeJwt({ sub: 'u', role: 'user' }), refresh_token: 'r1' } };
			return { status: 401, data: { error_code: 'ERR_UNAUTHORIZED' } };
		});
		await memberLogin('u', 'pw');
		await expect(createMemberAccount('x', 'y', 'data_owner')).rejects.toMatchObject({ status: 401 });
		expect(expiredListener).toHaveBeenCalledTimes(1);
		expect(window.sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
	});

	it('變更密碼回 401（舊密碼錯誤）不觸發換發', async () =>
	{
		installFakeBackend((config) => config.url === '/auth/login'
			? { status: 200, data: { access_token: makeJwt({ sub: 'u', role: 'user' }), refresh_token: 'r1' } }
			: { status: 401, data: { error_code: 'ERR_UNAUTHORIZED', message: '舊密碼錯誤' } });
		await memberLogin('u', 'pw');
		await expect(changeOwnPassword('wrong', 'New@Password123')).rejects.toMatchObject({ status: 401 });
		expect(requestLog.some(logItem => logItem.url === '/auth/refresh')).toBe(false);
		expect(requestLog.at(-1)?.data).toEqual({ old_password: 'wrong', new_password: 'New@Password123' });
	});
});

describe('重新整理接續登入與登出', () =>
{
	it('以 sessionStorage 的 refresh token 接續', async () =>
	{
		window.sessionStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'saved');
		installFakeBackend((config) => config.url === '/auth/refresh'
			? { status: 200, data: { access_token: makeJwt({ sub: 'amy', role: 'user' }), refresh_token: 'r9' } }
			: { status: 404 });
		expect(await restoreMemberSession()).toEqual({ username: 'amy', role: 'data_owner' });
	});

	it('沒有 refresh token 時不呼叫後端', async () =>
	{
		installFakeBackend(() => ({ status: 500 }));
		expect(await restoreMemberSession()).toBeNull();
		expect(requestLog).toHaveLength(0);
	});

	it('登出：作廢 refresh token 並清除本機', async () =>
	{
		window.sessionStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'r5');
		installFakeBackend(() => ({ status: 200, data: {} }));
		await memberLogout();
		expect(requestLog[0]).toMatchObject({ method: 'POST', url: '/auth/logout', data: { refresh_token: 'r5' } });
		expect(window.sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
	});
});
