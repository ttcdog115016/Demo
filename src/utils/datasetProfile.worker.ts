/**
 * 檔案名稱 (File): datasetProfile.worker.ts
 * 模組功能 (Description): 在 Web Worker 中掃描資料集欄位統計（見 datasetProfileScanner.ts），避免大檔掃描期間畫面凍結。
 * 訊息：主執行緒送 { file }；完成回 { profile }，失敗回 { error }。
 */
import { scanDatasetFileOnCurrentThread } from './datasetProfileScanner';

const workerScope = self as unknown as { onmessage: ((event: MessageEvent<{ file: File }>) => void) | null; postMessage: (message: unknown) => void };

// 須在 import 之後設定：papaparse 在部分 Worker 環境會自行掛 onmessage，這裡以本檔的處理為準
workerScope.onmessage = (event) => {
    scanDatasetFileOnCurrentThread(event.data.file)
        .then((profile) => workerScope.postMessage({ profile }))
        .catch((scanError: unknown) => workerScope.postMessage({ error: scanError instanceof Error ? scanError.message : String(scanError) }));
};
