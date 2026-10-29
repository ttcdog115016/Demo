/**
 * ★ 2026-10-29：不論怎麼登出（手動、閒置逾時、登入逾期），工作區（含已上傳的檔案）都要釋放。
 *   原本只有手動登出會清，閒置逾時被登出後再登入，Step1 仍看得到先前的檔案。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/authApi', async () => {
    const actual = await vi.importActual<typeof import('../../api/authApi')>('../../api/authApi');
    return { ...actual, memberLogout: vi.fn().mockResolvedValue(undefined), clearMemberSession: vi.fn() };
});
vi.mock('../../api/systemApi', () => ({ postSystemLogs: vi.fn().mockResolvedValue({}), fetchHistory: vi.fn().mockResolvedValue([]) }));

import { useAuthStore, type LogoutReason } from '../../store/useAuthStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { useAuditStore } from '../../store/useAuditStore';
import { useSystemLogStore } from '../../store/useSystemLogStore';

const signInWithWork = (): void => {
    useAuthStore.setState({ isAuthenticated: true, user: { name: 'owner@test.com', email: 'owner@test.com', role: 'data_owner' } } as Partial<ReturnType<typeof useAuthStore.getState>>);
    useWorkspaceStore.setState({
        dataFile: new File(['a,b\n1,2\n'], 'secret.csv'), fileName: 'secret.csv', columns: ['a', 'b'], currentStep: 2, kValue: 9,
        sessionTimeout: 5,
    } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
    useAuditStore.setState({ auditLogs: [{ id: 'x' } as never] });
    useSystemLogStore.setState({ logs: [{ id: '1', timestamp: 1, level: 'INFO', event: 'e', source: 's' }] });
};

describe('登出時釋放工作區', () => {
    beforeEach(() => useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true));

    it.each<LogoutReason>(['manual', 'idle', 'expired'])('%s 登出：檔案、欄位、設定還原，紀錄與日誌畫面清空', (logoutReason) => {
        signInWithWork();
        useAuthStore.getState().logout(logoutReason);

        const workspaceState = useWorkspaceStore.getState();
        const initialState = useWorkspaceStore.getInitialState();
        expect(workspaceState.dataFile).toBeNull();
        expect(workspaceState.fileName).toBe(initialState.fileName);
        expect(workspaceState.columns).toEqual([]);
        expect(workspaceState.currentStep).toBe(initialState.currentStep);
        expect(workspaceState.kValue).toBe(initialState.kValue);
        // 後端同步來的閒置登出時間保留
        expect((workspaceState as unknown as { sessionTimeout?: number }).sessionTimeout).toBe(5);
        expect(useAuditStore.getState().auditLogs).toEqual([]);
        expect(useSystemLogStore.getState().logs).toEqual([]);
    });
});
