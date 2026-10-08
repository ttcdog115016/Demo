/**
 * ============================================================================
 * 檔案名稱 (File): useAccountStore.ts
 * 模組功能 (Description): 使用者帳號資料庫（前端 Demo 版）。
 *
 * 背景：「帳號與權限管理」原本只是畫面上的假資料，與登入完全無關。後端目前沒有
 * 使用者管理 API（POST /api/v1/auth/login 尚未完成），因此先在前端實作一份帳號
 * 資料庫，讓以下流程真的會動：
 *   - Admin 新增的帳號可以登入；停用的帳號不能登入
 *   - 密碼以 PBKDF2-SHA256（每個帳號獨立隨機鹽值）雜湊後保存，不存明碼
 *   - 連續登入失敗達上限（安全參數「密碼錯誤鎖定次數」）→ 鎖定 15 分鐘，Admin 可提前解除
 *   - Admin 重設密碼／新開帳號 → 使用者下次登入必須先變更密碼
 *   - 啟用「密碼過期輪替」時，超過有效天數也必須先變更密碼
 *   - 登入成功更新「最後登入時間」
 *
 * 限制：資料存在「這個瀏覽器」的 localStorage，換電腦／換瀏覽器就看不到；前端驗證
 * 也無法真正防止有心人繞過。正式版需改由後端驗證與保存，屆時替換本檔即可。
 * ============================================================================
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import CryptoJS from 'crypto-js';

export type AccountRole = 'admin' | 'data_owner';
export type AccountStatus = 'active' | 'disabled';

export interface AccountRecord
{
	id: string;                    // 帳號唯一識別碼
	name: string;                  // 顯示名稱
	email: string;                 // 登入帳號（不分大小寫）
	role: AccountRole;
	status: AccountStatus;         // 啟用／停用（鎖定另以 lockedUntil 判斷）
	passwordHash: string;          // PBKDF2-SHA256 雜湊 (hex)
	passwordSalt: string;          // 隨機鹽值 (hex)
	mustChangePassword: boolean;   // 下次登入須先變更密碼（新開帳號／管理員重設後）
	passwordChangedAt: number;     // 最後變更密碼時間 (epoch ms)
	failedLoginCount: number;      // 連續登入失敗次數
	lockedUntil: number | null;    // 鎖定到期時間 (epoch ms)；null 表示未鎖定
	lastLoginAt: number | null;    // 最後登入時間 (epoch ms)
	createdAt: number;
}

// 登入結果
export type AuthenticateResult =
	| { ok: true; account: AccountRecord; mustChangePassword: boolean }
	| { ok: false; reason: 'not_found' | 'wrong_password' | 'disabled' | 'locked'; remainingAttempts?: number; lockedUntil?: number };

export const ACCOUNT_STORAGE_KEY = 'privacy_accounts_v1';
export const ACCOUNT_LOCK_DURATION_MS = 15 * 60 * 1000;   // 鎖定 15 分鐘
const PBKDF2_ITERATIONS = 10000;
const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeEmail = (emailValue: string): string => emailValue.trim().toLowerCase();

const generateId = (): string =>
{
	try
	{
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	}
	catch
	{
		// 非 HTTPS 環境沒有 randomUUID，落入下方備援
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * 函數名稱: hashPassword
 * 函數功能: PBKDF2-SHA256 雜湊。用 CryptoJS（同步、非 HTTPS 也能用），不依賴 crypto.subtle。
 */
const hashPassword = (plainPassword: string, saltHex: string): string =>
	CryptoJS.PBKDF2(plainPassword, CryptoJS.enc.Hex.parse(saltHex), { keySize: 256 / 32, iterations: PBKDF2_ITERATIONS, hasher: CryptoJS.algo.SHA256 }).toString(CryptoJS.enc.Hex);

const createPasswordFields = (plainPassword: string): Pick<AccountRecord, 'passwordHash' | 'passwordSalt'> =>
{
	const saltHex = CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Hex);
	return { passwordSalt: saltHex, passwordHash: hashPassword(plainPassword, saltHex) };
};

/** 固定時間比對，避免以回應時間差猜測雜湊 */
const isSameHash = (leftHex: string, rightHex: string): boolean =>
{
	if (leftHex.length !== rightHex.length) return false;
	let differenceAccumulator = 0;
	for (let charIndex = 0; charIndex < leftHex.length; charIndex++) differenceAccumulator |= leftHex.charCodeAt(charIndex) ^ rightHex.charCodeAt(charIndex);
	return differenceAccumulator === 0;
};

export const isAccountLocked = (account: AccountRecord, nowMs: number = Date.now()): boolean =>
	account.lockedUntil !== null && account.lockedUntil > nowMs;

