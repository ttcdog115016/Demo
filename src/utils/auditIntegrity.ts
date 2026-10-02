/**
 * ============================================================================
 * 檔案名稱 (File): auditIntegrity.ts
 * 模組功能 (Description): 稽核憑證的防篡改指紋（SHA-256）與數位簽章（ECDSA P-256）產生與驗證
 * ★ 2026-10-02 新增：取代 AuditLogHub／Step4 報告中寫死的假指紋與假簽章字串。
 *
 * 運作方式：
 *   1. 簽署文件 = 憑證內容（AuditLogItem 去掉 id 與 integrity）＋ 輸入檔／輸出檔的 SHA-256 ＋ 簽署時間 ＋ 金鑰 ID，
 *      以「鍵值排序後的 JSON」（canonical JSON）序列化，確保同一份內容永遠得到同一串文字。
 *   2. 指紋 = SHA-256(簽署文件)；簽章 = ECDSA P-256 / SHA-256 對簽署文件簽署（Base64，IEEE P1363 格式）。
 *   3. 驗證時依目前的憑證內容重組簽署文件：指紋不符或簽章驗不過 → 內容已被竄改。
 *
 * 金鑰：瀏覽器端以 Web Crypto 產生、私鑰設為「不可匯出」並存於 IndexedDB（無法使用時退回本次頁面記憶體）。
 *   公鑰（JWK）隨憑證一起保存，任何人都能用它驗證；金鑰 ID＝公鑰指紋前 16 碼。
 *
 * ⚠ 限制（正式環境應改由後端以伺服器私鑰簽署）：
 *   - 金鑰由使用者自己的瀏覽器產生，只能證明「憑證簽發後內容未被改動」，不能證明「由本系統伺服器簽發」。
 *   - Web Crypto 只在安全環境（HTTPS 或 localhost）可用；以 http://區網IP 開啟時只能計算指紋、無法簽章。
 * ============================================================================
 */
import CryptoJS from 'crypto-js';
import type { AuditLogItem } from '../store/useAuditStore';

export const AUDIT_SIGNATURE_ALGORITHM = 'ECDSA-P256-SHA256';
export const AUDIT_INTEGRITY_VERSION = 1;

/** 檔案超過此大小時不計算檔案指紋（避免一次讀入記憶體造成頁面卡死）；Web Crypto／CryptoJS 各自上限 */
const MAX_FILE_HASH_BYTES_WEBCRYPTO = 512 * 1024 * 1024;
const MAX_FILE_HASH_BYTES_FALLBACK = 100 * 1024 * 1024;

const SIGNING_KEY_DB_NAME = 'privacy-toolkit-audit';
const SIGNING_KEY_STORE_NAME = 'signing-keys';
const SIGNING_KEY_RECORD_ID = 'default-v1';

/** 憑證附帶的完整性資料 */
export interface AuditIntegrityRecord {
    version: number;
    algorithm: string;                      // 'ECDSA-P256-SHA256'；無法簽章時仍記錄演算法名稱
    signedAt: string;                       // ISO 時間
    documentSha256: string;                 // 簽署文件的 SHA-256（防篡改指紋）
    inputFileSha256: string | null;         // 原始上傳檔 SHA-256（檔案過大或讀取失敗時為 null）
    outputFileSha256: string | null;        // 去識別化輸出檔 SHA-256
    signature: string | null;               // Base64 簽章；環境不支援時為 null
    publicKeyJwk: JsonWebKey | null;        // 驗證用公鑰
    keyId: string | null;                   // 公鑰指紋前 16 碼
    unsignedReason?: 'insecure_context' | 'sign_failed';
}

export type AuditVerificationStatus = 'valid' | 'tampered' | 'unsigned' | 'missing' | 'unsupported' | 'error';

export interface AuditVerificationResult {
    status: AuditVerificationStatus;
    fingerprintMatches: boolean | null;     // 依目前內容重算的指紋是否與紀錄相同
    signatureValid: boolean | null;         // 簽章驗證結果（無簽章時為 null）
    signedByThisBrowser: boolean | null;    // 金鑰 ID 是否為本瀏覽器目前的簽章金鑰
}

const getSubtleCrypto = (): SubtleCrypto | null =>
    (typeof globalThis !== 'undefined' && globalThis.isSecureContext !== false && globalThis.crypto?.subtle) ? globalThis.crypto.subtle : null;

