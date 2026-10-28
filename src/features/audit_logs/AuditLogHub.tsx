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

import { useAuditStore, selectAuditLogsForUser, type AuditLogItem } from '../../store/useAuditStore';
import { useAuthStore } from '../../store/useAuthStore';
import ComplianceReportDocument from '../../components/ComplianceReportDocument';
import RiskLevelBadge from '../../components/RiskLevelBadge';
import { computeReportOverallRisk } from '../../utils/complianceReport';

import { scaleFontSize } from '../../utils/fontScale';
/**
 * 預設常數宣告
 * 規範對照: 符合規範 e) 避免魔術數字 (Magic Number)
 */
const DEFAULT_PAGE_SIZE = 10;
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

	// ★ 2026-10-28：紀錄改存瀏覽器（重新整理不消失）；同一台瀏覽器可能有多個帳號，只顯示目前帳號的紀錄
	const allAuditLogsList = useAuditStore(
		(state) => state.auditLogs
	);
	const currentOperatorName = useAuthStore((state) => state.user?.name);
	const auditLogsList = useMemo(() => selectAuditLogsForUser(allAuditLogsList, currentOperatorName), [allAuditLogsList, currentOperatorName]);
	
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
				filename:    `Privacy_Audit_Certificate_${selectedAuditLog?.certificateId}.pdf`, // ★ 2026-10-08：檔名與 Step4 一致
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
						translate('step4.msg.pdf_success', '合規審計憑證 PDF 已成功下載！')
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
	 * ★ 2026-10-08：列表的整體等級改取自報告快照；「三大攻擊殘餘風險」欄依使用者要求移除（細節見調閱報告）（與 Step4 報告、調閱視窗同一算法）。
	 *   原本「綜合殘餘風險」是三攻擊平均之類的百分比、以 20% 判斷顏色，與 Step4 的 L1/L2/L3 整體等級
	 *   （三個白話問題取最高、含扣除基線後的 CAP）不同，同一筆紀錄兩邊看到的結論可能不一樣。
	 */
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
			title: translate('audit.col_overall_level', '整體風險等級'),
			key: 'overallRisk',
			render: (_: unknown, auditLogRecordItem: AuditLogItem) =>
			{
				if (!auditLogRecordItem.reportSnapshot)
				{
					// 舊紀錄沒有報告快照，只能顯示當時記錄的百分比
					return <Text type="secondary">{auditLogRecordItem.overallRisk}</Text>;
				}
				const overallSummary = computeReportOverallRisk(auditLogRecordItem.reportSnapshot.attackRisks, auditLogRecordItem.reportSnapshot.cap, { singling: '', linkability: '', sensitive: '' });
				return overallSummary
					? <RiskLevelBadge level={overallSummary.info.level} size="small" />
					: <Text type="secondary">{translate('step4.risk.row_not_evaluated', '未評估')}</Text>;
			},
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
							style={{ width: '20em' }}
							allowClear
						/>

						<Select 
							value={privacyFilterMode} 
							onChange={(selectedFilterModeValue) => setPrivacyFilterMode(selectedFilterModeValue)}
							style={{ width: '13em' }}
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
				title={selectedAuditLog?.status === 'failed' // ★ 2026-10-08：標題與 Step4 報告視窗一致
					? translate('step4.modal.title_non_compliant', '檢測紀錄（未達合規標準）')
					: translate('step4.modal.title', '隱私合規與風險評估報告')}
				open={isReportModalVisible}
				onCancel={() => setIsReportModalVisible(false)}
				width={'57em'}
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
				{/* ★ 2026-10-08 使用者反映：調閱內容與 Step4「查看與下載報告」不一致（這裡原本是舊版憑證格式）。
				    改用與 Step4 相同的報告元件與紀錄內的報告快照繪製，兩處內容一致。 */}
				{selectedAuditLog && (
					<ComplianceReportDocument
						entry={selectedAuditLog}
						isExportingPdf={isPdfExporting}
						containerId="printable-historical-report"
					/>
				)}
			</Modal>

		</div>
	);
}