/** 預設帳號：沿用原本登入頁的 Demo 帳號 owner@test.com / password，避免既有 Demo 與 E2E 測試失效 */
const buildSeedAccounts = (): AccountRecord[] =>
{
	const nowMs = Date.now();
	const seed = (name: string, email: string, role: AccountRole, password: string, status: AccountStatus = 'active'): AccountRecord => ({
		id: generateId(), name, email, role, status, ...createPasswordFields(password),
		mustChangePassword: false, passwordChangedAt: nowMs, failedLoginCount: 0, lockedUntil: null, lastLoginAt: null, createdAt: nowMs,
	});
	return [
		seed('Admin.Test', 'admin@test.com', 'admin', 'Admin@123456'),
		seed('Data.Owner.A', 'owner@test.com', 'data_owner', 'password'),
		seed('Data.Owner.B', 'owner_b@test.com', 'data_owner', 'OwnerB@123456', 'disabled'),
	];
};

interface AccountState
{
	accounts: AccountRecord[];

	/** 登入驗證；maxFailedLogins 取自安全參數「密碼錯誤鎖定次數」 */
	authenticate: (email: string, password: string, maxFailedLogins: number, passwordExpiryDays: number | null) => AuthenticateResult;
	findByEmail: (email: string) => AccountRecord | undefined;
	/** 登入用：先比對 Email，再比對使用者名稱（不分大小寫；名稱須唯一才算數） */
	findByLoginId: (loginId: string) => AccountRecord | undefined;
	addAccount: (input: { name: string; email: string; role: AccountRole; password: string }) => { ok: true } | { ok: false; reason: 'duplicate_email' | 'duplicate_name' };
	updateAccount: (accountId: string, patch: { name: string; email: string; role: AccountRole }) => { ok: true } | { ok: false; reason: 'duplicate_email' | 'duplicate_name' };
	setAccountStatus: (accountId: string, status: AccountStatus) => void;
	unlockAccount: (accountId: string) => void;
	deleteAccount: (accountId: string) => void;
	/** 管理員重設密碼：舊密碼立即失效、解除鎖定、下次登入須變更密碼 */
	resetPassword: (accountId: string, newPassword: string) => void;
	/** 使用者自行變更密碼：須驗證目前密碼 */
	changeOwnPassword: (email: string, currentPassword: string, newPassword: string) => { ok: true } | { ok: false; reason: 'not_found' | 'wrong_password' | 'same_password' };
}

