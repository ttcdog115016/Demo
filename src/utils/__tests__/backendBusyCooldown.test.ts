// @vitest-environment jsdom
/**
 * 收到 524／504 後的「後端可能仍在計算」冷卻提醒（2026-10-29 拔除 DP 執行時間預估，冷卻改為固定 5 分鐘）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { markBackendLikelyBusy, isBackendLikelyBusy, clearBackendBusy, isGatewayTimeoutStatus, BACKEND_BUSY_COOLDOWN_SECONDS } from '../backendBusyCooldown';

describe('backendBusyCooldown', () => {
    beforeEach(() => { clearBackendBusy(); sessionStorage.clear(); });

    it('收到逾時後 5 分鐘內提醒，之後不再提醒', () => {
        const nowMs = 1_000_000;
        expect(isBackendLikelyBusy(nowMs)).toBe(false);
        expect(markBackendLikelyBusy(nowMs)).toBe(nowMs + BACKEND_BUSY_COOLDOWN_SECONDS * 1000);
        expect(BACKEND_BUSY_COOLDOWN_SECONDS).toBe(300);
        expect(isBackendLikelyBusy(nowMs + 299_000)).toBe(true);
        expect(isBackendLikelyBusy(nowMs + 300_000)).toBe(false);
    });

    it('成功完成一次請求後清除提醒', () => {
        markBackendLikelyBusy();
        expect(isBackendLikelyBusy()).toBe(true);
        clearBackendBusy();
        expect(isBackendLikelyBusy()).toBe(false);
    });

    it('只有 524 與 504 視為通道逾時', () => {
        expect(isGatewayTimeoutStatus(524)).toBe(true);
        expect(isGatewayTimeoutStatus(504)).toBe(true);
        expect(isGatewayTimeoutStatus(500)).toBe(false);
        expect(isGatewayTimeoutStatus(undefined)).toBe(false);
    });
});