/** 鍵值排序後的 JSON（陣列順序保留；undefined 欄位略過），確保同一內容序列化結果一致 */
export const canonicalJsonStringify = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJsonStringify(item === undefined ? null : item)).join(',')}]`;
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
    return `{${sortedKeys.map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`).join(',')}}`;
};

const bytesToHex = (buffer: ArrayBuffer): string => Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
const bytesToBase64 = (buffer: ArrayBuffer): string => {
    let binaryText = '';
    new Uint8Array(buffer).forEach((byte) => { binaryText += String.fromCharCode(byte); });
    return btoa(binaryText);
};
const base64ToBytes = (base64Text: string): Uint8Array<ArrayBuffer> => {
    const binaryText = atob(base64Text);
    const bytes = new Uint8Array(new ArrayBuffer(binaryText.length));
    for (let index = 0; index < binaryText.length; index++) bytes[index] = binaryText.charCodeAt(index);
    return bytes;
};

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

// ---------------------------------------------------------------------------
// 簽章金鑰：IndexedDB 保存（私鑰不可匯出），失敗時退回記憶體
// ---------------------------------------------------------------------------
interface StoredSigningKey { privateKey: CryptoKey; publicKeyJwk: JsonWebKey; keyId: string }
let inMemorySigningKeyPromise: Promise<StoredSigningKey> | null = null;

const openSigningKeyDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const openRequest = indexedDB.open(SIGNING_KEY_DB_NAME, 1);
    openRequest.onupgradeneeded = () => { openRequest.result.createObjectStore(SIGNING_KEY_STORE_NAME); };
    openRequest.onsuccess = () => resolve(openRequest.result);
    openRequest.onerror = () => reject(openRequest.error);
});