export const useAccountStore = create<AccountState>()(
	persist(
		(setStoreStateAction, getStoreStateAction) => ({
			accounts: [],

			findByEmail: (email) => getStoreStateAction().accounts.find(account => account.email === normalizeEmail(email)),

			findByLoginId: (loginId) =>
			{
				const normalizedLoginId = normalizeEmail(loginId);
				const accountsList = getStoreStateAction().accounts;
				const emailMatchedAccount = accountsList.find(account => account.email === normalizedLoginId);
				if (emailMatchedAccount) return emailMatchedAccount;
				const nameMatchedAccounts = accountsList.filter(account => account.name.trim().toLowerCase() === normalizedLoginId);
				return nameMatchedAccounts.length === 1 ? nameMatchedAccounts[0] : undefined;
			},

			authenticate: (email, password, maxFailedLogins, passwordExpiryDays) =>
			{
				const nowMs = Date.now();
				const targetAccount = getStoreStateAction().findByLoginId(email);
				if (!targetAccount) return { ok: false, reason: 'not_found' };
				if (targetAccount.status === 'disabled') return { ok: false, reason: 'disabled' };
				if (isAccountLocked(targetAccount, nowMs)) return { ok: false, reason: 'locked', lockedUntil: targetAccount.lockedUntil ?? undefined };

				const updateTarget = (patch: Partial<AccountRecord>): void =>
				{
					setStoreStateAction((currentState) => ({
						accounts: currentState.accounts.map(account => account.id === targetAccount.id ? { ...account, ...patch } : account),
					}));
				};

				if (!isSameHash(hashPassword(password, targetAccount.passwordSalt), targetAccount.passwordHash))
				{
					// 鎖定已過期的帳號，從 0 重新計算
					const previousFailedCount = targetAccount.lockedUntil !== null ? 0 : targetAccount.failedLoginCount;
					const nextFailedCount = previousFailedCount + 1;
					const safeMaxFailedLogins = Math.max(1, maxFailedLogins);
					if (nextFailedCount >= safeMaxFailedLogins)
					{
						const lockedUntilMs = nowMs + ACCOUNT_LOCK_DURATION_MS;
						updateTarget({ failedLoginCount: nextFailedCount, lockedUntil: lockedUntilMs });
						return { ok: false, reason: 'locked', lockedUntil: lockedUntilMs };
					}
					updateTarget({ failedLoginCount: nextFailedCount, lockedUntil: null });
					return { ok: false, reason: 'wrong_password', remainingAttempts: safeMaxFailedLogins - nextFailedCount };
				}

				const isPasswordExpired = passwordExpiryDays !== null && nowMs - targetAccount.passwordChangedAt > passwordExpiryDays * DAY_MS;
				const updatedAccount: AccountRecord = { ...targetAccount, failedLoginCount: 0, lockedUntil: null, lastLoginAt: nowMs };
				updateTarget({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: nowMs });
				return { ok: true, account: updatedAccount, mustChangePassword: targetAccount.mustChangePassword || isPasswordExpired };
			},

			addAccount: ({ name, email, role, password }) =>
			{
				const normalizedEmail = normalizeEmail(email);
				if (getStoreStateAction().accounts.some(account => account.email === normalizedEmail)) return { ok: false, reason: 'duplicate_email' };
				if (getStoreStateAction().accounts.some(account => account.name.trim().toLowerCase() === name.trim().toLowerCase())) return { ok: false, reason: 'duplicate_name' };
				const nowMs = Date.now();
				setStoreStateAction((currentState) => ({
					accounts: [...currentState.accounts, {
						id: generateId(), name: name.trim(), email: normalizedEmail, role, status: 'active', ...createPasswordFields(password),
						mustChangePassword: true, passwordChangedAt: nowMs, failedLoginCount: 0, lockedUntil: null, lastLoginAt: null, createdAt: nowMs,
					}],
				}));
				return { ok: true };
			},

			updateAccount: (accountId, { name, email, role }) =>
			{
				const normalizedEmail = normalizeEmail(email);
				if (getStoreStateAction().accounts.some(account => account.email === normalizedEmail && account.id !== accountId)) return { ok: false, reason: 'duplicate_email' };
				if (getStoreStateAction().accounts.some(account => account.name.trim().toLowerCase() === name.trim().toLowerCase() && account.id !== accountId)) return { ok: false, reason: 'duplicate_name' };
				setStoreStateAction((currentState) => ({
					accounts: currentState.accounts.map(account => account.id === accountId ? { ...account, name: name.trim(), email: normalizedEmail, role } : account),
				}));
				return { ok: true };
			},

			setAccountStatus: (accountId, status) => setStoreStateAction((currentState) => ({
				accounts: currentState.accounts.map(account => account.id === accountId ? { ...account, status } : account),
			})),

			unlockAccount: (accountId) => setStoreStateAction((currentState) => ({
				accounts: currentState.accounts.map(account => account.id === accountId ? { ...account, failedLoginCount: 0, lockedUntil: null } : account),
			})),

			deleteAccount: (accountId) => setStoreStateAction((currentState) => ({
				accounts: currentState.accounts.filter(account => account.id !== accountId),
			})),

			resetPassword: (accountId, newPassword) => setStoreStateAction((currentState) => ({
				accounts: currentState.accounts.map(account => account.id === accountId
					? { ...account, ...createPasswordFields(newPassword), mustChangePassword: true, passwordChangedAt: Date.now(), failedLoginCount: 0, lockedUntil: null }
					: account),
			})),

			changeOwnPassword: (email, currentPassword, newPassword) =>
			{
				const targetAccount = getStoreStateAction().findByEmail(email);
				if (!targetAccount) return { ok: false, reason: 'not_found' };
				if (!isSameHash(hashPassword(currentPassword, targetAccount.passwordSalt), targetAccount.passwordHash)) return { ok: false, reason: 'wrong_password' };
				if (isSameHash(hashPassword(newPassword, targetAccount.passwordSalt), targetAccount.passwordHash)) return { ok: false, reason: 'same_password' };
				setStoreStateAction((currentState) => ({
					accounts: currentState.accounts.map(account => account.id === targetAccount.id
						? { ...account, ...createPasswordFields(newPassword), mustChangePassword: false, passwordChangedAt: Date.now() }
						: account),
				}));
				return { ok: true };
			},
		}),
		{
			name: ACCOUNT_STORAGE_KEY,
			storage: createJSONStorage(() => localStorage),
			partialize: (state) => ({ accounts: state.accounts }),
		}
	)
);

/**
 * 函數名稱: ensureSeedAccounts
 * 函數功能: 第一次使用（localStorage 沒有帳號資料）時建立預設帳號。於 main.tsx 啟動時呼叫一次；
 *           不放在 store 初始值，避免每次載入都白算 PBKDF2。
 */
export const ensureSeedAccounts = (): void =>
{
	if (useAccountStore.getState().accounts.length === 0)
	{
		useAccountStore.setState({ accounts: buildSeedAccounts() });
	}
};

// 跨分頁同步（例如一個分頁停用帳號，另一個分頁的登入立即生效）
if (typeof window !== 'undefined')
{
	window.addEventListener('storage', (storageEventObj) =>
	{
		if (storageEventObj.key === ACCOUNT_STORAGE_KEY) void useAccountStore.persist.rehydrate();
	});
}
