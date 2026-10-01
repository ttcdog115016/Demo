import { describe, it, expect, vi, afterEach } from 'vitest';
import axios, { AxiosError, CanceledError } from 'axios';
import { runRiskCap, runKAnonymity, runDifferentialPrivacy, isApiRequestCanceled, isApiRequestTimeout, DEFAULT_API_TIMEOUT_MS } from '../../api/apiService';

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

    it('K-匿名／差分隱私：表單只送 file 與 config（後端 v3 所有參數皆在設定檔內），並解析報告標頭', async () => {
        const dataFile = new File(['a\n1\n'], 'input.csv');
        const configFile = new File(['{}'], 'config.json');
        const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({
            data: 'a\n1\n',
            headers: { 'x-quality-report': JSON.stringify({ is_valid: true, hash_algorithm: 'sha3-256', hash_salted: false }), 'x-budget-report': JSON.stringify({ consumed_epsilon: 1 }) }
        });

        const kAnonymityResponse = await runKAnonymity(dataFile, configFile);
        const kAnonymityForm = postSpy.mock.calls[0][1] as FormData;
        expect(Array.from(kAnonymityForm.keys())).toEqual(['file', 'config']);
        expect(kAnonymityResponse.report).toMatchObject({ hash_algorithm: 'sha3-256', hash_salted: false });

        const dpResponse = await runDifferentialPrivacy(dataFile, configFile);
        const dpForm = postSpy.mock.calls[1][1] as FormData;
        expect(Array.from(dpForm.keys())).toEqual(['file', 'config']);
        expect(dpResponse.report).toMatchObject({ consumed_epsilon: 1 });
    });
});
