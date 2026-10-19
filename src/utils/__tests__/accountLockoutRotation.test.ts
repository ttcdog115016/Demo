// @vitest-environment jsdom
/**
 * 前端 Demo 帳號資料庫：登入失敗鎖定（同步後端：180 秒內 5 次 → 鎖 15 分鐘）、
 * 移除首次登入須變更密碼、密碼過期輪替
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAccountStore, LOGIN_FAILURE_WINDOW_MS, ACCOUNT_LOCK_DURATION_MS, MAX_FAILED_LOGINS } from '../../store/useAccountStore';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 16, 0, 0, 0);

beforeEach(() =>
{
	vi.useFakeTimers();
	vi.setSystemTime(T0);
	useAccountStore.setState({ accounts: [] });
	useAccountStore.getState().addAccount({ name: 'amy', email: 'amy@test.com', role: 'data_owner', password: 'Amy@Password123' });
});
afterEach(() => { vi.useRealTimers(); });

const tryLogin = (password: string, expiryDays: number | null = null) => useAccountStore.getState().authenticate('amy@test.com', password, expiryDays);

describe('登入失敗鎖定（固定規則）', () =>
{
	it('規則常數與後端一致', () =>
	{
		expect(LOGIN_FAILURE_WINDOW_MS).toBe(180_000);
		expect(MAX_FAILED_LOGINS).toBe(5);
		expect(ACCOUNT_LOCK_DURATION_MS).toBe(900_000);
	});

	it('180 秒內第 5 次失敗即鎖定；鎖定中密碼正確也不放行；15 分鐘後解除', () =>
	{
		for (let attemptIndex = 1; attemptIndex <= 4; attemptIndex++)
		{
			expect(tryLogin('bad')).toMatchObject({ ok: false, reason: 'wrong_password', remainingAttempts: 5 - attemptIndex });
			vi.advanceTimersByTime(30_000);
		}
		expect(tryLogin('bad')).toMatchObject({ ok: false, reason: 'locked' });
		expect(tryLogin('Amy@Password123')).toMatchObject({ ok: false, reason: 'locked' });
		vi.advanceTimersByTime(ACCOUNT_LOCK_DURATION_MS + 1);
		expect(tryLogin('Amy@Password123')).toMatchObject({ ok: true });
	});

	it('自第一次失敗起逾 180 秒未達 5 次 → 重新計數', () =>
	{
		for (let attemptIndex = 0; attemptIndex < 4; attemptIndex++) tryLogin('bad');
		vi.advanceTimersByTime(LOGIN_FAILURE_WINDOW_MS + 1);
		expect(tryLogin('bad')).toMatchObject({ reason: 'wrong_password', remainingAttempts: 4 });
	});

	it('管理員重設密碼清除鎖定', () =>
	{
		for (let attemptIndex = 0; attemptIndex < 5; attemptIndex++) tryLogin('bad');
		const accountId = useAccountStore.getState().findByEmail('amy@test.com')!.id;
		useAccountStore.getState().resetPassword(accountId, 'New@Password456');
		expect(tryLogin('New@Password456')).toMatchObject({ ok: true });
	});
});

describe('首次登入不再強制變更密碼；密碼過期輪替', () =>
{
	it('新帳號、管理員重設後登入都不須變更密碼', () =>
	{
		expect(tryLogin('Amy@Password123', 90)).toMatchObject({ ok: true, isPasswordExpired: false });
		const accountId = useAccountStore.getState().findByEmail('amy@test.com')!.id;
		useAccountStore.getState().resetPassword(accountId, 'New@Password456');
		expect(tryLogin('New@Password456', 90)).toMatchObject({ ok: true, isPasswordExpired: false });
	});

	it('超過有效天數 → 須先變更；停用輪替（null）則不檢查；變更後重新起算', () =>
	{
		vi.advanceTimersByTime(91 * DAY_MS);
		expect(tryLogin('Amy@Password123', 90)).toMatchObject({ ok: true, isPasswordExpired: true });
		expect(tryLogin('Amy@Password123', null)).toMatchObject({ ok: true, isPasswordExpired: false });
		expect(useAccountStore.getState().changeOwnPassword('amy@test.com', 'Amy@Password123', 'Fresh@Password789')).toEqual({ ok: true });
		expect(tryLogin('Fresh@Password789', 90)).toMatchObject({ ok: true, isPasswordExpired: false });
	});
});
