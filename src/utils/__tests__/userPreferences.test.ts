// @vitest-environment jsdom
/**
 * ★ 2026-10-29：介面偏好（外觀主題、語系、字體大小）依帳號存後端：登入套用、修改寫後端、登出回預設，
 *   使用者手動選過主題後作業系統深淺色切換不再覆蓋。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { saveUserPreferencesMock, hasAccessTokenMock } = vi.hoisted(() => ({ saveUserPreferencesMock: vi.fn(), hasAccessTokenMock: vi.fn() }));
vi.hoisted(() => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) });
});
vi.mock('../../api/systemApi', () => ({ saveUserPreferences: saveUserPreferencesMock }));
vi.mock('../../api/authApi', () => ({ hasAccessToken: hasAccessTokenMock }));

import { useUIStore } from '../../store/useUIStore';

describe('介面偏好依帳號記住', () => {
    beforeEach(() => {
        useUIStore.getState().resetToDefaults();
        saveUserPreferencesMock.mockReset().mockResolvedValue({});
        hasAccessTokenMock.mockReset().mockReturnValue(true);
    });

    it('登入後套用後端存的偏好；沒存過的欄位用預設', () => {
        useUIStore.getState().applyUserPreferences({ theme: 'dark', language: 'en_US' });
        const uiState = useUIStore.getState();
        expect([uiState.isDarkMode, uiState.hasExplicitTheme, uiState.language, uiState.fontSizeLevel]).toEqual([true, true, 'en_US', 'medium']);
    });

    it('登入中修改會寫後端；存不進去回傳 false 但畫面照常切換', async () => {
        expect(await useUIStore.getState().setFontSizeLevel('large')).toBe(true);
        expect(saveUserPreferencesMock).toHaveBeenCalledWith({ font_size: 'large' });
        saveUserPreferencesMock.mockRejectedValueOnce(new Error('offline'));
        expect(await useUIStore.getState().setIsDarkMode(true)).toBe(false);
        expect(useUIStore.getState().isDarkMode).toBe(true);
    });

    it('未登入時不寫後端', async () => {
        hasAccessTokenMock.mockReturnValue(false);
        await useUIStore.getState().setLanguage('en_US');
        expect(saveUserPreferencesMock).not.toHaveBeenCalled();
    });

    it('手動選過主題後，作業系統切換不覆蓋；登出回預設後又會跟隨', () => {
        void useUIStore.getState().setIsDarkMode(false);
        useUIStore.getState().followSystemTheme(true);
        expect(useUIStore.getState().isDarkMode).toBe(false);
        useUIStore.getState().resetToDefaults();
        useUIStore.getState().followSystemTheme(true);
        expect(useUIStore.getState().isDarkMode).toBe(true);
        expect(useUIStore.getState().language).toBe('zh_TW');
    });
});
