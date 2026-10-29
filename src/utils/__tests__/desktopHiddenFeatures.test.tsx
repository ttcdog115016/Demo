// @vitest-environment jsdom
/**
 * ★ 2026-10-29：單機版（一台電腦一個人用）隱藏系統公告（設定分頁、首頁橫幅、鈴鐺）、系統維運日誌分頁。
 *   全站維護模式同日從兩個版本刪除。
 *   這些資料同日改存後端後，線上 Demo 版恢復顯示；系統管理大廳的統計改為全站數字，不再標示「本機統計」。
 */
import React from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../config/featureFlags', () => ({
    IS_DESKTOP_BUILD: true, SHOW_DEMO_ACCOUNTS: false, SHOW_ANNOUNCEMENTS: false, SHOW_SYSTEM_LOG_TAB: false,
}));
// 部分模組載入時就會呼叫 matchMedia，須在 import 之前設定
vi.hoisted(() => {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: () => ({ matches: false, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {} }),
    });
    class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
});
const stableTranslation = vi.hoisted(() => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : ((fallback as { defaultValue?: string } | undefined)?.defaultValue ?? key)),
    i18n: { language: 'zh-TW', changeLanguage: () => Promise.resolve() },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => stableTranslation }));
vi.mock('../../api/authApi', async () => {
    const actual = await vi.importActual<typeof import('../../api/authApi')>('../../api/authApi');
    return { ...actual, listMemberAccounts: vi.fn().mockResolvedValue([]) };
});

import SystemPreferences from '../../features/settings/SystemPreferences';
import { Dashboard } from '../../features/dashboard/Dashboard';
import AdminDashboard from '../../features/admin/AdminDashboard';
import { useAuthStore } from '../../store/useAuthStore';
import { useAnnouncementStore } from '../../store/useAnnouncementStore';

const renderAt = (element: React.ReactElement, path = '/') => render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>);

describe('單機版隱藏的功能', () => {
    beforeEach(() => {
        useAuthStore.setState({ isAuthenticated: true, user: { name: 'admin@test.com', email: 'admin@test.com', role: 'admin' } } as Partial<ReturnType<typeof useAuthStore.getState>>);
    });
    afterEach(() => cleanup());

    it('系統設定：沒有「系統維運日誌」「系統公告」分頁；網址指定被隱藏的分頁時改顯示第一個分頁', async () => {
        const { queryByText, getByText } = renderAt(<SystemPreferences />, '/settings/preferences?tab=syslogs');
        await waitFor(() => expect(getByText('帳號與權限管理')).toBeTruthy());
        expect(getByText('安全與環境參數')).toBeTruthy();
        expect(queryByText('系統維運日誌')).toBeNull();
        expect(queryByText('系統公告')).toBeNull();
        expect(document.querySelector('.ant-tabs-tab-active')?.textContent).toContain('帳號與權限管理');
    });

    it('安全與環境參數：保留閒置逾時登出，沒有維護模式', async () => {
        const { queryByText, getByText } = renderAt(<SystemPreferences />, '/settings/preferences?tab=security');
        await waitFor(() => expect(getByText('Session 閒置強制登出時間 (分鐘)')).toBeTruthy());
        expect(queryByText('系統維護模式')).toBeNull();
    });

    it('首頁不顯示重要公告橫幅', () => {
        useAuthStore.setState({ user: { name: 'owner@test.com', email: 'owner@test.com', role: 'data_owner' } } as Partial<ReturnType<typeof useAuthStore.getState>>);
        useAnnouncementStore.setState({
            announcements: [{ id: 'a1', title: '測試重要公告', content: '內容', level: 'important', audience: 'all', createdAt: Date.now(), createdBy: 'admin' }],
            dismissedBannerIdsByUser: {},
        } as Partial<ReturnType<typeof useAnnouncementStore.getState>>);
        const { queryByText } = renderAt(<Dashboard />);
        expect(queryByText('測試重要公告')).toBeNull();
    });

    it('系統管理大廳：統計來自後端（不標示本機統計），說明不提維運日誌', async () => {
        const { queryAllByTestId, getByText, queryByText } = renderAt(<AdminDashboard />);
        expect(queryAllByTestId('admin-local-stat-tag')).toHaveLength(0);
        expect(getByText('※ 帳號數、登入與 API 次數皆來自後端（過去 24 小時，含所有電腦）；後端連線狀態每 60 秒自動檢查一次。')).toBeTruthy();
        expect(getByText('集中管理使用者帳號，並設定閒置逾時登出時間。')).toBeTruthy();
        expect(queryByText(/維運日誌/)).toBeNull();
    });
});

describe('一般 Demo 建置（非單機版）', () => {
    it('公告、維運日誌分頁照常顯示（資料存後端）', async () => {
        const actualFlags = await vi.importActual<typeof import('../../config/featureFlags')>('../../config/featureFlags');
        expect(actualFlags.IS_DESKTOP_BUILD).toBe(false);
        expect([actualFlags.SHOW_ANNOUNCEMENTS, actualFlags.SHOW_SYSTEM_LOG_TAB]).toEqual([true, true]);
    });
});
