/**
 * 本地／線上／內網模式的旗標合併：執行期設定（Docker 單一映像檔）優先，沒有就退回建置旗標（exe、nginx 版 Demo 站）。
 */
import { describe, it, expect } from 'vitest';
import { resolveFlags } from '../featureFlags';

describe('resolveFlags：沒有執行期設定時，與加入執行期設定之前的行為相同', () => {
    it('單機版建置（desktop）：離線，不顯示 Demo 帳號與維運日誌', () => {
        expect(resolveFlags({}, 'desktop')).toEqual({ isOfflineMode: true, showDemoAccounts: false, showSystemLogTab: false });
    });
    it('一般建置（nginx 版 Demo 站）：線上，顯示 Demo 帳號與維運日誌', () => {
        expect(resolveFlags({}, undefined)).toEqual({ isOfflineMode: false, showDemoAccounts: true, showSystemLogTab: true });
    });
});

describe('resolveFlags：Docker 單一映像檔（建置時帶 desktop，由執行期設定決定模式）', () => {
    it('offline：不顯示維運日誌與 Demo 帳號', () => {
        expect(resolveFlags({ mode: 'offline', showDemoAccounts: false }, 'desktop'))
            .toEqual({ isOfflineMode: true, showDemoAccounts: false, showSystemLogTab: false });
    });
    it('local：與 offline 相同（不顯示維運日誌與 Demo 帳號）', () => {
        expect(resolveFlags({ mode: 'local' }, 'desktop'))
            .toEqual({ isOfflineMode: true, showDemoAccounts: false, showSystemLogTab: false });
    });
    it('lan（內網）：與 online 相同，顯示維運日誌，Demo 帳號預設不顯示', () => {
        expect(resolveFlags({ mode: 'lan' }, 'desktop'))
            .toEqual({ isOfflineMode: false, showDemoAccounts: false, showSystemLogTab: true });
    });
    it('local 在一般建置也成立（執行期設定蓋過建置旗標）', () => {
        expect(resolveFlags({ mode: 'local' }, undefined))
            .toEqual({ isOfflineMode: true, showDemoAccounts: false, showSystemLogTab: false });
    });
    it('online：顯示維運日誌，Demo 帳號仍預設不顯示', () => {
        expect(resolveFlags({ mode: 'online' }, 'desktop'))
            .toEqual({ isOfflineMode: false, showDemoAccounts: false, showSystemLogTab: true });
    });
    it('online 且明確開啟 Demo 帳號（只有我們自己的 Demo 站會這樣設）', () => {
        expect(resolveFlags({ mode: 'online', showDemoAccounts: true }, 'desktop'))
            .toEqual({ isOfflineMode: false, showDemoAccounts: true, showSystemLogTab: true });
    });
    it('執行期設定蓋過建置旗標：一般建置也能被設成 offline', () => {
        expect(resolveFlags({ mode: 'offline' }, undefined))
            .toEqual({ isOfflineMode: true, showDemoAccounts: false, showSystemLogTab: false });
    });
});
