/**
 * 檔案名稱 (File): SystemLogCharts.tsx
 * 模組功能 (Description): 系統維運日誌圖表——事件趨勢（依層級堆疊）與 API 呼叫成功／失敗與耗時。
 * ★ 2026-10-29 新增：資料只用畫面上已載入的日誌（隨即時更新自動重算），統計見 utils/systemLogStats.ts。
 *   點趨勢圖的長條可把下方表格篩到該時段與層級；點 API 圖的長條可篩到該 API。
 */
import { useMemo, type ReactElement } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card, Col, Empty, Row } from 'antd';
import { useTranslation } from 'react-i18next';
import type { SystemLogEntry, SystemLogLevel } from '../../store/useSystemLogStore';
import {
	buildApiEndpointStats, buildLevelTrend, filterLogsByRange, formatBucketLabel, type SystemLogRangeKey,
} from '../../utils/systemLogStats';

export const SYSTEM_LOG_LEVEL_COLORS: Record<SystemLogLevel, string> = { INFO: '#52c41a', WARN: '#faad14', ERROR: '#ff4d4f' };

/** 點圖後交給表格的篩選條件 */
export interface SystemLogChartSelection
{
	timeRange?: { startMs: number; endMs: number; label: string };
	level?: SystemLogLevel;
	source?: string;
}

interface SystemLogChartsProps
{
	logs: SystemLogEntry[];
	rangeKey: SystemLogRangeKey;
	nowMs: number;
	isDarkMode: boolean;
	onSelect: (selection: SystemLogChartSelection) => void;
}

const LEVELS: SystemLogLevel[] = ['INFO', 'WARN', 'ERROR'];