const readStoredSigningKey = async (): Promise<StoredSigningKey | null> => {
    try {
        const db = await openSigningKeyDb();
        return await new Promise((resolve) => {
            const getRequest = db.transaction(SIGNING_KEY_STORE_NAME, 'readonly').objectStore(SIGNING_KEY_STORE_NAME).get(SIGNING_KEY_RECORD_ID);
            getRequest.onsuccess = () => resolve((getRequest.result as StoredSigningKey | undefined) ?? null);
            getRequest.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
};

const writeStoredSigningKey = async (keyRecord: StoredSigningKey): Promise<void> => {
    try {
        const db = await openSigningKeyDb();
        await new Promise<void>((resolve) => {
            const transaction = db.transaction(SIGNING_KEY_STORE_NAME, 'readwrite');
            transaction.objectStore(SIGNING_KEY_STORE_NAME).put(keyRecord, SIGNING_KEY_RECORD_ID);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => resolve();
        });
    } catch {
        // 無痕模式等情況無法寫入：本次頁面仍可用記憶體中的金鑰簽章
    }
};

/** 公鑰指紋（金鑰 ID）：SHA-256(canonical JWK 的 crv/kty/x/y) 前 16 碼 */
export const computeKeyId = async (publicKeyJwk: JsonWebKey): Promise<string> =>
    (await sha256HexOfText(canonicalJsonStringify({ crv: publicKeyJwk.crv, kty: publicKeyJwk.kty, x: publicKeyJwk.x, y: publicKeyJwk.y }))).slice(0, 16).toUpperCase();

const loadOrCreateSigningKey = (subtle: SubtleCrypto): Promise<StoredSigningKey> => {
    if (!inMemorySigningKeyPromise) {
        inMemorySigningKeyPromise = (async () => {
            const storedKey = await readStoredSigningKey();
            if (storedKey?.privateKey && storedKey.publicKeyJwk) return storedKey;
            const generatedKeyPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
            const publicKeyJwk = await subtle.exportKey('jwk', generatedKeyPair.publicKey);
            const newKeyRecord: StoredSigningKey = { privateKey: generatedKeyPair.privateKey, publicKeyJwk, keyId: await computeKeyId(publicKeyJwk) };
            await writeStoredSigningKey(newKeyRecord);
            return newKeyRecord;
        })().catch((keyErrorPayload) => {
            inMemorySigningKeyPromise = null;
            throw keyErrorPayload;
        });
    }
    return inMemorySigningKeyPromise;
};

/** 本瀏覽器目前的簽章金鑰 ID；環境不支援時回傳 null（不會為了查詢而產生新金鑰以外的副作用） */
export const getCurrentSigningKeyId = async (): Promise<string | null> => {
    const subtle = getSubtleCrypto();
    if (!subtle) return null;
    try {
        return (await loadOrCreateSigningKey(subtle)).keyId;
    } catch {
        return null;
    }
};

// ---------------------------------------------------------------------------
// 簽署與驗證
// ---------------------------------------------------------------------------
type AuditPayload = Omit<AuditLogItem, 'id' | 'integrity'>;

/** 只取憑證內容欄位（排除 id 與 integrity 本身） */
const extractAuditPayload = (entry: AuditPayload | AuditLogItem): AuditPayload => {
    const { id: _ignoredId, integrity: _ignoredIntegrity, ...payload } = entry as AuditLogItem;
    void _ignoredId; void _ignoredIntegrity;
    return payload;
};

/** 組出簽署文件字串（產生與驗證共用，確保兩邊一致） */
export const buildAuditSignedDocumentText = (
    entry: AuditPayload | AuditLogItem,
    meta: Pick<AuditIntegrityRecord, 'version' | 'algorithm' | 'signedAt' | 'inputFileSha256' | 'outputFileSha256' | 'keyId'>
): string => canonicalJsonStringify({
    certificate: extractAuditPayload(entry),
    integrity: {
        version: meta.version, algorithm: meta.algorithm, signedAt: meta.signedAt,
        inputFileSha256: meta.inputFileSha256, outputFileSha256: meta.outputFileSha256, keyId: meta.keyId
    }
});

/** 產生憑證的完整性資料（指紋＋簽章）；任何步驟失敗都不會拋錯，只會少簽章或少檔案指紋 */
export const createAuditIntegrity = async (
    entry: AuditPayload,
    files: { inputFile?: Blob | null; outputFile?: Blob | null }
): Promise<AuditIntegrityRecord> => {
    const [inputFileSha256, outputFileSha256] = await Promise.all([sha256HexOfBlob(files.inputFile), sha256HexOfBlob(files.outputFile)]);
    const signedAt = new Date().toISOString();
    const subtle = getSubtleCrypto();

    let signingKey: StoredSigningKey | null = null;
    let unsignedReason: AuditIntegrityRecord['unsignedReason'] = subtle ? undefined : 'insecure_context';
    if (subtle) {
        try { signingKey = await loadOrCreateSigningKey(subtle); } catch (keyErrorPayload) {
            console.error('取得簽章金鑰失敗:', keyErrorPayload);
            unsignedReason = 'sign_failed';
        }
    }

    const baseMeta = { version: AUDIT_INTEGRITY_VERSION, algorithm: AUDIT_SIGNATURE_ALGORITHM, signedAt, inputFileSha256, outputFileSha256 };

    if (subtle && signingKey) {
        try {
            const signedMeta = { ...baseMeta, keyId: signingKey.keyId };
            const documentText = buildAuditSignedDocumentText(entry, signedMeta);
            const signature = bytesToBase64(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey.privateKey, new TextEncoder().encode(documentText)));
            return { ...signedMeta, documentSha256: await sha256HexOfText(documentText), signature, publicKeyJwk: signingKey.publicKeyJwk };
        } catch (signErrorPayload) {
            console.error('數位簽章失敗:', signErrorPayload);
            unsignedReason = 'sign_failed';
        }
    }

    // 無法簽章：仍記錄指紋（簽署文件中的 keyId 為 null，驗證時一致）
    const unsignedMeta = { ...baseMeta, keyId: null };
    return {
        ...unsignedMeta,
        documentSha256: await sha256HexOfText(buildAuditSignedDocumentText(entry, unsignedMeta)),
        signature: null, publicKeyJwk: null, unsignedReason
    };
};

/** 依憑證「目前的內容」驗證指紋與簽章 */
export const verifyAuditIntegrity = async (entry: AuditLogItem): Promise<AuditVerificationResult> => {
    const integrity = entry.integrity;
    if (!integrity) return { status: 'missing', fingerprintMatches: null, signatureValid: null, signedByThisBrowser: null };
    try {
        // 未簽章時 keyId 存為 null，簽署文件內的 keyId 也是 null
        const documentText = buildAuditSignedDocumentText(entry, integrity);
        const fingerprintMatches = (await sha256HexOfText(documentText)) === integrity.documentSha256;
        if (!integrity.signature || !integrity.publicKeyJwk) {
            return { status: fingerprintMatches ? 'unsigned' : 'tampered', fingerprintMatches, signatureValid: null, signedByThisBrowser: null };
        }
        const subtle = getSubtleCrypto();
        if (!subtle) return { status: fingerprintMatches ? 'unsupported' : 'tampered', fingerprintMatches, signatureValid: null, signedByThisBrowser: null };
        const publicKey = await subtle.importKey('jwk', integrity.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        const signatureValid = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, base64ToBytes(integrity.signature), new TextEncoder().encode(documentText));
        // 公鑰本身被換掉也算竄改：金鑰 ID 必須等於公鑰重算的指紋
        const keyIdMatches = (await computeKeyId(integrity.publicKeyJwk)) === integrity.keyId;
        const currentKeyId = await getCurrentSigningKeyId();
        return {
            status: fingerprintMatches && signatureValid && keyIdMatches ? 'valid' : 'tampered',
            fingerprintMatches, signatureValid: signatureValid && keyIdMatches,
            signedByThisBrowser: currentKeyId ? currentKeyId === integrity.keyId : null
        };
    } catch (verifyErrorPayload) {
        console.error('驗證數位簽章失敗:', verifyErrorPayload);
        return { status: 'error', fingerprintMatches: null, signatureValid: null, signedByThisBrowser: null };
    }
};
