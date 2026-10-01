/**
 * Step4「後端處理報告明細」：顯示後端品質／預算報告中先前未呈現的項目（2026-10-01 新增）。
 *   - K-匿名：雜湊演算法、是否加鹽、系統套用的預設值、後端調整建議原文
 *   - 差分隱私：逐欄預算明細（機制、ε、δ、換算為刻度後的敏感度、刻度、溢出處理）
 * 欄位定義見後端 2_操作說明.md 2-5／3-5 節。預設收合，避免干擾主要結果。
 */
import type { ReactElement } from 'react';
import { Collapse, Descriptions, Table, Tag, Tooltip, Typography, theme } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { KAnonymityQualityReport, DpQualityReport, DpPerColumnBudgetReport } from '../../api/apiService';
import { formatReportListItem, describeDpColumnStep, MECHANISM_LABELS, COLUMN_TYPE_LABELS, OUT_OF_BOUNDS_LABELS } from './pipeline/backendReportFormat';

const { Text } = Typography;

interface BackendReportDetailsProps {
    kReport: KAnonymityQualityReport | null;
    dpReport: DpQualityReport | null;
}

export default function BackendReportDetails({ kReport, dpReport }: BackendReportDetailsProps): ReactElement | null {
    const { t: translate } = useTranslation();
    const { token } = theme.useToken();
    if (!kReport && !dpReport) return null;

    const helpIcon = (tooltipText: string) => (
        <Tooltip title={tooltipText}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} /></Tooltip>
    );

    const kAnonymityDetails = kReport && (() => {
        const appliedDefaultsList = Array.isArray(kReport.applied_defaults) ? kReport.applied_defaults : [];
        const recommendationsList = Array.isArray(kReport.recommendations) ? kReport.recommendations : [];
        return (
            <Descriptions column={1} size="small" bordered data-testid="kanon-report-details">
                <Descriptions.Item label={translate('step4.report_details.hash_algorithm', '雜湊演算法')}>
                    {kReport.hash_algorithm ?? '-'}
                </Descriptions.Item>
                <Descriptions.Item label={<>{translate('step4.report_details.hash_salted', '雜湊加鹽')}{helpIcon(translate('step4.report_details.hash_salted_tooltip', '鹽值由後端部署環境的 .env（OPEN_PETS_DEFAULT_SALT）提供，前端無法設定。未加鹽時，相同的原始值在不同批次會得到相同的雜湊結果。'))}</>}>
                    {kReport.hash_salted === undefined ? '-' : kReport.hash_salted
                        ? <Tag color="green">{translate('step4.report_details.salted_yes', '已加鹽')}</Tag>
                        : <Tag color="orange">{translate('step4.report_details.salted_no', '未加鹽')}</Tag>}
                </Descriptions.Item>
                <Descriptions.Item label={<>{translate('step4.report_details.applied_defaults', '系統套用的預設值')}{helpIcon(translate('step4.report_details.applied_defaults_tooltip', '設定檔沒有指定、由後端自動決定的設定項目。'))}</>}>
                    {appliedDefaultsList.length === 0
                        ? <Text type="secondary">{translate('step4.report_details.none', '無')}</Text>
                        : <ul style={{ margin: 0, paddingLeft: 18 }}>{appliedDefaultsList.map((item, index) => <li key={index}>{formatReportListItem(item)}</li>)}</ul>}
                </Descriptions.Item>
                <Descriptions.Item label={translate('step4.report_details.recommendations', '後端調整建議（原文）')}>
                    {recommendationsList.length === 0
                        ? <Text type="secondary">{translate('step4.report_details.none', '無')}</Text>
                        : <ul style={{ margin: 0, paddingLeft: 18 }}>{recommendationsList.map((item, index) => <li key={index}>{formatReportListItem(item)}</li>)}</ul>}
                </Descriptions.Item>
            </Descriptions>
        );
    })();

    const dpDetails = dpReport && (
        <Table<DpPerColumnBudgetReport>
            data-testid="dp-report-details"
            size="small"
            pagination={false}
            rowKey={(columnReport) => columnReport.column}
            dataSource={Array.isArray(dpReport.per_column) ? dpReport.per_column : []}
            locale={{ emptyText: translate('step4.report_details.no_per_column', '後端未回傳逐欄明細') }}
            scroll={{ x: 'max-content' }}
            columns={[
                { title: translate('step4.report_details.col_column', '欄位'), dataIndex: 'column', key: 'column' },
                { title: translate('step4.report_details.col_type', '型別'), dataIndex: 'type', key: 'type', render: (typeValue: string) => COLUMN_TYPE_LABELS[typeValue] ?? typeValue },
                { title: translate('step4.report_details.col_mechanism', '機制'), dataIndex: 'mechanism', key: 'mechanism', render: (mechanismValue: string) => MECHANISM_LABELS[mechanismValue] ?? mechanismValue },
                { title: 'ε', dataIndex: 'epsilon', key: 'epsilon' },
                { title: 'δ', dataIndex: 'delta', key: 'delta', render: (deltaValue: number | undefined) => deltaValue ?? 0 },
                {
                    title: <>{translate('step4.report_details.col_sensitivity', '敏感度（刻度數）')}{helpIcon(translate('step4.report_details.col_sensitivity_tooltip', '後端回報的是換算成「幾個刻度」後的敏感度，不是設定檔的原始申報值。例如薪資申報 125000、刻度 1000，這裡顯示 125；生日申報 365 天、刻度 7 天，顯示 53（無條件進位）。'))}</>,
                    dataIndex: 'sensitivity', key: 'sensitivity', render: (sensitivityValue: number | null) => sensitivityValue ?? '-'
                },
                { title: translate('step4.report_details.col_step', '刻度'), key: 'step', render: (_: unknown, columnReport: DpPerColumnBudgetReport) => describeDpColumnStep(columnReport) },
                {
                    title: translate('step4.report_details.col_out_of_bounds', '溢出處理'), dataIndex: 'out_of_bounds_strategy', key: 'out_of_bounds_strategy',
                    render: (strategyValue: string | null | undefined, columnReport: DpPerColumnBudgetReport) => columnReport.type === 'categorical'
                        ? '-'
                        : (strategyValue ? (OUT_OF_BOUNDS_LABELS[strategyValue] ?? strategyValue) : translate('step4.report_details.no_bounds', '未設上下限'))
                }
            ]}
        />
    );

    return (
        <Collapse
            style={{ marginTop: '24px', background: token.colorBgContainer }}
            items={[{
                key: 'backend-report-details',
                label: translate('step4.report_details.title', '後端處理報告明細'),
                children: kAnonymityDetails || dpDetails
            }]}
        />
    );
}