export default function SystemLogCharts({ logs, rangeKey, nowMs, isDarkMode, onSelect }: SystemLogChartsProps): ReactElement
{
	const { t: translate } = useTranslation();
	const levelTrend = useMemo(() => buildLevelTrend(logs, rangeKey, nowMs), [logs, rangeKey, nowMs]);
	const apiEndpointStats = useMemo(() => buildApiEndpointStats(filterLogsByRange(logs, rangeKey, nowMs)), [logs, rangeKey, nowMs]);
	const chartTheme = isDarkMode ? 'dark' : 'light';
	const transparentBackground = { backgroundColor: 'transparent' };

	const trendOption = {
		...transparentBackground,
		tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
		legend: { data: LEVELS, top: 0 },
		grid: { left: 40, right: 16, top: 32, bottom: 28 },
		xAxis: { type: 'category', data: levelTrend.bucketStartsMs.map((bucketStart) => formatBucketLabel(bucketStart, levelTrend.bucketMs)) },
		yAxis: { type: 'value', minInterval: 1 },
		series: LEVELS.map((level) => ({
			name: level, type: 'bar', stack: 'events', data: levelTrend.counts[level],
			itemStyle: { color: SYSTEM_LOG_LEVEL_COLORS[level] }, emphasis: { focus: 'series' },
		})),
	};

	const apiChartHeight = Math.max(180, 40 + apiEndpointStats.length * 32);
	const apiOption = {
		...transparentBackground,
		tooltip: {
			trigger: 'axis', axisPointer: { type: 'shadow' },
			formatter: (axisItems: { dataIndex: number }[]) =>
			{
				const endpointStats = apiEndpointStats[axisItems[0]?.dataIndex ?? 0];
				if (!endpointStats) return '';
				const formatSeconds = (secondsValue: number | null): string => (secondsValue === null ? '-' : `${secondsValue.toFixed(1)} ${translate('admin.syslog_chart_seconds', '秒')}`);
				return [
					`<b>${endpointStats.endpoint}</b>`,
					`${translate('admin.syslog_chart_success', '成功')}：${endpointStats.successCount}`,
					`${translate('admin.syslog_chart_failure', '失敗')}：${endpointStats.failureCount}`,
					`${translate('admin.syslog_chart_avg', '平均耗時')}：${formatSeconds(endpointStats.averageSeconds)}`,
					`${translate('admin.syslog_chart_max', '最長耗時')}：${formatSeconds(endpointStats.maxSeconds)}`,
				].join('<br/>');
			},
		},
		legend: { data: [translate('admin.syslog_chart_success', '成功'), translate('admin.syslog_chart_failure', '失敗'), translate('admin.syslog_chart_avg', '平均耗時')], top: 0 },
		grid: { left: 8, right: 48, top: 32, bottom: 24, containLabel: true },
		xAxis: [
			{ type: 'value', minInterval: 1, name: translate('admin.syslog_chart_calls', '次數'), nameLocation: 'end' },
			{ type: 'value', name: translate('admin.syslog_chart_seconds', '秒'), nameLocation: 'end', splitLine: { show: false } },
		],
		yAxis: { type: 'category', inverse: true, data: apiEndpointStats.map((endpointStats) => endpointStats.endpoint) },
		series: [
			{ name: translate('admin.syslog_chart_success', '成功'), type: 'bar', stack: 'calls', data: apiEndpointStats.map((endpointStats) => endpointStats.successCount), itemStyle: { color: SYSTEM_LOG_LEVEL_COLORS.INFO } },
			{ name: translate('admin.syslog_chart_failure', '失敗'), type: 'bar', stack: 'calls', data: apiEndpointStats.map((endpointStats) => endpointStats.failureCount), itemStyle: { color: SYSTEM_LOG_LEVEL_COLORS.ERROR } },
			{
				name: translate('admin.syslog_chart_avg', '平均耗時'), type: 'scatter', xAxisIndex: 1, symbolSize: 10,
				data: apiEndpointStats.map((endpointStats) => (endpointStats.averageSeconds === null ? null : Number(endpointStats.averageSeconds.toFixed(1)))),
				itemStyle: { color: '#3f51b5' },
			},
		],
	};

	const handleTrendClick = (clickEventObj: { dataIndex: number; seriesName: string }): void =>
	{
		const bucketStart = levelTrend.bucketStartsMs[clickEventObj.dataIndex];
		if (bucketStart === undefined) return;
		const nextBucketStart = levelTrend.bucketStartsMs[clickEventObj.dataIndex + 1] ?? bucketStart + levelTrend.bucketMs;
		onSelect({
			timeRange: { startMs: bucketStart, endMs: nextBucketStart, label: formatBucketLabel(bucketStart, levelTrend.bucketMs) },
			level: LEVELS.includes(clickEventObj.seriesName as SystemLogLevel) ? clickEventObj.seriesName as SystemLogLevel : undefined,
		});
	};

	const handleApiClick = (clickEventObj: { dataIndex: number }): void =>
	{
		const endpointStats = apiEndpointStats[clickEventObj.dataIndex];
		if (endpointStats) onSelect({ source: endpointStats.source });
	};

	const hasAnyEvent = LEVELS.some((level) => levelTrend.counts[level].some((countValue) => countValue > 0));

	return (
		<Row gutter={[16, 16]} style={{ marginBottom: '16px' }} data-testid="system-log-charts">
			<Col xs={24} xl={14}>
				<Card size="small" title={translate('admin.syslog_chart_trend', '事件趨勢（依層級）')} extra={<span style={{ fontSize: 12, opacity: 0.6 }}>{translate('admin.syslog_chart_click_hint', '點長條可篩選下方紀錄')}</span>}>
					{hasAnyEvent
						? <ReactECharts option={trendOption} theme={chartTheme} style={{ height: '260px', width: '100%' }} notMerge onEvents={{ click: handleTrendClick }} />
						: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate('admin.syslog_chart_empty', '此期間沒有事件')} style={{ height: '260px', paddingTop: '80px', margin: 0 }} />}
				</Card>
			</Col>
			<Col xs={24} xl={10}>
				<Card size="small" title={translate('admin.syslog_chart_api', 'API 呼叫成功／失敗與耗時')}>
					{apiEndpointStats.length > 0
						? <ReactECharts option={apiOption} theme={chartTheme} style={{ height: `${apiChartHeight}px`, width: '100%' }} notMerge onEvents={{ click: handleApiClick }} />
						: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate('admin.syslog_chart_api_empty', '此期間沒有 API 呼叫')} style={{ height: '260px', paddingTop: '80px', margin: 0 }} />}
				</Card>
			</Col>
		</Row>
	);
}
