/**
 * 檔案名稱 (File): kAnonymityFidelity.worker.ts
 * 模組功能 (Description): 在 Web Worker 中計算 K-匿名資料實用性（見 kAnonymityFidelity.ts）。
 * 訊息：主執行緒送 { input }；完成回 { result }，失敗回 { error }。
 */
import { computeKAnonymityFidelity, type KAnonymityFidelityInput } from './kAnonymityFidelity';

const workerScope = self as unknown as { onmessage: ((event: MessageEvent<{ input: KAnonymityFidelityInput }>) => void) | null; postMessage: (message: unknown) => void };

// 須在 import 之後設定：papaparse 在部分 Worker 環境會自行掛 onmessage，這裡以本檔的處理為準
workerScope.onmessage = (event) => {
    try {
        workerScope.postMessage({ result: computeKAnonymityFidelity(event.data.input) });
    } catch (computeError: unknown) {
        workerScope.postMessage({ error: computeError instanceof Error ? computeError.message : String(computeError) });
    }
};
