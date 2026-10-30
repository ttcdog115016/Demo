// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { triggerBlobDownload, BLOB_DOWNLOAD_URL_REVOKE_DELAY_MS } from '../blobDownload';

describe('triggerBlobDownload：下載網址延後釋放（2026-10-30 單機版 582 MB 下載列停在 0 B/秒）', () => {
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    it('以檔名觸發下載，click 當下不釋放網址，延後時間到才釋放', () => {
        vi.useFakeTimers();
        const createObjectURL = vi.fn(() => 'blob:mock-url');
        const revokeObjectURL = vi.fn();
        Object.assign(URL, { createObjectURL, revokeObjectURL });
        const clickedAnchors: HTMLAnchorElement[] = [];
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clickedAnchors.push(this); });

        const csvBlob = new Blob(['ID\r\n1\r\n'], { type: 'text/csv' });
        triggerBlobDownload(csvBlob, 'deidentified_dataset_1.csv');

        expect(createObjectURL).toHaveBeenCalledWith(csvBlob);
        expect(clickedAnchors).toHaveLength(1);
        expect(clickedAnchors[0].download).toBe('deidentified_dataset_1.csv');
        expect(clickedAnchors[0].getAttribute('href')).toBe('blob:mock-url');
        expect(document.body.contains(clickedAnchors[0])).toBe(false);
        expect(revokeObjectURL).not.toHaveBeenCalled();

        vi.advanceTimersByTime(BLOB_DOWNLOAD_URL_REVOKE_DELAY_MS - 1);
        expect(revokeObjectURL).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });
});
