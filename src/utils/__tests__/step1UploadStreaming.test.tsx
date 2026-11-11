// @vitest-environment jsdom
/**
 * ★ 2026-11-02（F12）：Step1 上傳改為逐段處理 Blob（不再整份解碼成字串）。驗證最終存入 store 的 dataFile
 *   一律為 UTF-8、檔名不變，且標題列清理、非 UTF-8 轉碼、移除特殊字元等流程結果與原本相同。
 */
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
class MockResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : ((fallback as { defaultValue?: string } | undefined)?.defaultValue ?? key)) }),
}));
const messageMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), destroy: vi.fn() }));
vi.mock('antd', async () => {
    const actual = await vi.importActual<typeof import('antd')>('antd');
    const MockApp = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    MockApp.useApp = () => ({ message: messageMock, modal: { confirm: vi.fn() }, notification: { error: vi.fn(), warning: vi.fn() } });
    return { ...actual, App: MockApp };
});

import Step1_Upload from '../../features/step1_upload/Step1_Upload';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

// jsdom 的 Blob 不一定支援 arrayBuffer()／text()，以 FileReader 補上（只供測試）
const readBlobAsArrayBuffer = (blob: Blob): Promise<ArrayBuffer> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
});
if (typeof Blob.prototype.arrayBuffer !== 'function') {
    Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) { return readBlobAsArrayBuffer(this); };
}
const readUtf8 = async (blob: Blob): Promise<string> => new TextDecoder('utf-8', { ignoreBOM: true }).decode(await readBlobAsArrayBuffer(blob));

const uploadFile = (file: File) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
};

const resetStore = () => useWorkspaceStore.setState({ dataFile: null, columns: [], previewData: [] } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);

describe('Step1 上傳：逐段處理，最終 dataFile 為 UTF-8', () => {
    beforeEach(() => { resetStore(); Object.values(messageMock).forEach((mockFn) => mockFn.mockClear()); });
    afterEach(() => { cleanup(); });

    it('Big5 檔案：轉成 UTF-8 送出，檔名不變、預覽正確', async () => {
        // 「地區,年齡\r\n大安,20\r\n」的 Big5 位元組
        const big5Bytes = new Uint8Array([0xA6, 0x61, 0xB0, 0xCF, 0x2C, 0xA6, 0x7E, 0xC4, 0xD6, 0x0D, 0x0A, 0xA4, 0x6A, 0xA6, 0x77, 0x2C, 0x32, 0x30, 0x0D, 0x0A]);
        render(<Step1_Upload />);
        uploadFile(new File([big5Bytes], 'big5.csv', { type: 'text/csv' }));
        await waitFor(() => expect(useWorkspaceStore.getState().columns).toEqual(['地區', '年齡']));
        const dataFile = useWorkspaceStore.getState().dataFile as File;
        expect(dataFile.name).toBe('big5.csv');
        expect(await readUtf8(dataFile)).toBe('地區,年齡\r\n大安,20\r\n');
        expect(useWorkspaceStore.getState().previewData).toEqual([{ 地區: '大安', 年齡: '20' }]);
    });

    it('UTF-8 BOM＋標題列前後空白：去 BOM、只改寫標題列', async () => {
        const body = new TextEncoder().encode(' 姓名 ,年齡\n 王小明 ,20\n');
        render(<Step1_Upload />);
        uploadFile(new File([new Uint8Array([0xEF, 0xBB, 0xBF]), body], 'bom.csv', { type: 'text/csv' }));
        await waitFor(() => expect(useWorkspaceStore.getState().columns).toEqual(['姓名', '年齡']));
        expect(await readUtf8(useWorkspaceStore.getState().dataFile as File)).toBe('姓名,年齡\n 王小明 ,20\n');
    });

    it('純 UTF-8 且不需改寫：原樣送出原始檔案', async () => {
        const original = new File(['a,b\n1,2\n'], 'plain.csv', { type: 'text/csv' });
        render(<Step1_Upload />);
        uploadFile(original);
        await waitFor(() => expect(useWorkspaceStore.getState().columns).toEqual(['a', 'b']));
        expect(useWorkspaceStore.getState().dataFile).toBe(original);
    });

    it('特殊字元：跳出確認視窗，選「移除特殊字元後上傳」後送出清理後的內容', async () => {
        render(<Step1_Upload />);
        uploadFile(new File(['姓名,地區\n**金品生,!#中正區\n郭彥晴,大安區\n'], 'special.csv', { type: 'text/csv' }));
        const stripButton = await screen.findByText('移除特殊字元後上傳');
        fireEvent.click(stripButton);
        await waitFor(() => expect(useWorkspaceStore.getState().columns).toEqual(['姓名', '地區']));
        expect(await readUtf8(useWorkspaceStore.getState().dataFile as File)).toBe('姓名,地區\n金品生,中正區\n郭彥晴,大安區\n');
        expect(messageMock.success).toHaveBeenCalledWith(expect.anything());
    });

    it('UTF-8 中混入無法解碼的位元組（64KB 之後）→ 擋下', async () => {
        const filler = 'a,b\n' + '1,2\n'.repeat(20000);
        render(<Step1_Upload />);
        uploadFile(new File([filler, new Uint8Array([0xFF]), '3,4\n'], 'broken.csv', { type: 'text/csv' }));
        await waitFor(() => expect(messageMock.error).toHaveBeenCalled());
        expect(useWorkspaceStore.getState().columns).toEqual([]);
    });
});
