/**
 * resolveRuntimeMode：從執行期設定取出「目前是哪一種模式」（給管理員的「系統模式」分頁顯示用）。
 */
import { describe, it, expect } from 'vitest';
import { resolveRuntimeMode } from '../featureFlags';

describe('resolveRuntimeMode', () => {
    it('local、lan、online 原樣回傳', () => {
        expect(resolveRuntimeMode({ mode: 'local' })).toBe('local');
        expect(resolveRuntimeMode({ mode: 'lan' })).toBe('lan');
        expect(resolveRuntimeMode({ mode: 'online' })).toBe('online');
    });
    it('舊名稱 offline 視為 local', () => {
        expect(resolveRuntimeMode({ mode: 'offline' })).toBe('local');
    });
    it('沒有執行期設定（開發環境、nginx 版 Demo 站、單機版 exe）回傳 null，不假裝有模式', () => {
        expect(resolveRuntimeMode({})).toBeNull();
        expect(resolveRuntimeMode({ showDemoAccounts: true })).toBeNull();
    });
});
