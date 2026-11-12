// @vitest-environment jsdom
/**
 * 管理員「系統模式」分頁（唯讀）：顯示目前模式、目前連線，並說明如何在主機上切換。
 * 重點：只提供說明與可複製的指令，不提供會改變模式的按鈕（切換必須在主機上做，原因見 ModeInfoPanel.tsx 檔頭）。
 */
import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// 翻譯函式：有預設字串就回傳預設字串，並套用 {{名稱}} 插值
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: unknown, options?: Record<string, string>) =>
        {
            const text = typeof fallback === 'string' ? fallback : key;
            return options ? text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => options[name] ?? '') : text;
        },
    }),
}));

import ModeInfoPanel from '../ModeInfoPanel';
import { isLoopbackHostname } from '../modeInfo';

const localhostHttp = { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:8080' };
const lanHttps = { protocol: 'https:', hostname: '192.168.1.20', origin: 'https://192.168.1.20' };
const lanHttp = { protocol: 'http:', hostname: '192.168.1.20', origin: 'http://192.168.1.20:8080' };

describe('系統模式分頁：目前模式', () => {
    afterEach(() => { cleanup(); });

    it('本地：顯示「本地」，只列出切換到內網與線上，不列出切換到本地', () => {
        render(<ModeInfoPanel mode="local" connection={localhostHttp} />);
        expect(screen.getByTestId('mode-current-tag').textContent).toBe('本地');
        expect(screen.queryByTestId('mode-switch-local')).toBeNull();
        expect(screen.getByTestId('mode-switch-lan')).toBeTruthy();
        expect(screen.getByTestId('mode-switch-online')).toBeTruthy();
    });

    it('內網：顯示「內網」，只列出切換到本地與線上', () => {
        render(<ModeInfoPanel mode="lan" connection={lanHttps} />);
        expect(screen.getByTestId('mode-current-tag').textContent).toBe('內網');
        expect(screen.getByTestId('mode-switch-local')).toBeTruthy();
        expect(screen.queryByTestId('mode-switch-lan')).toBeNull();
        expect(screen.getByTestId('mode-switch-online')).toBeTruthy();
    });

    it('線上：顯示「線上」', () => {
        render(<ModeInfoPanel mode="online" connection={{ protocol: 'https:', hostname: 'pets.example.com', origin: 'https://pets.example.com' }} />);
        expect(screen.getByTestId('mode-current-tag').textContent).toBe('線上');
    });

    it('沒有執行期模式（開發環境、展示站）：說明沒有可切換的模式，不顯示切換說明', () => {
        render(<ModeInfoPanel mode={null} connection={localhostHttp} />);
        expect(screen.getByText('未設定模式')).toBeTruthy();
        expect(screen.queryByText('要切換模式嗎？')).toBeNull();
        expect(screen.queryByTestId('mode-current-tag')).toBeNull();
    });
});

describe('系統模式分頁：切換說明與指令', () => {
    afterEach(() => { cleanup(); });

    it('內網的切換卡片有 mode lan 與 export-ca 指令，以及 https 與防火牆提醒', () => {
        render(<ModeInfoPanel mode="local" connection={localhostHttp} />);
        const lanCard = screen.getByTestId('mode-switch-lan');
        expect(within(lanCard).getByText('.\\open-pets.ps1 mode lan -Hosts 這台電腦的IP')).toBeTruthy();
        expect(within(lanCard).getByText('.\\open-pets.ps1 export-ca')).toBeTruthy();
        expect(within(lanCard).getByText(/防火牆/)).toBeTruthy();
        expect(within(lanCard).getByText(/https:\/\//)).toBeTruthy();
    });

    it('線上與本地的切換卡片各有對應的 mode 指令', () => {
        render(<ModeInfoPanel mode="lan" connection={lanHttps} />);
        expect(within(screen.getByTestId('mode-switch-online')).getByText('.\\open-pets.ps1 mode online -Hosts 你的網域')).toBeTruthy();
        expect(within(screen.getByTestId('mode-switch-local')).getByText('.\\open-pets.ps1 mode local')).toBeTruthy();
    });

    it('說明切換要在主機上做，並提供 status 指令', () => {
        render(<ModeInfoPanel mode="local" connection={localhostHttp} />);
        expect(screen.getByText('模式要在「主機」上切換，不能從網頁切換。')).toBeTruthy();
        expect(screen.getByText('.\\open-pets.ps1 status')).toBeTruthy();
    });

    it('唯讀：沒有任何會改變模式的按鈕', () => {
        render(<ModeInfoPanel mode="local" connection={localhostHttp} />);
        const switchLikeButtons = screen.queryAllByRole('button').filter((button) => /切換|switch|套用|apply|儲存|save/i.test(button.textContent ?? ''));
        expect(switchLikeButtons).toHaveLength(0);
    });
});

describe('系統模式分頁：目前連線與警告', () => {
    afterEach(() => { cleanup(); });

    it('顯示目前網址與 HTTPS 狀態', () => {
        render(<ModeInfoPanel mode="lan" connection={lanHttps} />);
        expect(screen.getByTestId('mode-conn-origin').textContent).toBe('https://192.168.1.20');
        expect(screen.getByText('HTTPS（已加密）')).toBeTruthy();
    });

    it('內網卻用明文 http 從其他位址連入：警告', () => {
        render(<ModeInfoPanel mode="lan" connection={lanHttp} />);
        expect(screen.getByTestId('mode-warn-plain-http')).toBeTruthy();
        expect(screen.getByText('HTTP（未加密）')).toBeTruthy();
    });

    it('內網模式在主機本機用 http://localhost 連入：不警告（沒有經過網路）', () => {
        render(<ModeInfoPanel mode="lan" connection={localhostHttp} />);
        expect(screen.queryByTestId('mode-warn-plain-http')).toBeNull();
    });

    it('線上模式用 https：不警告', () => {
        render(<ModeInfoPanel mode="online" connection={{ protocol: 'https:', hostname: 'pets.example.com', origin: 'https://pets.example.com' }} />);
        expect(screen.queryByTestId('mode-warn-plain-http')).toBeNull();
    });

    it('本地模式卻不是從本機連入：警告可能把埠對外開放', () => {
        render(<ModeInfoPanel mode="local" connection={lanHttp} />);
        expect(screen.getByTestId('mode-warn-local-remote')).toBeTruthy();
    });

    it('本地模式從 localhost 或 127.0.0.1 連入：不警告', () => {
        render(<ModeInfoPanel mode="local" connection={{ protocol: 'http:', hostname: '127.0.0.1', origin: 'http://127.0.0.1:8080' }} />);
        expect(screen.queryByTestId('mode-warn-local-remote')).toBeNull();
    });
});

describe('isLoopbackHostname', () => {
    it('localhost、127.0.0.1、::1 視為本機；其他位址不是', () => {
        expect(isLoopbackHostname('localhost')).toBe(true);
        expect(isLoopbackHostname('LOCALHOST')).toBe(true);
        expect(isLoopbackHostname('127.0.0.1')).toBe(true);
        expect(isLoopbackHostname('[::1]')).toBe(true);
        expect(isLoopbackHostname('192.168.1.20')).toBe(false);
        expect(isLoopbackHostname('pets.example.com')).toBe(false);
    });
});
