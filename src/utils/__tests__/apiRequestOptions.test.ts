import { describe, it, expect, vi, afterEach } from 'vitest';
import axios, { AxiosError, CanceledError } from 'axios';
import { runRiskCap, runKAnonymity, runDifferentialPrivacy, isApiRequestCanceled, isApiRequestTimeout, DEFAULT_API_TIMEOUT_MS } from '../../api/apiService';
import { describePipelineError } from '../../features/step4_result/backendErrorCatalog';

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

    it('帶入 clientRunId 時以 X-Client-Run-Id 標頭送出，供取消運算時通知後端（★ 2026-10-31）', async () => {
        const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({ data: {}, headers: {} });
        const emptyFile = new File(['a'], 'a.csv');
        await runKAnonymity(emptyFile, emptyFile, { clientRunId: 'run-1' });
        expect((postSpy.mock.calls[0][2] as { headers?: Record<string, string> }).headers).toEqual({ 'X-Client-Run-Id': 'run-1' });
        await runKAnonymity(emptyFile, emptyFile);
        expect((postSpy.mock.calls[1][2] as { headers?: Record<string, string> }).headers).toBeUndefined();
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

    // ★ 2026-11-02：後端沒回品質／預算報告（或內容無法解析）時不可當成合規成功
    it('K-匿名：缺少 X-Quality-Report 或無法解析時回傳失敗，不捏造 is_valid:true 的報告', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const emptyFile = new File(['a'], 'a.csv');
        vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: 'a\n1\n', headers: {} });
        const missingResponse = await runKAnonymity(emptyFile, emptyFile);
        expect(missingResponse.success).toBe(false);
        expect(missingResponse.report).toBeUndefined();
        expect((missingResponse.error as Error).message).toContain('後端未回傳品質報告');

        vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: 'a\n1\n', headers: { 'x-quality-report': '{not json' } });
        const brokenResponse = await runKAnonymity(emptyFile, emptyFile);
        expect(brokenResponse.success).toBe(false);
        expect((brokenResponse.error as Error).message).toContain('品質報告');
    });

    it('差分隱私：缺少 X-Budget-Report 或無法解析時回傳失敗，不以前端推算值代替', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const emptyFile = new File(['a'], 'a.csv');
        vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: 'a\n1\n', headers: {} });
        const missingResponse = await runDifferentialPrivacy(emptyFile, emptyFile);
        expect(missingResponse.success).toBe(false);
        expect((missingResponse.error as Error).message).toContain('後端未回傳隱私預算報告');

        vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: 'a\n1\n', headers: { 'x-budget-report': 'null' } });
        const brokenResponse = await runDifferentialPrivacy(emptyFile, emptyFile);
        expect(brokenResponse.success).toBe(false);
        expect((brokenResponse.error as Error).message).toContain('隱私預算報告');
    });

    // ★ 2026-11-02：axios 被中止（abort）與逾時都用 ECONNABORTED，只有逾時的訊息含 timeout
    it('ECONNABORTED：只有訊息含 timeout 才算逾時，連線被中止不算', () => {
        expect(isApiRequestTimeout(new AxiosError('timeout of 900000ms exceeded', 'ECONNABORTED'))).toBe(true);
        expect(isApiRequestTimeout(new AxiosError('Request aborted', 'ECONNABORTED'))).toBe(false);
        expect(isApiRequestTimeout(new AxiosError('connect ETIMEDOUT', 'ETIMEDOUT'))).toBe(true);
        expect(isApiRequestTimeout(new AxiosError('canceled', 'ERR_CANCELED'))).toBe(false);
    });

    it('後端 499／ERR_CANCELLED 顯示為「已取消運算」', async () => {
        const withCode = await describePipelineError({ response: { status: 499, data: { error_code: 'ERR_CANCELLED', message: '使用者已取消運算。' } } });
        expect(withCode.errorMessage).toContain('已取消運算');
        expect(withCode.errorMessage).toContain('HTTP 499');
        const statusOnly = await describePipelineError({ response: { status: 499 } });
        expect(statusOnly.errorMessage).toContain('已取消運算');
    });
});
