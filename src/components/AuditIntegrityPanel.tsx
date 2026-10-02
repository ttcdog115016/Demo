/**
 * 稽核憑證「防篡改指紋與數位簽章」區塊（AuditLogHub 憑證調閱視窗、Step4 合規報告共用）。
 * ★ 2026-10-02：取代寫死的假指紋與假簽章，改顯示 utils/auditIntegrity.ts 產生的真實值，並即時驗證。
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
    valid: '#15803d', tampered: '#b91c1c', unsigned: '#b45309', unsupported: '#b45309', missing: '#6b7280', error: '#b91c1c', checking: '#6b7280'
};

const monoStyle: React.CSSProperties = { fontFamily: 'Consolas, "Courier New", monospace', wordBreak: 'break-all' };

export default function AuditIntegrityPanel({ entry, style, className }: AuditIntegrityPanelProps): ReactElement {
    const { t: translate } = useTranslation();
    // 驗證結果連同「驗證的是哪一筆」一起存，切換到別筆時舊結果自動失效（顯示「驗證中」），不需在 effect 內重設 state
    const [verificationState, setVerificationState] = useState<{ entry: AuditLogItem; result: AuditVerificationResult } | null>(null);
    const verificationResult = entry && verificationState?.entry === entry ? verificationState.result : null;

    useEffect(() => {
        if (!entry) return undefined;
        let isCancelled = false;
        verifyAuditIntegrity(entry).then((result) => { if (!isCancelled) setVerificationState({ entry, result }); });
        return () => { isCancelled = true; };
    }, [entry]);

    const integrity = entry?.integrity;
    const statusKey = !entry ? 'missing' : (verificationResult?.status ?? 'checking');
    const statusLabelMap: Record<string, string> = {
        valid: translate('audit.integrity.status_valid', '驗證通過：內容自簽發後未被改動'),
        tampered: translate('audit.integrity.status_tampered', '驗證失敗：憑證內容或簽章與簽發時不符，可能已被竄改'),
        unsigned: translate('audit.integrity.status_unsigned', '僅有指紋、未簽章（簽發時環境不支援簽章）'),
        unsupported: translate('audit.integrity.status_unsupported', '指紋相符；目前環境無法驗證簽章（請以 HTTPS 或 localhost 開啟）'),
        missing: translate('audit.integrity.status_missing', '此筆紀錄沒有防篡改資料（舊版紀錄或尚未簽發）'),
        error: translate('audit.integrity.status_error', '驗證時發生錯誤'),
        checking: translate('audit.integrity.status_checking', '驗證中…')
    };
    const unsignedReasonText = integrity?.unsignedReason === 'insecure_context'
        ? translate('audit.integrity.reason_insecure', '目前不是以 HTTPS 或 localhost 開啟，瀏覽器不提供簽章功能')
        : translate('audit.integrity.reason_failed', '簽章過程發生錯誤');
    const notAvailableText = translate('audit.integrity.not_available', '未計算（檔案過大或無法讀取）');

    return (
        <div className={className} style={style} data-testid="audit-integrity-panel">
            {integrity ? (
                <>
                    <div>{translate('audit.report_SHA', '數位防篡改指紋 (SHA-256):')} <span style={monoStyle}>{integrity.documentSha256}</span></div>
                    <div>{translate('audit.integrity.input_file', '原始資料檔 SHA-256：')} <span style={monoStyle}>{integrity.inputFileSha256 ?? notAvailableText}</span></div>
                    <div>{translate('audit.integrity.output_file', '去識別化輸出檔 SHA-256：')} <span style={monoStyle}>{integrity.outputFileSha256 ?? notAvailableText}</span></div>
                    <div>
                        {translate('audit.report_signature_label', '系統數位簽章：')}
                        {integrity.signature
                            ? <>{integrity.algorithm} ｜ {translate('audit.integrity.key_id', '金鑰 ID')} <span style={monoStyle}>{integrity.keyId}</span> ｜ <span style={monoStyle}>{integrity.signature.slice(0, 44)}…</span></>
                            : <>{translate('audit.integrity.unsigned', '未簽章')}（{unsignedReasonText}）</>}
                    </div>
                    <div>{translate('audit.integrity.signed_at', '簽發時間：')} {new Date(integrity.signedAt).toLocaleString()}</div>
                </>
            ) : null}
            <div style={{ color: STATUS_COLOR_MAP[statusKey], fontWeight: 600 }} data-testid="audit-integrity-status">
                {translate('audit.integrity.verify_label', '完整性驗證：')}{statusLabelMap[statusKey]}
                {verificationResult?.status === 'valid' && verificationResult.signedByThisBrowser === false && (
                    <span style={{ fontWeight: 400, color: '#6b7280' }}>{translate('audit.integrity.other_browser', '（由其他瀏覽器的金鑰簽發）')}</span>
                )}
            </div>
        </div>
    );
}
