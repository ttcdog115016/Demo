/**
 * ============================================================================
 * 檔案名稱 (File): ComplianceReportDocument.tsx
 * 模組功能 (Description): 隱私合規與風險評估報告本文（Step4「查看與下載報告」與「歷史檢測紀錄」調閱共用）
 * ============================================================================
 * ★ 2026-10-08 使用者反映：Step4 合規報告與歷史檢測紀錄調閱顯示不一致。
 *   原本兩處各自寫一份報告畫面：Step4 為 09-23 改版後的六段式；歷史紀錄仍是舊版（只有三攻擊、
 *   以 20% 判斷顏色的「綜合殘餘風險」），標題、小數位數、綜合風險算法都不同。
 *   改為兩處都用本元件，資料一律取自稽核紀錄（含簽發當下的報告快照 reportSnapshot），內容保證一致。
 *   版面沿用 Step4 報告（比照後端 /api/v1/report 官方報告的樸素風格，固定白底，PDF 不受深色模式影響）。
 *   舊紀錄（無 reportSnapshot）只顯示紀錄裡有的欄位，缺的項目標示「此紀錄建立於舊版，未保存此項」。
 */
import type { CSSProperties, Ref, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuditLogItem } from '../store/useAuditStore';
import AuditIntegrityPanel from './AuditIntegrityPanel';
import { OverallRiskLevelPanel } from './RiskLevelBadge';
import { computeReportOverallRisk, formatEpsilonForDisplay, isCapEvaluated, resolveReportColumnTechText, type ComplianceReportEntry } from '../utils/complianceReport';
import { scaleFontSize } from '../utils/fontScale';
import { formatLossPercent } from '../utils/kAnonymityLossMetric';

export type { ComplianceReportEntry } from '../utils/complianceReport';

interface ComplianceReportDocumentProps {
    /** 稽核紀錄（Step4 為本次簽發的紀錄，歷史頁為選取的紀錄） */
    entry: ComplianceReportEntry;
    /** 匯出 PDF 中：欄位對照表完全展開、不加捲軸 */
    isExportingPdf: boolean;
    /** html2pdf 擷取用的 DOM id */
    containerId: string;
    containerRef?: Ref<HTMLDivElement>;
}

