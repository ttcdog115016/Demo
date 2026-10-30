/**
 * ============================================================================
 * 檔案名稱 (File): auditIntegrity.ts
 * 模組功能 (Description): 處理紀錄的防篡改資料——檔案指紋（SHA-256）與伺服器簽章驗證
 * ★ 2026-10-02 新增：取代 AuditLogHub／Step4 報告中寫死的假指紋與假簽章字串。
 * ★ 2026-10-29：簽章改由後端以伺服器金鑰（HMAC-SHA256）簽署（POST /api/v1/history，見後端
 *   app/governance/history_signing.py），驗證改呼叫 GET /api/v1/history/{id}/verify。
 *   原本各瀏覽器自產 ECDSA 金鑰、公鑰隨紀錄保存，改得到資料庫的人可連公鑰一起換掉，證明不了什麼。
 *
 * 前端只負責：計算原始上傳檔與去識別化輸出檔的 SHA-256（檔案只在瀏覽器端，伺服器不保留），
 *   隨紀錄送後端，由後端納入簽署內容。
 * ============================================================================
 */
import CryptoJS from 'crypto-js';
import { verifyHistoryRecord } from '../api/systemApi';

/** 檔案超過此大小時不計算檔案指紋（避免一次讀入記憶體造成頁面卡死）；Web Crypto／CryptoJS 各自上限 */
const MAX_FILE_HASH_BYTES_WEBCRYPTO = 512 * 1024 * 1024;
const MAX_FILE_HASH_BYTES_FALLBACK = 100 * 1024 * 1024;

/** 舊版（2026-10-02～10-29）瀏覽器簽章金鑰的 IndexedDB 名稱；main.tsx 啟動時刪除 */
export const LEGACY_SIGNING_KEY_DB_NAME = 'privacy-toolkit-audit';

/** 紀錄附帶的完整性資料（由後端簽發；前端送出時只帶兩個檔案指紋） */
export interface AuditIntegrityRecord {
    version?: number;
    algorithm?: string;                     // 'HMAC-SHA256'
    signedAt?: string;                      // ISO 時間（後端簽發時間）
    documentSha256?: string;                // 簽署內容的 SHA-256（防篡改指紋）
    inputFileSha256: string | null;         // 原始上傳檔 SHA-256（檔案過大或讀取失敗時為 null）
    outputFileSha256: string | null;        // 去識別化輸出檔 SHA-256
    signature?: string | null;              // 伺服器簽章（hex）；伺服器未設定金鑰時為 null
    keyId?: string | null;                  // 伺服器簽章金鑰 ID
    unsignedReason?: 'server_key_missing';
}

/** valid 未被竄改｜tampered 內容或簽章不符｜unsigned 伺服器未設金鑰、只有指紋｜unverifiable 伺服器金鑰已更換｜missing 尚未簽發｜error 無法連線驗證 */
export type AuditVerificationStatus = 'valid' | 'tampered' | 'unsigned' | 'unverifiable' | 'missing' | 'error';

export interface AuditVerificationResult {
    status: AuditVerificationStatus;
    fingerprintMatches: boolean | null;
    signatureValid: boolean | null;
}

const getSubtleCrypto = (): SubtleCrypto | null =>
    (typeof globalThis !== 'undefined' && globalThis.isSecureContext !== false && globalThis.crypto?.subtle) ? globalThis.crypto.subtle : null;

const bytesToHex = (buffer: ArrayBuffer): string => Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** 字串 SHA-256（hex）；無 Web Crypto 時改用 crypto-js，結果相同 */
export const sha256HexOfText = async (text: string): Promise<string> => {
    const subtle = getSubtleCrypto();
    if (subtle) return bytesToHex(await subtle.digest('SHA-256', new TextEncoder().encode(text)));
    return CryptoJS.SHA256(CryptoJS.enc.Utf8.parse(text)).toString(CryptoJS.enc.Hex);
};

/** 檔案／Blob SHA-256（hex）；超過大小上限或讀取失敗時回傳 null */
export const sha256HexOfBlob = async (blob: Blob | null | undefined): Promise<string | null> => {
    if (!blob) return null;
    try {
        const subtle = getSubtleCrypto();
        if (subtle) {
            if (blob.size > MAX_FILE_HASH_BYTES_WEBCRYPTO) return null;
            return bytesToHex(await subtle.digest('SHA-256', await blob.arrayBuffer()));
        }
        if (blob.size > MAX_FILE_HASH_BYTES_FALLBACK) return null;
        const wordArray = CryptoJS.lib.WordArray.create(new Uint8Array(await blob.arrayBuffer()) as unknown as number[]);
        return CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);
    } catch (hashErrorPayload) {
        console.error('計算檔案 SHA-256 失敗:', hashErrorPayload);
        return null;
    }
};

/** 送後端前計算兩個檔案指紋（簽章由後端完成） */
export const computeFileFingerprints = async (
    files: { inputFile?: Blob | null; outputFile?: Blob | null }
): Promise<Pick<AuditIntegrityRecord, 'inputFileSha256' | 'outputFileSha256'>> => {
    // ★ 2026-10-30：依序計算，不同時把兩個檔案整份讀進記憶體
    const inputFileSha256 = await sha256HexOfBlob(files.inputFile);
    const outputFileSha256 = await sha256HexOfBlob(files.outputFile);
    return { inputFileSha256, outputFileSha256 };
};

/** 請後端依紀錄目前的內容重算指紋與簽章 */
export const verifyAuditIntegrity = async (recordId: string): Promise<AuditVerificationResult> => {
    try {
        return await verifyHistoryRecord(recordId);
    } catch (verifyErrorPayload) {
        console.error('驗證處理紀錄失敗:', verifyErrorPayload);
        return { status: 'error', fingerprintMatches: null, signatureValid: null };
    }
};
