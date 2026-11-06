/**
 * ============================================================================
 * 檔案名稱 (File): AuditLogHub.tsx
 * 模組功能 (Description): 歷史審計軌跡與憑證數據庫檢視組件 (提供歷次脫敏發布軌跡查詢、統計與 PDF 憑證調閱匯出)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) 說明性檔案與原始檔案開頭註記, 變數函數與程序撰寫參考 a)~h)
 * ============================================================================
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import { 
	Card, Table, Tag, Input, Select, Button, Space, Typography, 
	Statistic, Row, Col, Modal, theme, App as AntdApp, Tooltip, Alert
} from 'antd';
import { 
	SearchOutlined, FileTextOutlined, 
	 SafetyCertificateOutlined,
	 FilterOutlined, DownloadOutlined, CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, ReloadOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { getRoleDisplayName } from '../../utils/roleLabel';

import { useAuditStore, selectAuditLogsForUser, type AuditLogItem } from '../../store/useAuditStore';
import { useAuthStore } from '../../store/useAuthStore';
import { fetchHistory } from '../../api/systemApi';
import ComplianceReportDocument from '../../components/ComplianceReportDocument';
import RiskLevelBadge from '../../components/RiskLevelBadge';
import { computeReportOverallRisk, resolveAuditLogComplianceStatus } from '../../utils/complianceReport';

import { scaleFontSize } from '../../utils/fontScale';
import { createHtml2PdfLoader, startHtml2PdfLoader } from '../../utils/html2pdfLoader';
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

type ComplianceFilterValue = 'all' | AuditLogItem['status']; // 合規篩選：全部／達標／未達標

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
const FAILED_ROW_STYLE_TEXT = '.audit-row-failed > td { background: rgba(220, 38, 38, 0.08) !important; } .audit-row-failed > td:first-child { box-shadow: inset 4px 0 0 #dc2626; }';

export default function AuditLogHub(): React.ReactElement
{
	const { token } = theme.useToken();

	const { message: messageApi } = AntdApp.useApp();

	const { t: translate } = useTranslation();

	// ★ 2026-10-29：紀錄存後端。Data Owner 看自己的（開頁時重新載入）；Admin 看所有人的（GET /history?all=1）
	const allAuditLogsList = useAuditStore(
		(state) => state.auditLogs
	);
	const loadAuditLogsAction = useAuditStore((state) => state.loadAuditLogs);
	const currentOperatorName = useAuthStore((state) => state.user?.name);
	const isAdminViewer = useAuthStore((state) => state.user?.role) === 'admin';
	const [adminAuditLogsList, setAdminAuditLogsList] = useState<AuditLogItem[]>([]);
	const [isAuditLogsLoading, setIsAuditLogsLoading] = useState<boolean>(true);
	const [isAuditLogsLoadFailed, setIsAuditLogsLoadFailed] = useState<boolean>(false);

	const reloadAuditLogs = useCallback(async (): Promise<void> =>
	{
		setIsAuditLogsLoading(true);
		let isLoaded = true;
		if (isAdminViewer)
		{
			try { setAdminAuditLogsList(await fetchHistory({ all: true })); }
			catch (loadErrorValue) { console.warn('[處理紀錄] 載入所有使用者紀錄失敗：', loadErrorValue); isLoaded = false; }
		}
		else
		{
			isLoaded = await loadAuditLogsAction();
		}
		setIsAuditLogsLoadFailed(!isLoaded);
		setIsAuditLogsLoading(false);
	}, [isAdminViewer, loadAuditLogsAction]);

	useEffect(() => { void reloadAuditLogs(); }, [reloadAuditLogs]);

	const auditLogsList = useMemo(
		() => (isAdminViewer ? adminAuditLogsList : selectAuditLogsForUser(allAuditLogsList, currentOperatorName)),
		[isAdminViewer, adminAuditLogsList, allAuditLogsList, currentOperatorName]
	);

	const [searchKeywordText, setSearchKeywordText] = useState<string>('');

	const [privacyFilterMode, setPrivacyFilterMode] = useState<string>('all');

	// ★ 2026-11-03：依合規結果篩選；下拉選單與上方統計卡共用此狀態
	const [complianceFilter, setComplianceFilter] = useState<ComplianceFilterValue>('all');

	// 點統計卡：切到該類，再點一次已選的卡片則回到全部
	const statsClickHintText = translate('audit.stats_click_hint', '點擊卡片可篩選列表');

	const toggleComplianceFilter = (targetFilterValue: ComplianceFilterValue): void =>
	{
		setComplianceFilter((currentFilterValue) => (currentFilterValue === targetFilterValue ? 'all' : targetFilterValue));
	};

	const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLogItem | null>(null); 
	const selectedAuditLogStatus = selectedAuditLog ? resolveAuditLogComplianceStatus(selectedAuditLog) : null;

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

					const isComplianceMatched = complianceFilter === 'all' || resolveAuditLogComplianceStatus(logItemRecord) === complianceFilter;

					return isSearchKeywordMatched && isPrivacyModeMatched && isComplianceMatched;
				}
			);
		},
		[auditLogsList, searchKeywordText, privacyFilterMode, complianceFilter]
	);

	// 計算 KPI 統計數據 (符合規範 c, d)
	const auditDashboardStatistics = useMemo(
		() => 
		{
			const totalAuditLogsCount = auditLogsList.length;

			// ★ 2026-11-06：合規結果改依 resolveAuditLogComplianceStatus（納入風險評估），另列「未完成風險評估」
			const statusList = auditLogsList.map((logItemRecord) => resolveAuditLogComplianceStatus(logItemRecord));

			// ★ 2026-10-29：總數改稱「處理紀錄總數」（原「合規簽發」也算進未達標的紀錄），另分列達標／未達標
			return {
				totalCount: totalAuditLogsCount,
				passedCount: statusList.filter((statusValue) => statusValue === 'passed').length,
				failedCount: statusList.filter((statusValue) => statusValue === 'failed').length,
				unassessedCount: statusList.filter((statusValue) => statusValue === 'unassessed').length,
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
		if (selectedAuditLogStatus !== 'passed') return; // 未達合規標準／未完成風險評估的紀錄不提供 PDF 匯出
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

		// ★ 2026-10-29：改用打包進前端的 html2pdf（離線也能匯出），見 utils/html2pdfLoader.ts
		const html2pdfLoader = createHtml2PdfLoader();
		
		html2pdfLoader.onload = () => 
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
		
		html2pdfLoader.onerror = () => 
		{
			hideLoadingMessageFunction();

			messageApi.error(
				translate('audit.msg_pdf_no_lib', '無法載入 PDF 轉檔套件，請重新整理頁面後再試一次。')
			);

			setIsPdfExporting(false);
		};
		
		startHtml2PdfLoader(html2pdfLoader);
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
		// ★ 2026-10-29：未達合規標準的紀錄原本要調閱才看得到，列表一律顯示「合規結果」，未達標以紅色標示
		{
			title: translate('audit.col_compliance', '合規結果'),
			key: 'status',
			render: (_: unknown, auditLogRecordItem: AuditLogItem) =>
			{
				const statusValue = resolveAuditLogComplianceStatus(auditLogRecordItem);
				if (statusValue === 'failed') return <Tag color="error" icon={<CloseCircleOutlined />} style={{ fontWeight: 700 }} data-testid="audit-row-failed">{translate('audit.compliance_failed', '未達合規標準')}</Tag>;
				if (statusValue === 'unassessed') return <Tag color="warning" icon={<ExclamationCircleOutlined />} style={{ fontWeight: 700 }} data-testid="audit-row-unassessed">{translate('audit.compliance_unassessed', '未完成風險評估')}</Tag>;
				return <Tag color="success" icon={<CheckCircleOutlined />}>{translate('audit.compliance_passed', '達標')}</Tag>;
			},
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
			
			{/* ★ 2026-11-03：統計卡可點擊篩選列表，套用中的卡片加框標示（未達標卡片原有紅框，選中時加粗） */}
			<Row gutter={24}>
				<Col xs={24} md={6}>
					<Tooltip title={statsClickHintText}>
						<Card
							variant="borderless"
							hoverable
							onClick={() => setComplianceFilter('all')}
							data-testid="audit-stats-card-total"
							style={{ background: token.colorBgContainer, cursor: 'pointer', ...(complianceFilter === 'all' ? { border: `2px solid ${token.colorPrimary}` } : {}) }}
						>
							<Statistic
								title={translate('audit.stats_total', '處理紀錄總數')}
								value={auditDashboardStatistics.totalCount}
								prefix={<SafetyCertificateOutlined style={{ color: token.colorPrimary }} />}
								suffix={translate('audit.unit_certificates', '份')}
							/>
						</Card>
					</Tooltip>
				</Col>
				<Col xs={24} md={6}>
					<Tooltip title={statsClickHintText}>
						<Card
							variant="borderless"
							hoverable
							onClick={() => toggleComplianceFilter('passed')}
							data-testid="audit-stats-card-passed"
							style={{ background: token.colorBgContainer, cursor: 'pointer', ...(complianceFilter === 'passed' ? { border: `2px solid ${token.colorPrimary}` } : {}) }}
						>
							<Statistic
								title={translate('audit.stats_passed', '達合規標準')}
								value={auditDashboardStatistics.passedCount}
								valueStyle={{ color: '#16a34a' }}
								prefix={<CheckCircleOutlined />}
								suffix={translate('audit.unit_certificates', '份')}
							/>
						</Card>
					</Tooltip>
				</Col>
				<Col xs={24} md={6}>
					<Tooltip title={statsClickHintText}>
						<Card
							variant="borderless"
							hoverable
							onClick={() => toggleComplianceFilter('failed')}
							data-testid="audit-stats-card-failed"
							style={{
								background: token.colorBgContainer,
								cursor: 'pointer',
								...(complianceFilter === 'failed'
									? { border: '2px solid #dc2626' }
									: auditDashboardStatistics.failedCount > 0 ? { border: '1px solid #dc2626' } : {}),
							}}
						>
							<Statistic
								title={translate('audit.stats_failed', '未達合規標準')}
								value={auditDashboardStatistics.failedCount}
								valueStyle={{ color: auditDashboardStatistics.failedCount > 0 ? '#dc2626' : undefined }}
								prefix={<CloseCircleOutlined />}
								suffix={translate('audit.unit_certificates', '份')}
							/>
						</Card>
					</Tooltip>
				</Col>
				<Col xs={24} md={6}>
					<Tooltip title={statsClickHintText}>
						<Card
							variant="borderless"
							hoverable
							onClick={() => toggleComplianceFilter('unassessed')}
							data-testid="audit-stats-card-unassessed"
							style={{
								background: token.colorBgContainer,
								cursor: 'pointer',
								...(complianceFilter === 'unassessed'
									? { border: '2px solid #d97706' }
									: auditDashboardStatistics.unassessedCount > 0 ? { border: '1px solid #d97706' } : {}),
							}}
						>
							<Statistic
								title={translate('audit.stats_unassessed', '未完成風險評估')}
								value={auditDashboardStatistics.unassessedCount}
								valueStyle={{ color: auditDashboardStatistics.unassessedCount > 0 ? '#d97706' : undefined }}
								prefix={<ExclamationCircleOutlined />}
								suffix={translate('audit.unit_certificates', '份')}
							/>
						</Card>
					</Tooltip>
				</Col>
			</Row>

			<Card variant="borderless" style={{ background: token.colorBgContainer }}>
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
					<div>
						<Title level={4} style={{ margin: 0 }}>
							<FilterOutlined style={{ marginRight: 8, color: token.colorPrimary }} />
							{translate('audit.hub_title', '處理紀錄')}
						</Title>
						{/* ★ 2026-10-29：原名「歷史檢測軌跡與紀錄資料庫」讓人以為存有處理過的資料，改名並註明只存紀錄 */}
						<Text type="secondary" style={{ fontSize: scaleFontSize(12) }} data-testid="audit-hub-note">
							{translate('audit.hub_note', '這裡只保存每次處理的設定與結果摘要（含伺服器簽章），不保存原始資料，也不保存去識別化後的資料。')}
							{isAdminViewer && <> {translate('audit.hub_note_admin', '管理員檢視：列出所有使用者的處理紀錄。')}</>}
						</Text>
					</div>

					<Space>
						<Button icon={<ReloadOutlined />} loading={isAuditLogsLoading} onClick={() => void reloadAuditLogs()}>
							{translate('audit.btn_reload', '重新載入')}
						</Button>
						<Input
							placeholder={translate('audit.search_placeholder', '搜尋憑證編號、檔案名稱、操作者...')} 
							prefix={<SearchOutlined />} 
							value={searchKeywordText}
							onChange={(inputEvent) => setSearchKeywordText(inputEvent.target.value)}
							style={{ width: '20em' }}
							allowClear
						/>

						<Select
							value={complianceFilter}
							onChange={(selectedComplianceValue: ComplianceFilterValue) => setComplianceFilter(selectedComplianceValue)}
							style={{ width: '11em' }}
							data-testid="audit-compliance-filter"
							options={[
								{ value: 'all', label: translate('audit.filter_compliance_all', '全部合規結果') },
								{ value: 'passed', label: translate('audit.stats_passed', '達合規標準') },
								{ value: 'failed', label: translate('audit.stats_failed', '未達合規標準') },
								{ value: 'unassessed', label: translate('audit.stats_unassessed', '未完成風險評估') },
							]}
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

				{isAuditLogsLoadFailed && (
					<Alert type="error" showIcon style={{ marginBottom: 12 }} message={translate('audit.load_failed', '處理紀錄載入失敗，請確認後端連線後重新載入。')} />
				)}

				{/* 未達合規標準的列整列淡紅底、左側紅條，與達標紀錄一眼可分 */}
				<style>{FAILED_ROW_STYLE_TEXT}</style>
				<Table
					dataSource={filteredAuditLogsList}
					columns={dataTableColumnsConfig}
					rowKey="id"
					loading={isAuditLogsLoading}
					rowClassName={(auditLogRecordItem: AuditLogItem) => (resolveAuditLogComplianceStatus(auditLogRecordItem) === 'failed' ? 'audit-row-failed' : '')}
					pagination={{ pageSize: DEFAULT_PAGE_SIZE }}
					size="middle"
					scroll={{ x: 'max-content' }}
				/>
			</Card>

			{/* 歷史審計憑證調閱 Modal */}
			<Modal
				title={selectedAuditLogStatus === 'unassessed' // ★ 2026-10-08：標題與 Step4 報告視窗一致
					? translate('step4.modal.title_unassessed', '檢測紀錄（未完成風險評估）')
					: selectedAuditLogStatus === 'failed'
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
					<Tooltip key="print" title={selectedAuditLogStatus === 'unassessed'
						? translate('audit.export_blocked_unassessed', '此筆紀錄未完成風險評估，不提供 PDF 匯出。')
						: selectedAuditLogStatus === 'failed' ? translate('audit.export_blocked_failed', '此筆紀錄未達合規標準，不提供 PDF 匯出。') : undefined}>
						<Button type="primary" icon={<DownloadOutlined />} loading={isPdfExporting} disabled={selectedAuditLogStatus !== 'passed'} onClick={handleDownloadPDF} style={selectedAuditLogStatus !== 'passed' ? undefined : { background: '#4F46E5' }}>
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