export default function ComplianceReportDocument({ entry, isExportingPdf, containerId, containerRef }: ComplianceReportDocumentProps): ReactElement {
    const { t: translate } = useTranslation();
    const translateText = (key: string, defaultValue: string): string => translate(key, defaultValue);

    const snapshot = entry.reportSnapshot;
    const isNonCompliant = entry.status === 'failed';
    const isKAnonymity = entry.privacyMode === 'k-anonymity';
    const notSavedText = translate('step4.report.not_saved_legacy', '此紀錄建立於舊版，未保存此項');

    const sectionHeadingStyle: CSSProperties = { color: '#000000', fontSize: scaleFontSize(15), fontWeight: 600, marginTop: '24px', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid #d9d9d9' };
    const keyValueRowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: scaleFontSize(13), color: '#333333', padding: '3px 0' };
    const mutedTextStyle: CSSProperties = { fontSize: scaleFontSize(13), color: '#555555', padding: '3px 0' };
    const percentText = (ratio: number): string => `${(ratio * 100).toFixed(2)}%`;

    // 一、專案與檢測權限資訊（2026-09-23 起只保留檔案名稱與保護模式）
    const projectInfoRowsList: { label: string; value: string }[] = [
        { label: translate('step4.report.file_name', '原始檔案名稱：'), value: entry.fileName || 'dataset.csv' },
        { label: translate('step4.report.mode', '保護模式：'), value: isKAnonymity ? translate('step4.report.k_anonymity_value', 'K-匿名化') : translate('step4.report.dp_value', '差分隱私化') }
    ];

    // 二、隱私強化處理配置
    const kConfig = snapshot?.kAnonymityConfig;
    const dpConfig = snapshot?.dpConfig;
    const isCellSuppression = kConfig ? (kConfig.suppressionMethod === 'cell' || kConfig.suppressionMethod === 'cell_suppression') : false;
    const legacyParameterRow = { label: translate('step4.report.parameters_label', '處理參數'), value: entry.parameters || notSavedText };
    const deidConfigRowsList: { label: string; value: string }[] = isKAnonymity
        ? [
            { label: translate('step4.report.deid_technique', '去識別技術'), value: translate('step4.report.k_anonymity_value', 'K-匿名化') },
            ...(kConfig
                ? [
                    { label: translate('step4.report.k_value_label', 'k 值'), value: String(kConfig.kValue) },
                    { label: translate('step4.report.suppress_limit_label', '抑制上限（%）'), value: String(kConfig.maxSuppressionPercent) },
                    { label: translate('step4.report.exceed_behavior_label', '超限行為'), value: kConfig.limitExceededAction === 'stop_and_error' ? translate('step3.stop_and_error', '停止並報錯') : translate('step3.force_suppress', '強制抑制(降效用)') },
                    { label: translate('step4.report.suppress_method_label', '抑制方式'), value: isCellSuppression ? translate('step3.cell_suppression', '值抑制 ') : translate('step3.row_suppression', '列抑制 ') },
                    ...(isCellSuppression
                        ? [{ label: translate('step4.report.cell_fill_label', '值抑制填法'), value: kConfig.cellFillMethod === 'missing' ? translate('step3.cell_fill_missing', '缺失值 (missing)') : translate('step3.cell_fill_star', '星號遮蔽 (star)') }]
                        : [])
                ]
                : [legacyParameterRow])
        ]
        : [
            { label: translate('step4.report.deid_technique', '去識別技術'), value: translate('step4.report.dp_value', '差分隱私化') },
            ...(dpConfig
                ? [
                    { label: translate('step4.report.accumulated_epsilon_label', '已累計 ε'), value: formatEpsilonForDisplay(dpConfig.accumulatedEpsilon) },
                    { label: translate('step4.report.accumulated_delta_label', '已累計 δ'), value: String(dpConfig.accumulatedDelta) },
                    { label: translate('step4.report.default_delta_label', '預設 δ'), value: String(dpConfig.defaultDelta) }
                ]
                : [legacyParameterRow])
        ];
    const attackParams = snapshot?.riskAttackParams;
    const riskAttackParamRowsList: { label: string; value: string }[] = attackParams
        ? [
            { label: translate('step4.report.iter_count_label', '指認性迭代次數'), value: String(attackParams.n_iter) },
            { label: translate('step4.report.ctrl_ratio_label', '控制組比例'), value: String(attackParams.ctrl_ratio) },
            { label: translate('step4.report.seed_label', '亂數種子'), value: String(attackParams.seed) },
            { label: translate('step4.report.subset_size_label', '連結性子集大小'), value: String(attackParams.n_subset) },
            { label: translate('step4.report.repeat_rounds_label', '重複實驗輪數'), value: String(attackParams.n_repeats) },
            { label: translate('step4.report.overlap_ratio_label', '跨輪重疊比例'), value: String(attackParams.overlap_ratio) }
        ]
        : [];
    const privacyConfigRowsList = [...deidConfigRowsList, ...riskAttackParamRowsList];

    // 三、再識別風險：整體等級與 Step4 畫面同一算法（utils/complianceReport.ts）
    const attackRisks = snapshot?.attackRisks ?? null;
    const cap = snapshot?.cap ?? null;
    const isCapEvaluatedStatus = isCapEvaluated(cap);
    const overallRiskSummary = snapshot
        ? computeReportOverallRisk(attackRisks, cap, {
            singling: translate('step4.risk.q_singling', '能否認出是誰'),
            linkability: translate('step4.risk.q_linkability', '能否和其他資料對上'),
            sensitive: translate('step4.risk.q_sensitive', '能否猜出敏感資料')
        })
        : null;
    const overallRiskDriverText = overallRiskSummary
        ? translate('step4.risk.overall_driver', '依各項風險中最高的一項判定：{{label}} {{value}}%', { label: overallRiskSummary.driver.label, value: (overallRiskSummary.driver.value * 100).toFixed(1) })
        : '';
    const isLegacyRiskEvaluated = !snapshot && Boolean(entry.singlingRisk) && entry.singlingRisk !== '未評估';
    const riskNotEvaluatedText = translate('step4.report.risk_not_evaluated', '未評估（尚未設定「敏感欄位」，本次已略過三攻擊與 CAP 風險評估）');

    const utility = snapshot?.utility;

    const renderKeyValueTable = (rowsList: { label: string; value: string }[]) => (
        <div style={{ border: '1px solid #d9d9d9', borderRadius: '4px', marginBottom: '20px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', color: '#000000', backgroundColor: '#ffffff' }}>
                <thead>
                    <tr style={{ backgroundColor: '#f1f5f9' }}>
                        <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 12px', textAlign: 'left', width: '40%', fontSize: scaleFontSize(13) }}>{translate('step4.report.config_item_header', '設定項目')}</th>
                        <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 12px', textAlign: 'left', fontSize: scaleFontSize(13) }}>{translate('step4.report.config_detail_header', '配置細節')}</th>
                    </tr>
                </thead>
                <tbody>
                    {rowsList.map((rowItem, rowIndexNumber) => (
                        <tr key={rowIndexNumber}>
                            <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 12px', fontSize: scaleFontSize(13), color: '#333333', wordBreak: 'break-word' }}>{rowItem.label}</td>
                            <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 12px', fontSize: scaleFontSize(13), color: '#333333', wordBreak: 'break-word' }}>{rowItem.value}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

    return (
        <div id={containerId} ref={containerRef} data-testid="compliance-report-document" style={{ color: '#000000', backgroundColor: '#ffffff', borderRadius: '4px', fontFamily: 'sans-serif', overflow: 'hidden' }}>
            {/* 頂部深色品牌列，固定樣式不受畫面明／暗主題影響 */}
            <div className="pdf-page-break" style={{ background: '#1f2937', color: '#ffffff', padding: '14px 24px', fontSize: scaleFontSize(12), pageBreakInside: 'avoid' }}>
                {isNonCompliant
                    ? translate('step4.report.brand_bar_non_compliant', '通用去識別化與隱私保護系統 - 安全驗證檢測紀錄')
                    : translate('step4.report.brand_bar', '通用去識別化與隱私保護系統 - 安全驗證與合規稽核報告')}
            </div>

            <div style={{ padding: '24px' }}>
                <div className="pdf-page-break" style={{ textAlign: 'center', marginBottom: '8px', pageBreakInside: 'avoid' }}>
                    <h2 style={{ margin: '12px 0 4px', color: isNonCompliant ? '#b91c1c' : '#000000', fontSize: scaleFontSize(21) }}>
                        {isNonCompliant
                            ? translate('step4.report.header_non_compliant', '隱私風險評估檢測紀錄（未達合規標準）')
                            : translate('step4.report.header', '隱私合規與風險評估報告')}
                    </h2>
                    <div style={{ fontSize: scaleFontSize(12), color: '#555555' }}>
                        {translate('step4.report.cert_id', '報告編號:')} {entry.certificateId} ｜ {translate('step4.report.audit_time', '產出時間:')} {entry.auditTime}
                    </div>
                </div>
                {isNonCompliant && (
                    <div style={{ margin: '12px 0 4px', padding: '10px 14px', border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: '4px', fontSize: scaleFontSize(13) }}>
                        {translate('step4.report.non_compliant_notice', '本次處理結果未達合規標準，此紀錄僅供檢視調整依據，不得作為合規證明，亦不提供去識別化資料與 PDF 下載。')}
                    </div>
                )}

                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, marginTop: '20px', pageBreakInside: 'avoid' }}>一、 {translate('step4.report.info_title', '專案與檢測權限資訊')}</h4>
                {renderKeyValueTable(projectInfoRowsList)}

                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>二、 {translate('step4.report.privacy_config_title', '隱私強化處理配置')}</h4>
                {renderKeyValueTable(privacyConfigRowsList)}

                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>三、 {translate('step4.report.risk_title', '再識別風險量測結果')}</h4>
                <div className="pdf-page-break" data-testid="compliance-report-risk" style={{ marginBottom: '20px', pageBreakInside: 'avoid' }}>
                    {snapshot ? (
                        <>
                            {attackRisks ? (
                                <>
                                    <div style={keyValueRowStyle}><span>{translate('step4.report.singling_risk', '指認性攻擊成功率 (Singling Out)：')}</span><span>{percentText(attackRisks.singling)}</span></div>
                                    <div style={keyValueRowStyle}><span>{translate('step4.report.linkability_risk', '連結性攻擊成功率 (Linkability)：')}</span><span>{percentText(attackRisks.linkability)}</span></div>
                                    <div style={keyValueRowStyle}><span>{translate('step4.report.inference_risk', '推斷性攻擊成功率 (Inference)：')}</span><span>{percentText(attackRisks.inference)}</span></div>
                                </>
                            ) : (
                                <div style={mutedTextStyle}>{riskNotEvaluatedText}</div>
                            )}
                            {cap && isCapEvaluatedStatus ? (
                                <>
                                    <div style={keyValueRowStyle}><span>{translate('step4.report.cap_before_label', '處理前歸因機率 (CAP Before)：')}</span><span>{percentText(cap.cap_before)}</span></div>
                                    <div style={keyValueRowStyle}><span>{translate('step4.report.cap_after_label', '處理後歸因機率 (CAP After)：')}</span><span>{percentText(cap.cap_after)}</span></div>
                                    {typeof cap.cap_baseline_after === 'number' && typeof cap.cap_after_excess === 'number' && (
                                        <>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.cap_baseline_label', '亂猜基線（敏感欄位打亂後的 CAP）：')}</span><span>{percentText(cap.cap_baseline_after)}</span></div>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.cap_excess_label', '敏感資料猜中風險（扣除亂猜基線）：')}</span><span>{percentText(cap.cap_after_excess)}</span></div>
                                        </>
                                    )}
                                    {typeof cap.cap_baseline_after === 'number' && cap.cap_after_excess === null && (
                                        <div style={keyValueRowStyle}><span>{translate('step4.report.cap_excess_label', '敏感資料猜中風險（扣除亂猜基線）：')}</span><span>{translate('step4.report.cap_excess_not_applicable', '不適用（間接識別欄位幾乎每筆都不同，以推斷性攻擊為準）')}</span></div>
                                    )}
                                </>
                            ) : (
                                <div style={mutedTextStyle}>
                                    {translate('step4.report.cap_not_evaluated', '未評估（間接識別碼或敏感欄位設定不足，或限定條件篩選後無資料）')}
                                    {cap?.message && (
                                        <div style={{ marginTop: '4px', fontSize: scaleFontSize(12) }}>
                                            {translate('step4.report.cap_backend_message_prefix', '後端回應原因：')}{cap.message}
                                        </div>
                                    )}
                                </div>
                            )}
                            {overallRiskSummary && (
                                <div style={{ marginTop: '10px', padding: '12px', border: `1px solid ${overallRiskSummary.info.color}`, borderRadius: '6px' }}>
                                    <OverallRiskLevelPanel
                                        summary={overallRiskSummary}
                                        title={translate('step4.risk.overall_title', '整體風險等級')}
                                        driverText={overallRiskDriverText}
                                        textColor="#333333"
                                        mutedColor="#666666"
                                        trackColor="#e5e7eb"
                                    />
                                </div>
                            )}
                        </>
                    ) : isLegacyRiskEvaluated ? (
                        <>
                            <div style={keyValueRowStyle}><span>{translate('step4.report.singling_risk', '指認性攻擊成功率 (Singling Out)：')}</span><span>{entry.singlingRisk}</span></div>
                            <div style={keyValueRowStyle}><span>{translate('step4.report.linkability_risk', '連結性攻擊成功率 (Linkability)：')}</span><span>{entry.linkabilityRisk}</span></div>
                            <div style={keyValueRowStyle}><span>{translate('step4.report.inference_risk', '推斷性攻擊成功率 (Inference)：')}</span><span>{entry.inferenceRisk}</span></div>
                            <div style={mutedTextStyle}>{translate('step4.report.legacy_cap_note', 'CAP 前後對比與整體風險等級：')}{notSavedText}</div>
                        </>
                    ) : (
                        <div style={mutedTextStyle}>{riskNotEvaluatedText}</div>
                    )}
                </div>

                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>四、 {translate('step4.report.utility_title', '資料效用與失真度評估')}</h4>
                <div className="pdf-page-break" data-testid="compliance-report-utility" style={{ marginBottom: '20px', pageBreakInside: 'avoid' }}>
                    {utility ? (
                        <>
                            <div style={keyValueRowStyle}>
                                <span>{isKAnonymity ? translate('step4.report.suppression', '資料紀錄抑制率：') : translate('step4.report.total_epsilon', '總消耗隱私預算 (Epsilon)：')}</span>
                                <span>{isKAnonymity ? `${(utility.suppressionRatePercent ?? 0).toFixed(3)}%` : `${formatEpsilonForDisplay(utility.consumedEpsilon ?? 0)} ε`}</span>
                            </div>
                            <div style={keyValueRowStyle}>
                                <span>{translate('step4.report.total_cols', '實際去識別數 / 總欄位數：')}</span><span>{utility.deidentifiedColumnsCount} / {utility.totalColumnsCount}</span>
                            </div>
                            {isKAnonymity && utility.informationLoss && (
                                <div style={keyValueRowStyle}>
                                    <span>{translate('step4.report.information_loss', '整體失真程度：')}</span>
                                    <span>{formatLossPercent(utility.informationLoss.overall)}</span>
                                </div>
                            )}
                        </>
                    ) : (
                        <div style={mutedTextStyle}>{translate('step4.report.legacy_utility_note', '抑制率／隱私預算與去識別欄位數：')}{notSavedText}</div>
                    )}
                    {typeof entry.inputRowCount === 'number' && (
                        <div style={keyValueRowStyle}>
                            <span>{translate('step4.report.row_stats', '資料筆數（輸入/刪除/輸出）：')}</span>
                            <span>{entry.inputRowCount.toLocaleString()} / {entry.deletedRowCount.toLocaleString()} / {entry.outputRowCount.toLocaleString()}</span>
                        </div>
                    )}
                </div>

                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>五、 {translate('step4.report.table_title', '欄位處置與技術對照表')}</h4>
                <div style={{ maxHeight: isExportingPdf ? 'none' : '240px', overflowY: isExportingPdf ? 'visible' : 'auto', border: '1px solid #d9d9d9', borderRadius: '4px', marginBottom: '20px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', color: '#000000', backgroundColor: '#ffffff', tableLayout: 'fixed' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#f1f5f9', position: isExportingPdf ? 'static' : 'sticky', top: 0, zIndex: 1, pageBreakInside: 'avoid' }}>
                                <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '40%' }}>{translate('step4.report.col_name', '欄位名稱')}</th>
                                <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{translate('step4.report.col_role', '隱私角色')}</th>
                                <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{translate('step4.report.col_tech', '套用去識別化技術')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(entry.columnsSnapshot || []).map((columnNameString) => {
                                const { role, techText } = resolveReportColumnTechText(entry, columnNameString, translateText);
                                const roleI18nKeyString = `step4.role.${role.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')}`;
                                return (
                                    <tr key={columnNameString} style={{ backgroundColor: '#ffffff', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                                        <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#000000', wordBreak: 'break-word' }}><b>{columnNameString}</b></td>
                                        <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{translate(roleI18nKeyString, role)}</td>
                                        <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{techText}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>六、 {translate('step4.report.measurement_note_title', '量測說明')}</h4>
                <div className="pdf-page-break" style={{ fontSize: scaleFontSize(12), color: '#555555', marginBottom: '20px', pageBreakInside: 'avoid' }}>
                    {attackRisks ? (
                        <div style={{ marginBottom: '4px' }}>
                            {translate('step4.report.measurement_note_attack', '三攻擊風險評估完成。指認性風險: {{singling}}, 連結性風險: {{linkability}}, 推斷性風險: {{inference}}。', {
                                singling: attackRisks.singling.toFixed(2),
                                linkability: attackRisks.linkability.toFixed(2),
                                inference: attackRisks.inference.toFixed(2)
                            })}
                        </div>
                    ) : isLegacyRiskEvaluated ? (
                        <div style={{ marginBottom: '4px' }}>
                            {translate('step4.report.measurement_note_attack', '三攻擊風險評估完成。指認性風險: {{singling}}, 連結性風險: {{linkability}}, 推斷性風險: {{inference}}。', {
                                singling: entry.singlingRisk,
                                linkability: entry.linkabilityRisk,
                                inference: entry.inferenceRisk
                            })}
                        </div>
                    ) : (
                        <div>{translate('step4.report.measurement_note_not_evaluated', '尚未設定「敏感欄位」，本次已略過三攻擊與 CAP 風險評估，故無量測結果可供說明。')}</div>
                    )}
                    {cap && isCapEvaluatedStatus && (
                        <div>
                            {translate('step4.report.measurement_note_cap', 'CAP 前後對比完成。處理前: {{before}}, 處理後: {{after}}。', {
                                before: cap.cap_before.toFixed(2),
                                after: cap.cap_after.toFixed(2)
                            })}
                        </div>
                    )}
                </div>

                {/* 防篡改指紋與數位簽章（見 components/AuditIntegrityPanel） */}
                <AuditIntegrityPanel
                    entry={entry.id ? (entry as AuditLogItem) : undefined}
                    className="pdf-page-break"
                    style={{ textAlign: 'left', marginTop: '16px', borderTop: '1px dashed #d9d9d9', paddingTop: '12px', fontSize: scaleFontSize(12), color: '#888888', pageBreakInside: 'avoid', lineHeight: 1.7 }}
                />
            </div>
        </div>
    );
}
