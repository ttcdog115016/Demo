/**
 * 檔案名稱 (File): blobDownload.ts
 * 模組功能 (Description): 以暫時的 <a download> 觸發瀏覽器下載 Blob（去識別化結果、設定檔、使用注意事項）。
 *
 * ★ 2026-10-30：先前各處在 click() 之後立刻 URL.revokeObjectURL。單機版 App（pywebview＋WebView2）下載前會先跳
 *   「另存新檔」對話框，使用者選好位置後下載才真正進行；交通部 582 MB 的結果檔雖已完整寫入磁碟，下載列卻一直停在
 *   「0 B/秒 - 582 MB 的 582 MB」。改為延後釋放網址，涵蓋對話框停留與大檔寫入時間。
 *   延後期間不會多佔記憶體：Blob 本身仍由呼叫端持有（例如 Step4 的 processedCsvBlob）。
 */

/** 下載網址保留多久才釋放（毫秒） */
export const BLOB_DOWNLOAD_URL_REVOKE_DELAY_MS = 10 * 60 * 1000;

export const triggerBlobDownload = (downloadBlob: Blob, downloadFileName: string): void => {
    const blobDownloadUrl = URL.createObjectURL(downloadBlob);
    const downloadAnchorElement = document.createElement('a');
    downloadAnchorElement.href = blobDownloadUrl;
    downloadAnchorElement.download = downloadFileName;
    document.body.appendChild(downloadAnchorElement);
    downloadAnchorElement.click();
    document.body.removeChild(downloadAnchorElement);
    window.setTimeout(() => URL.revokeObjectURL(blobDownloadUrl), BLOB_DOWNLOAD_URL_REVOKE_DELAY_MS);
};
