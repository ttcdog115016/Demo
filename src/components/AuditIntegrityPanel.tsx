/**
 * 稽核憑證「防篡改指紋與數位簽章」區塊（AuditLogHub 憑證調閱視窗、Step4 合規報告共用）。
 * ★ 2026-10-02：取代寫死的假指紋與假簽章，改顯示 utils/auditIntegrity.ts 產生的真實值，並即時驗證。
 * ★ 2026-10-29：簽章改由伺服器簽發，驗證改請後端重算（GET /api/v1/history/{id}/verify），任何電腦看到的結果都一樣。
 * 使用一般 span／div 與行內樣式（不用 antd Tag），確保 html2pdf 匯出 PDF 時排版一致。
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuditLogItem } from '../store/useAuditStore';
import { verifyAuditIntegrity, type AuditVerificationResult } from '../utils/auditIntegrity';

interface AuditIntegrityPanelProps {
    entry: AuditLogItem | null | undefined;
    /** 外層容器樣式（沿用各頁原本的頁尾樣式） */
    style?: React.CSSProperties;
    className?: string;
}

const STATUS_COLOR_MAP: Record<string, string> = {
    valid: '#15803d', tampered: '#b91c1c', unsigned: '#b45309', unverifiable: '#b45309', missing: '#6b7280', error: '#b91c1c', checking: '#6b7280'
};

const monoStyle: React.CSSProperties = { fontFamily: 'Consolas, "Courier New", monospace', wordBreak: 'break-all' };

export default function AuditIntegrityPanel({ entry, style, className }: AuditIntegrityPanelProps): ReactElement {
    const { t: translate } = useTranslation();
    // 驗證結果連同「驗證的是哪一筆」一起存，切換到別筆時舊結果自動失效（顯示「驗證中」），不需在 effect 內重設 state
    const [verificationState, setVerificationState] = useState<{ entry: AuditLogItem; result: AuditVerificationResult } | null>(null);
    const verificationResult = entry && verificationState?.entry === entry ? verificationState.result : null;

    // 伺服器尚未簽發（還沒存到後端、或存檔失敗）時沒有東西可驗
    const integrity = entry?.integrity;
    const isServerIssued = !!integrity?.signedAt;

    useEffect(() => {
        if (!entry || !isServerIssued) return undefined;
        let isCancelled = false;
        verifyAuditIntegrity(entry.id).then((result) => { if (!isCancelled) setVerificationState({ entry, result }); });
        return () => { isCancelled = true; };
    }, [entry, isServerIssued]);

    const statusKey = !entry || !isServerIssued ? 'missing' : (verificationResult?.status ?? 'checking');
    const statusLabelMap: Record<string, string> = {
        valid: translate('audit.integrity.status_valid', '未被竄改：紀錄內容與簽發時一致'),
        tampered: translate('audit.integrity.status_tampered', '可能已被竄改：紀錄內容或簽章與簽發時不符'),
        unsigned: translate('audit.integrity.status_unsigned_server', '指紋相符，但伺服器未設定簽章金鑰，沒有簽章'),
        unverifiable: translate('audit.integrity.status_unverifiable', '指紋相符；伺服器簽章金鑰已更換，無法驗證簽章'),
        missing: translate('audit.integrity.status_missing_server', '此筆紀錄尚未存到伺服器，沒有伺服器簽章'),
        error: translate('audit.integrity.status_error_server', '無法連線至伺服器驗證'),
        checking: translate('audit.integrity.status_checking', '驗證中…')
    };
    const unsignedReasonText = translate('audit.integrity.reason_server_key_missing', '伺服器未設定 OPEN_PETS_SYSTEM_MASTER_KEY');
    const notAvailableText = translate('audit.integrity.not_available', '未計算（檔案過大或無法讀取）');

    return (
        <div className={className} style={style} data-testid="audit-integrity-panel">
            {/* ★ 2026-10-02：使用者看到「驗證通過」誤以為是合規判定，加註此區只檢查紀錄有無被竄改 */}
            <div style={{ fontWeight: 600, color: '#6b7280' }}>{translate('audit.integrity.section_title', '紀錄防篡改資訊（僅檢查紀錄是否被竄改，與是否符合合規標準無關）')}</div>
            {integrity && isServerIssued ? (
                <>
                    <div>{translate('audit.report_SHA', '數位防篡改指紋 (SHA-256):')} <span style={monoStyle}>{integrity.documentSha256}</span></div>
                    <div>{translate('audit.integrity.input_file', '原始資料檔 SHA-256：')} <span style={monoStyle}>{integrity.inputFileSha256 ?? notAvailableText}</span></div>
                    <div>{translate('audit.integrity.output_file', '去識別化輸出檔 SHA-256：')} <span style={monoStyle}>{integrity.outputFileSha256 ?? notAvailableText}</span></div>
                    <div>
                        {translate('audit.report_signature_label_server', '伺服器簽章：')}
                        {integrity.signature
                            ? <>{integrity.algorithm} ｜ {translate('audit.integrity.key_id', '金鑰 ID')} <span style={monoStyle}>{integrity.keyId}</span> ｜ <span style={monoStyle}>{integrity.signature.slice(0, 44)}…</span></>
                            : <>{translate('audit.integrity.unsigned', '未簽章')}（{unsignedReasonText}）</>}
                    </div>
                    <div>{translate('audit.integrity.signed_at', '簽發時間：')} {new Date(integrity.signedAt ?? '').toLocaleString()}</div>
                </>
            ) : null}
            <div style={{ color: STATUS_COLOR_MAP[statusKey], fontWeight: 600 }} data-testid="audit-integrity-status">
                {translate('audit.integrity.verify_label', '防篡改檢查：')}{statusLabelMap[statusKey]}
            </div>
        </div>
    );
}
