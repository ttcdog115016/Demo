/**
 * ============================================================================
 * 檔案名稱 (File): AuditLogHub.tsx
 * 模組功能 (Description): 歷史審計軌跡與憑證數據庫檢視組件 (提供歷次脫敏發布軌跡查詢、統計與 PDF 憑證調閱匯出)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) 說明性檔案與原始檔案開頭註記, 變數函數與程序撰寫參考 a)~h)
 * ============================================================================
 */

import { useState, useMemo } from 'react';
import { 
	Card, Table, Tag, Input, Select, Button, Space, Typography, 
	Statistic, Row, Col, Modal, theme, App as AntdApp, Tooltip
} from 'antd';
import { 
	SearchOutlined, FileTextOutlined, 
	 SafetyCertificateOutlined,
	 FilterOutlined, DownloadOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { getRoleDisplayName } from '../../utils/roleLabel';

import { useAuditStore, type AuditLogItem } from '../../store/useAuditStore';
import AuditIntegrityPanel from '../../components/AuditIntegrityPanel';
import { getKAnonymityGeneralizationTechLabel } from '../../utils/kAnonymityTechLabel';

import { scaleFontSize } from '../../utils/fontScale';
/**
 * 預設常數宣告
 * 規範對照: 符合規範 e) 避免魔術數字 (Magic Number)
 */
const DEFAULT_PAGE_SIZE = 10;
const HIGH_RISK_THRESHOLD_PERCENT = 20;
const PDF_COMPILATION_DELAY_MS = 400;

/**
 * html2pdf 套件之方法型別介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface Html2Pdf 
{
	set: (options: Record<string, unknown>) => Html2Pdf; // 設定 PDF 編譯參數
	from: (element: HTMLElement | null) => Html2Pdf;  // 綁定待繪製之 DOM 元素
	save: () => Promise<void>;                       // 執行下載儲存動作
}

/**
 * 擴充 Window 物件介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface WindowWithHtml2Pdf extends Window 
{
	html2pdf: () => Html2Pdf; // 動態載入之 html2pdf 實例建立函式
}

const { Text, Title } = Typography;

/**
 * 函數名稱: AuditLogHub
 * 函數功能: 渲染歷史審計軌跡儀表板，提供關鍵 KPI 統計、歷史憑證條件搜尋過濾，以及 Modal 彈窗調閱與高畫質 PDF 審計憑證匯出功能。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 歷史審計軌跡頁面 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 
 *   - 被 AppRouter 主路由組件載入渲染
 *   - 訂閱用 useAuditStore (歷史紀錄，欄位結構已隨紀錄一併快照儲存)
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function AuditLogHub(): React.ReactElement 
{
	const { token } = theme.useToken();

	const { message: messageApi } = AntdApp.useApp();

	const { t: translate } = useTranslation();

	const auditLogsList = useAuditStore(
		(state) => state.auditLogs
	);
	
	const [searchKeywordText, setSearchKeywordText] = useState<string>('');

	const [privacyFilterMode, setPrivacyFilterMode] = useState<string>('all'); 

	const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLogItem | null>(null); 

	const [isReportModalVisible, setIsReportModalVisible] = useState<boolean>(false); 

	const [isPdfExporting, setIsPdfExporting] = useState<boolean>(false); 

	// 過濾符合搜尋與過濾條件之日誌 (符合規範 c, d)
	const filteredAuditLogsList = useMemo(
		() => 
		{
			return auditLogsList.filter(
				(logItemRecord) => 
				{
					const lowerCaseSearchKeyword = searchKeywordText.toLowerCase();

					const isSearchKeywordMatched = 
						logItemRecord.certificateId.toLowerCase().includes(lowerCaseSearchKeyword) ||
						logItemRecord.fileName.toLowerCase().includes(lowerCaseSearchKeyword) ||
						logItemRecord.operator.toLowerCase().includes(lowerCaseSearchKeyword);

					const isPrivacyModeMatched = privacyFilterMode === 'all' || logItemRecord.privacyMode === privacyFilterMode;

					return isSearchKeywordMatched && isPrivacyModeMatched;
				}
			);
		}, 
		[auditLogsList, searchKeywordText, privacyFilterMode]
	);

	// 計算 KPI 統計數據 (符合規範 c, d)
	const auditDashboardStatistics = useMemo(
		() => 
		{
			const totalAuditLogsCount = auditLogsList.length;

			const passedAuditLogsCount = auditLogsList.filter(
				(logItemRecord) => logItemRecord.status === 'passed'
			).length;

			return {
				totalCount: totalAuditLogsCount,
				passedRatePercent: totalAuditLogsCount > 0 ? ((passedAuditLogsCount / totalAuditLogsCount) * 100).toFixed(0) : '100',
			};
		}, 
		[auditLogsList]
	);

	/**
	 * 函數名稱: handleOpenCertificate
	 * 函數功能: 點擊操作列之「調閱憑證」按鈕時，設定當前目標憑證並開啟 Modal 彈窗。
	 * 
	 * 輸入參數 (Input):
	 *   - targetLogItemRecord (AuditLogItem): 被選取之歷史審計紀錄物件
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 */
	const handleOpenCertificate = (targetLogItemRecord: AuditLogItem): void => 
	{
		setSelectedAuditLog(targetLogItemRecord);

		setIsReportModalVisible(true);
	};

	/**
	 * 函數名稱: handleDownloadPDF
	 * 函數功能: 動態載入 html2pdf.js 套件，將 DOM 節點 (#printable-historical-report) 轉繪編譯為 A4 格式 PDF 憑證並啟動下載。
	 * 
	 * 輸入參數 (Input): 無
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): Promise<void>
	 * 
	 * 規範對照: 符合規範 g) 處理所有異常防護與 Promise 錯誤
	 */
	const handleDownloadPDF = async (): Promise<void> => 
	{
		if (selectedAuditLog?.status === 'failed') return; // 未達合規標準的紀錄不提供 PDF 匯出
		const targetPrintDomElement = document.getElementById('printable-historical-report');

		if (!targetPrintDomElement) 
		{
			return;
		}
		
		const hideLoadingMessageFunction = messageApi.loading(
			translate('audit.msg_pdf_compiling', '正在編譯高畫質 PDF，請稍候...'), 
			0
		);

		setIsPdfExporting(true);
		
		await new Promise(
			(resolveDelay) => setTimeout(resolveDelay, PDF_COMPILATION_DELAY_MS)
		);

		const html2pdfScriptElement = document.createElement('script');

		html2pdfScriptElement.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
		
		html2pdfScriptElement.onload = () => 
		{
			const pdfCompilationOptions = {
				margin:      [10, 10, 10, 10], 
				filename:    `Historical_Audit_Certificate_${selectedAuditLog?.certificateId}.pdf`,
				image:       { type: 'jpeg', quality: 0.98 },
				html2canvas: { 
					scale: 2, 
					useCORS: true, 
					backgroundColor: '#ffffff',
					scrollY: 0,
					scrollX: 0
				},
				jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
				pagebreak:   { mode: ['avoid-all', 'css', 'legacy'], avoid: ['tr', '.pdf-page-break', '.avoid-break'] }
			};

			(window as unknown as WindowWithHtml2Pdf).html2pdf().set(pdfCompilationOptions).from(targetPrintDomElement).save().then(
				() => 
				{
					hideLoadingMessageFunction();

					messageApi.success(
						translate('audit.msg_pdf_success', '歷史審計憑證 PDF 已成功下載！')
					);
				}
			).catch(
				(pdfExecutionError: unknown) => 
				{
					hideLoadingMessageFunction();

					messageApi.error(
						translate('audit.msg_pdf_failed', 'PDF 下載失敗')
					);

					console.error(pdfExecutionError);
				}
			).finally(
				() => 
				{
					setIsPdfExporting(false);
				}
			);
		};
		
		html2pdfScriptElement.onerror = () => 
		{
			hideLoadingMessageFunction();

			messageApi.error(
				translate('audit.msg_pdf_no_lib', '無法載入 PDF 轉檔套件，請檢查網路連線。')
			);

			setIsPdfExporting(false);
		};
		
		document.body.appendChild(html2pdfScriptElement);
	};

	/**
	 * 函數名稱: getSnapshotRole
	 * 函數功能: 從歷史審計紀錄自身之欄位角色快照 (columnRoleSnapshot) 讀取該欄位簽發當下所套用之隱私角色，
	 *           不依賴目前 WorkspaceStore 狀態，確保歷史紀錄檢視結果不受後續操作 (清空/切換資料集) 影響。
	 *
	 * 輸入參數 (Input):
	 *   - targetAuditLogItem (AuditLogItem): 目前選取之歷史審計紀錄物件
	 *   - targetColumnName (string): 欄位名稱
	 * 輸出參數 (Output): 無
	 * 返回值 (Return):
	 *   - { role: string }: 包含簽發當下隱私角色名稱之物件
	 */
	const getSnapshotRole = (targetAuditLogItem: AuditLogItem, targetColumnName: string): { role: string } =>
	{
		return { role: targetAuditLogItem.columnRoleSnapshot?.[targetColumnName] || 'Non-sensitive' };
	};

	// 儀表板資料表格欄位配置
	const dataTableColumnsConfig = [
		{
			title: translate('audit.col_cert_id', '憑證編號'),
			dataIndex: 'certificateId',
			key: 'certificateId',
			render: (certificateIdTextString: string) => (
				<Text strong style={{ color: token.colorPrimary }}>{certificateIdTextString}</Text>
			),
		},
		{
			title: translate('audit.col_file_name', '處置檔案名稱'),
			dataIndex: 'fileName',
			key: 'fileName',
			render: (fileNameTextString: string) => <Text style={{ fontSize: scaleFontSize(13) }}>{fileNameTextString}</Text>,
		},
		{
			title: translate('audit.col_privacy_mode', '保護模式'),
			dataIndex: 'privacyMode',
			key: 'privacyMode',
			render: (privacyModeNameString: string) => (
				<Tag color={privacyModeNameString === 'k-anonymity' ? 'blue' : 'purple'}>
					{privacyModeNameString === 'k-anonymity' ? 'K-Anonymity' : 'Differential Privacy'}
				</Tag>
			),
		},
		{
			title: translate('audit.col_operator', '操作者 / 角色'),
			key: 'operator',
			render: (_: unknown, auditLogRecordItem: AuditLogItem) => (
				<div>
					<Text strong style={{ fontSize: scaleFontSize(13), display: 'block' }}>{auditLogRecordItem.operator}</Text>
					<Tag style={{ fontSize: scaleFontSize(10), margin: 0 }}>{getRoleDisplayName(auditLogRecordItem.operatorRole)}</Tag>
				</div>
			),
		},
		{
			title: translate('audit.col_risks', '三大攻擊殘餘風險 (Singling/Link/Inf)'),
			key: 'risks',
			render: (_: unknown, auditLogRecordItem: AuditLogItem) => (
				<Space size="small">
					<Tag color="green">{translate('audit.risk_singling', '指認')}: {auditLogRecordItem.singlingRisk}</Tag>
					<Tag color="green">{translate('audit.risk_linkability', '連結')}: {auditLogRecordItem.linkabilityRisk}</Tag>
					<Tag color="green">{translate('audit.risk_inference', '推斷')}: {auditLogRecordItem.inferenceRisk}</Tag>
				</Space>
			),
		},
		{
			title: translate('audit.col_overall_risk', '綜合殘餘風險'),
			dataIndex: 'overallRisk',
			key: 'overallRisk',
			render: (overallRiskValueTextString: string) => (
				<Text strong style={{ color: parseFloat(overallRiskValueTextString) < HIGH_RISK_THRESHOLD_PERCENT ? '#52c41a' : '#faad14' }}>
					{overallRiskValueTextString}
				</Text>
			),
		},
		{
			title: translate('audit.col_audit_time', '審計時間'),
			dataIndex: 'auditTime',
			key: 'auditTime',
			render: (auditTimeStringValue: string) => <Text type="secondary" style={{ fontSize: scaleFontSize(12) }}>{auditTimeStringValue}</Text>,
		},
		{
			title: translate('audit.col_action', '操作與調閱'),
			key: 'action',
			align: 'center' as const,
			render: (_: unknown, auditLogRecordItem: AuditLogItem) => (
				<Button 
					type="link" 
					icon={<FileTextOutlined />} 
					onClick={() => handleOpenCertificate(auditLogRecordItem)}
				>
					{translate('audit.btn_view_cert', '調閱憑證')}
				</Button>
			),
		},
	];

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
			
			<Row gutter={24}>
				<Col span={8}>
					<Card variant="borderless" style={{ background: token.colorBgContainer }}>
						<Statistic 
							title={translate('audit.stats_total', '累積合規簽發憑證總數')} 
							value={auditDashboardStatistics.totalCount} 
							prefix={<SafetyCertificateOutlined style={{ color: token.colorPrimary }} />} 
							suffix={translate('audit.unit_certificates', '份')}
						/>
					</Card>
				</Col>

			</Row>

			<Card variant="borderless" style={{ background: token.colorBgContainer }}>
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
					<Title level={4} style={{ margin: 0 }}>
						<FilterOutlined style={{ marginRight: 8, color: token.colorPrimary }} />
						{translate('audit.hub_title', '歷史審計軌跡與憑證數據庫 (Audit Logs & Certificates Hub)')}
					</Title>

					<Space>
						<Input 
							placeholder={translate('audit.search_placeholder', '搜尋憑證編號、檔案名稱、操作者...')} 
							prefix={<SearchOutlined />} 
							value={searchKeywordText}
							onChange={(inputEvent) => setSearchKeywordText(inputEvent.target.value)}
							style={{ width: '280px' }}
							allowClear
						/>

						<Select 
							value={privacyFilterMode} 
							onChange={(selectedFilterModeValue) => setPrivacyFilterMode(selectedFilterModeValue)}
							style={{ width: '180px' }}
							options={[
								{ value: 'all', label: translate('audit.filter_all', '全部保護模式') },
								{ value: 'k-anonymity', label: 'K-Anonymity' },
								{ value: 'differential-privacy', label: 'Differential Privacy' },
							]}
						/>
					</Space>
				</div>

				<Table 
					dataSource={filteredAuditLogsList}
					columns={dataTableColumnsConfig}
					rowKey="id"
					pagination={{ pageSize: DEFAULT_PAGE_SIZE }}
					size="middle"
					scroll={{ x: 'max-content' }}
				/>
			</Card>

			{/* 歷史審計憑證調閱 Modal */}
			<Modal
				title={translate('audit.modal_title', '歷史審計憑證調閱 (Historical Certificate Viewer)')}
				open={isReportModalVisible}
				onCancel={() => setIsReportModalVisible(false)}
				width={800}
				styles={{
					body: { 
						maxHeight: isPdfExporting ? 'none' : '72vh', 
						overflowY: isPdfExporting ? 'visible' : 'auto', 
						paddingRight: '6px' 
					}
				}}
				footer={[
					<Button key="close" onClick={() => setIsReportModalVisible(false)}>{translate('audit.btn_close', '關閉')}</Button>,
					// ★ 2026-10-02：未達合規標準的紀錄不提供 PDF 匯出
					<Tooltip key="print" title={selectedAuditLog?.status === 'failed' ? translate('audit.export_blocked_failed', '此筆紀錄未達合規標準，不提供 PDF 匯出。') : undefined}>
						<Button type="primary" icon={<DownloadOutlined />} loading={isPdfExporting} disabled={selectedAuditLog?.status === 'failed'} onClick={handleDownloadPDF} style={selectedAuditLog?.status === 'failed' ? undefined : { background: '#4F46E5' }}>
							{translate('audit.btn_export_pdf', '匯出 PDF 憑證')}
						</Button>
					</Tooltip>
				]}
			>
				{selectedAuditLog && (
					<div 
						id="printable-historical-report" 
						style={{ 
							padding: isPdfExporting ? '0px' : '24px', 
							color: '#000000', 
							backgroundColor: '#ffffff', 
							borderRadius: '4px',
							fontFamily: 'sans-serif'
						}}
					>
						{/* 
						  * 渲染憑證標頭區塊：包含憑證編號與驗證合格狀態標籤 
						  */}
						<div className="pdf-page-break avoid-break" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${token.colorPrimary}`, paddingBottom: '12px', marginBottom: '24px', pageBreakInside: 'avoid' }}>
							<div>
								<h2 style={{ margin: 0, color: selectedAuditLog.status === 'failed' ? '#b91c1c' : token.colorPrimary, fontSize: scaleFontSize(20) }}>
									{selectedAuditLog.status === 'failed'
										? translate('audit.report_title_failed', '資料隱私技術檢測紀錄（未達合規標準）')
										: translate('audit.report_title', '數據隱私合規與技術審計憑證')}
								</h2>
								<span style={{ fontSize: scaleFontSize(12), color: '#555555' }}>{translate('audit.report_cert_id', '憑證編號:')} {selectedAuditLog.certificateId}</span>
							</div>

							{/* ★ 2026-10-02：原本不論結果一律顯示「驗證合格」，改依紀錄狀態顯示 */}
							<div style={{ textAlign: 'right' }}>
								<span 
									style={{ 
										display: 'inline-block',
										backgroundColor: selectedAuditLog.status === 'failed' ? '#fef2f2' : '#f6ffed', 
										border: selectedAuditLog.status === 'failed' ? '1px solid #fca5a5' : '1px solid #b7eb8f', 
										color: selectedAuditLog.status === 'failed' ? '#b91c1c' : '#389e0d', 
										padding: '6px 16px', 
										borderRadius: '4px', 
										fontSize: scaleFontSize(14), 
										fontWeight: 'bold',
										lineHeight: '20px',
										whiteSpace: 'nowrap'
									}}
								>
									{selectedAuditLog.status === 'failed'
										? <><span style={{ marginRight: '6px', fontSize: scaleFontSize(15) }}>✕</span> {translate('audit.report_failed', '未達合規標準')}</>
										: <><span style={{ marginRight: '6px', fontSize: scaleFontSize(15) }}>✓</span> {translate('audit.report_passed', '驗證合格')}</>}
								</span>
							</div>
						</div>

						{/* 
						  * 渲染專案與執行軌跡資訊：從 selectedAuditLog 讀取檔案名稱、保護模式、操作人員與簽發時間 
						  */}
						<div className="pdf-page-break avoid-break" style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '24px', border: `1px solid #d9d9d9`, pageBreakInside: 'avoid' }}>
							<h4 style={{ marginTop: 0, color: '#000000', marginBottom: '8px' }}>{translate('audit.report_track_title', '專案與執行軌跡')}</h4>

							<Row gutter={[16, 8]} style={{ fontSize: scaleFontSize(13), color: '#555555' }}>
								<Col span={12}><b style={{ color: '#000000' }}>{translate('audit.report_file_name', '資料檔案：')}</b> {selectedAuditLog.fileName}</Col>
								<Col span={12}><b style={{ color: '#000000' }}>{translate('audit.report_tech', '套用技術：')}</b> {selectedAuditLog.privacyMode.toUpperCase()}</Col>
								<Col span={12}><b style={{ color: '#000000' }}>{translate('audit.report_operator', '執行人員：')}</b> {selectedAuditLog.operator} ({getRoleDisplayName(selectedAuditLog.operatorRole)})</Col>
								<Col span={12}><b style={{ color: '#000000' }}>{translate('audit.report_time', '簽發時間：')}</b> {selectedAuditLog.auditTime}</Col>
							</Row>
						</div>

						{/* 
						  * 渲染殘餘風險量測結果：展示指認性、連結性、推斷性風險，以及最終綜合風險百分比 
						  */}
						<div className="pdf-page-break avoid-break" style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '32px', border: `1px solid #d9d9d9`, pageBreakInside: 'avoid', clear: 'both' }}>
							<h4 style={{ marginTop: 0, color: '#000000', marginBottom: '8px' }}>{translate('audit.report_risk_title', '殘餘風險與量測結果')}</h4>

							<Row gutter={[16, 8]} style={{ fontSize: scaleFontSize(13), color: '#555555' }}>
								<Col span={12}><b style={{ color: '#000000' }}>{translate('audit.report_singling', '指認性風險 (Singling Out):')}</b> <span>{selectedAuditLog.singlingRisk}</span></Col>
								<Col span={12}><b style={{ color: '#000000' }}>{translate('audit.report_linkability', '連結性風險 (Linkability):')}</b> <span>{selectedAuditLog.linkabilityRisk}</span></Col>
								<Col span={12}><b style={{ color: '#000000' }}>{translate('audit.report_inference', '推斷性風險 (Inference):')}</b> <span>{selectedAuditLog.inferenceRisk}</span></Col>
								<Col span={12}>
									<b style={{ color: '#000000' }}>{translate('audit.report_overall_risk', '綜合殘餘風險 (Final Risk):')}</b>{' '}
									<span style={{ color: parseFloat(selectedAuditLog.overallRisk) < HIGH_RISK_THRESHOLD_PERCENT ? '#389e0d' : '#faad14', fontWeight: 'bold' }}>
										{selectedAuditLog.overallRisk}
									</span>
								</Col>
								{typeof selectedAuditLog.inputRowCount === 'number' && (
									<Col span={24}>
										<b style={{ color: '#000000' }}>{translate('audit.report_row_stats', '資料筆數（輸入/刪除/輸出）:')}</b>
										<div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '16px', marginTop: '4px' }}>
											<span>{translate('audit.report_row_stats_input', '輸入 {{num}}', { num: selectedAuditLog.inputRowCount.toLocaleString() })}</span>
											<span style={{ color: '#cf1322' }}>{translate('audit.report_row_stats_deleted', '刪除 {{num}}', { num: selectedAuditLog.deletedRowCount.toLocaleString() })}</span>
											<span style={{ color: '#389e0d', fontWeight: 'bold' }}>{translate('audit.report_row_stats_output', '輸出 {{num}}', { num: selectedAuditLog.outputRowCount.toLocaleString() })}</span>
										</div>
									</Col>
								)}
							</Row>
						</div>

						{/* 
						  * 渲染欄位處置與技術對照表：根據欄位隱私角色與所選模式，動態推導並顯示套用的去識別化技術 
						  */}
						<h4 className="pdf-page-break avoid-break" style={{ color: '#000000', marginTop: '16px', marginBottom: '12px', pageBreakInside: 'avoid', clear: 'both' }}>
							{translate('audit.report_table_title', '欄位處置與技術對照表')}
						</h4>
						
						{/* 
						* ============================================================================
						* [前端渲染區塊 - 欄位處置與技術對照表 (動態視圖切換)]
						* 規範對照: 符合變數撰寫參考 b) 說明變數含義與作用、c) 確認全域變數與程序之關係
						* 實作說明:
						* 此區塊依據狀態變數 `isPdfExporting` 決定渲染哪一種 HTML 表格 DOM 結構：
						* 
						* 1. 匯出 PDF 模式 (isPdfExporting === true)：
						*    - 【關鍵】：必須移除外層帶有 `overflowY: 'auto'` 的限制高度容器，讓表格在網頁上完全平展。
						*    - 【原因】：底層的 html2canvas 渲染引擎無法正確擷取被 CSS 捲動軸隱藏的內部元素。若不平展，PDF 截圖只會剩下目前畫面上可見的範圍。
						*    - 行列加上 `pageBreakInside: 'avoid'`，確保匯出時單一橫列不會被切成兩半（跨頁斷裂）。
						* 
						* 2. 網頁 UI 預覽模式 (isPdfExporting === false)：
						*    - 包覆外層限制高度 (`maxHeight: '240px'`) 與垂直捲動 (`overflowY: 'auto'`) 的 <div> 容器。
						*    - 表頭 (thead) 加上 `position: 'sticky'` 與 `zIndex: 1`，提升使用者在 Modal 彈窗內瀏覽大量欄位時的體驗。
						* ============================================================================
						*/}

						{isPdfExporting ? (
							<table 
								style={{ 
									width: '100%', 
									borderCollapse: 'collapse', 
									color: '#000000', 
									backgroundColor: '#ffffff', 
									tableLayout: 'fixed',
									border: '1px solid #d9d9d9',
									marginBottom: '24px'
								}}
							>
								<thead>
									<tr style={{ backgroundColor: '#f1f5f9', pageBreakInside: 'avoid' }}>
										<th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '40%' }}>{translate('audit.table_col_name', '欄位名稱')}</th>
										<th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{translate('audit.table_col_role', '隱私角色')}</th>
										<th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{translate('audit.table_col_tech', '套用去識別化技術')}</th>
									</tr>
								</thead>

								<tbody>
									{selectedAuditLog.columnsSnapshot.map(
										(targetColumnNameString) =>
										{
											const { role: calculatedRoleName } = getSnapshotRole(selectedAuditLog, targetColumnNameString);

											const isDpFieldEnabled = selectedAuditLog.dpEnabledFieldNamesSnapshot.includes(targetColumnNameString);

											let selectedStrategyDescription = translate('audit.tech_keep_original', '保留原文');

											if (calculatedRoleName === 'Identifier')
											{
												selectedStrategyDescription = selectedAuditLog.identifierMaskStrategySnapshot?.[targetColumnNameString] === 'remove'
													? translate('audit.tech_removed', '直接移除')
													: translate('audit.tech_full_masking', '完全遮蔽');
											}
											else if (calculatedRoleName === 'Quasi-identifier' && selectedAuditLog.privacyMode === 'k-anonymity')
											{
												selectedStrategyDescription = getKAnonymityGeneralizationTechLabel(selectedAuditLog.qiGeneralizationTechSnapshot?.[targetColumnNameString], translate);
											}
											else if (selectedAuditLog.privacyMode === 'differential-privacy' && isDpFieldEnabled)
											{
												selectedStrategyDescription = translate('audit.tech_dp', '差分隱私加噪');
											}

											const roleI18nKeyString = `step4.role.${calculatedRoleName.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')}`;

											return (
												<tr key={targetColumnNameString} style={{ backgroundColor: '#ffffff', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
													<td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#000000', wordBreak: 'break-word' }}><b>{targetColumnNameString}</b></td>
													<td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{translate(roleI18nKeyString, calculatedRoleName)}</td>
													<td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{selectedStrategyDescription}</td>
												</tr>
											);
										}
									)}
								</tbody>
							</table>
						) : (
							<div 
								style={{ 
									maxHeight: '240px', 
									overflowY: 'auto', 
									border: '1px solid #d9d9d9', 
									borderRadius: '4px', 
									marginBottom: '24px' 
								}}
							>
								<table 
									style={{ 
										width: '100%', 
										borderCollapse: 'collapse', 
										color: '#000000', 
										backgroundColor: '#ffffff', 
										tableLayout: 'fixed'
									}}
								>
									<thead>
										<tr style={{ backgroundColor: '#f1f5f9', position: 'sticky', top: 0, zIndex: 1 }}>
											<th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '40%' }}>{translate('audit.table_col_name', '欄位名稱')}</th>
											<th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{translate('audit.table_col_role', '隱私角色')}</th>
											<th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{translate('audit.table_col_tech', '套用去識別化技術')}</th>
										</tr>
									</thead>

									<tbody>
										{selectedAuditLog.columnsSnapshot.map(
											(targetColumnNameString) =>
											{
												const { role: calculatedRoleName } = getSnapshotRole(selectedAuditLog, targetColumnNameString);

												const isDpFieldEnabled = selectedAuditLog.dpEnabledFieldNamesSnapshot.includes(targetColumnNameString);

												let selectedStrategyDescription = translate('audit.tech_keep_original', '保留原文');

												if (calculatedRoleName === 'Identifier')
												{
													selectedStrategyDescription = selectedAuditLog.identifierMaskStrategySnapshot?.[targetColumnNameString] === 'remove'
														? translate('audit.tech_removed', '直接移除')
														: translate('audit.tech_full_masking', '完全遮蔽');
												}
												else if (calculatedRoleName === 'Quasi-identifier' && selectedAuditLog.privacyMode === 'k-anonymity')
												{
													selectedStrategyDescription = getKAnonymityGeneralizationTechLabel(selectedAuditLog.qiGeneralizationTechSnapshot?.[targetColumnNameString], translate);
												}
												else if (selectedAuditLog.privacyMode === 'differential-privacy' && isDpFieldEnabled)
												{
													selectedStrategyDescription = translate('audit.tech_dp', '差分隱私加噪');
												}

												const roleI18nKeyString = `step4.role.${calculatedRoleName.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')}`;

												return (
													<tr key={targetColumnNameString} style={{ backgroundColor: '#ffffff' }}>
														<td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#000000', wordBreak: 'break-word' }}><b>{targetColumnNameString}</b></td>
														<td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{translate(roleI18nKeyString, calculatedRoleName)}</td>
														<td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{selectedStrategyDescription}</td>
													</tr>
												);
											}
										)}
									</tbody>
								</table>
							</div>
						)}

						{/* ★ 2026-10-02：原為寫死的假指紋與假簽章（Mock Data），改為簽發時產生的真實 SHA-256 指紋與 ECDSA 數位簽章，
						    開啟憑證時依目前內容即時驗證是否被竄改（見 utils/auditIntegrity.ts、components/AuditIntegrityPanel.tsx）。 */}
						<AuditIntegrityPanel
							entry={selectedAuditLog}
							className="pdf-page-break avoid-break"
							style={{ textAlign: 'left', marginTop: '24px', borderTop: `1px dashed #d9d9d9`, paddingTop: '12px', fontSize: scaleFontSize(12), color: '#888888', pageBreakInside: 'avoid', lineHeight: 1.7 }}
						/>
					</div>
				)}
			</Modal>

		</div>
	);
}