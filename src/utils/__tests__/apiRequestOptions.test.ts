import { describe, it, expect, vi, afterEach } from 'vitest';
import axios, { AxiosError, CanceledError } from 'axios';
import { runRiskCap, isApiRequestCanceled, isApiRequestTimeout, DEFAULT_API_TIMEOUT_MS } from '../../api/apiService';

describe('API 請求逾時／取消', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('把 signal、逾時與上傳進度傳給 axios', async () => {
        const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({ data: { cap_before: 1, cap_after: 0.5, n_original: 1, n_processed: 1, message: '' } });
        const abortController = new AbortController();
        const progressSpy = vi.fn();
        const emptyFile = new File(['a'], 'a.csv');

        await runRiskCap(emptyFile, emptyFile, emptyFile, { signal: abortController.signal, onUploadProgress: progressSpy });

        const axiosConfig = postSpy.mock.calls[0][2] as { signal?: AbortSignal; timeout?: number; onUploadProgress?: (e: { loaded: number; total?: number }) => void };
        expect(axiosConfig.signal).toBe(abortController.signal);
        expect(axiosConfig.timeout).toBe(DEFAULT_API_TIMEOUT_MS);
        axiosConfig.onUploadProgress?.({ loaded: 5, total: 10 });
        expect(progressSpy).toHaveBeenCalledWith(5, 10);
    });

    it('未傳選項時仍套用預設逾時', async () => {
        const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
        const emptyFile = new File(['a'], 'a.csv');
        await runRiskCap(emptyFile, emptyFile, emptyFile);
        expect((postSpy.mock.calls[0][2] as { timeout?: number }).timeout).toBe(DEFAULT_API_TIMEOUT_MS);
    });

    it('辨識取消與逾時', () => {
        expect(isApiRequestCanceled(new CanceledError())).toBe(true);
        expect(isApiRequestCanceled(new Error('x'))).toBe(false);
        expect(isApiRequestTimeout(new AxiosError('timeout', 'ECONNABORTED'))).toBe(true);
        expect(isApiRequestTimeout(new AxiosError('bad', 'ERR_BAD_RESPONSE'))).toBe(false);
        expect(isApiRequestCanceled(null)).toBe(false);
    });
});
