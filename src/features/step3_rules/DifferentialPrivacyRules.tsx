/**
 * ============================================================================
 * 檔案名稱 (File): DifferentialPrivacyRules.tsx
 * 模組功能 (Description): 差分隱私參數設定與隱私預算中心組件 (提供全域與個別欄位 ε/δ 參數微調、等效隱私預算換算與動態噪聲分佈模擬)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字)
 * ============================================================================
 */

import React, { useMemo, useEffect } from 'react';
import {
	Alert, Card, Slider, Row, Col, Statistic, Divider,
	InputNumber, theme, Select, Progress, Typography, Table, Tag, Button, Space, App as AntdApp
} from 'antd';
import {
	LineChartOutlined, CalculatorOutlined,
	DashboardOutlined, GlobalOutlined, ControlOutlined, LockOutlined, ThunderboltOutlined
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore, type DPField } from '../../store/useWorkspaceStore';

const { Text } = Typography;

/**
 * 預設隱私參數常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const DEFAULT_EPSILON_BUDGET = 1.0;
const DEFAULT_DELTA_BUDGET = 1e-5;
const DEFAULT_GLOBAL_TARGET_DELTA = 1e-5;
const DEFAULT_BUDGET_LIMIT_EPSILON = 10;
const MIN_EPSILON_BUDGET_LIMIT = 0.1;
const MAX_EPSILON_BUDGET_LIMIT = 100;
const DANGER_BUDGET_USAGE_PERCENT_THRESHOLD = 90;
const WARNING_BUDGET_USAGE_PERCENT_THRESHOLD = 75;
const HIGH_SECURITY_EPSILON_THRESHOLD = 2.0;
const MEDIUM_SECURITY_EPSILON_THRESHOLD = 8.0;

/**
 * 隱私等級預設清單：點擊後將「目標總預算」均分給目前已啟用的欄位，並同步更新總預算上限
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const PRIVACY_LEVEL_PRESET_LIST: { key: string; labelKey: string; labelDefault: string; targetTotalEpsilon: number; accentColor: string }[] = [
	{ key: 'high', labelKey: 'step3_dp.preset_high', labelDefault: '高隱私 (High Privacy)', targetTotalEpsilon: 1.0, accentColor: '#52c41a' },
	{ key: 'medium', labelKey: 'step3_dp.preset_medium', labelDefault: '中隱私 (Medium Privacy)', targetTotalEpsilon: 5.0, accentColor: '#faad14' },
	{ key: 'low', labelKey: 'step3_dp.preset_low', labelDefault: '低隱私 (Low Privacy)', targetTotalEpsilon: 10.0, accentColor: '#fa541c' },
];

/**
 * 轉換後等效隱私預算欄位資料結構
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export type ConvertedField = DPField & {
	equivalentEpsilon: number; // 依據全域 Target Delta 換算後之等效 Epsilon 數值
};

/**
 * 函數名稱: DifferentialPrivacyRules
 * 函數功能: 渲染步驟三差分隱私規則設定介面，提供全域 Baseline δ 設定、各欄位 ε/δ 微調控制列、隱私預算消耗儀表板，以及 ECharts 噪聲加噪密度分佈圖表。
 */
export default function DifferentialPrivacyRules(): React.ReactElement 
{
	const { token } = theme.useToken();
	const isDarkModeActiveStatus = token.colorBgContainer !== '#ffffff';
	const { t: translate } = useTranslation();
	const { message: messageApi } = AntdApp.useApp();

	const currentDpFieldsList = useWorkspaceStore((state) => state.dpFields);
	const datasetColumnsList = useWorkspaceStore((state) => state.columns);
	const storeColumnRolesMap = useWorkspaceStore((state) => state.columnRoles);
	const globalTargetDeltaValue = useWorkspaceStore((state) => state.targetDelta);
	const globalBudgetLimitEpsilonValue = useWorkspaceStore((state) => state.budgetLimitEpsilon);
	const outOfBoundsStrategyTypeValue = useWorkspaceStore((state) => state.outOfBoundsStrategy);
	const setStepValidationAction = useWorkspaceStore((state) => state.setStepValidation);

	const updateFieldDP = <AttributeKey extends keyof DPField>(targetFieldIdStr: string, targetAttributeKeyName: AttributeKey, newAttributeValueData: DPField[AttributeKey]): void => 
	{
		useWorkspaceStore.setState(
			(currentStoreState) => 
			(
				{
					dpFields: currentStoreState.dpFields.map(
						(fieldItemRecord) => fieldItemRecord.id === targetFieldIdStr ? { ...fieldItemRecord, [targetAttributeKeyName]: newAttributeValueData } : fieldItemRecord
					)
				}
			)
		);
	};

	useEffect(
		() => 
		{
			if ((!currentDpFieldsList || currentDpFieldsList.length === 0) && datasetColumnsList.length > 0) 
			{
				const initialDpFieldsArray: DPField[] = datasetColumnsList
					.filter((columnNameString) => (storeColumnRolesMap[columnNameString] || '').toLowerCase() !== 'identifier')
					.map((columnNameString, columnIndexNumber) => (
						{
							id: `dp-col-${columnIndexNumber}-${columnNameString}`,
							fieldName: columnNameString,
							fieldType: (storeColumnRolesMap[columnNameString] || 'Quasi-Identifier') as DPField['fieldType'],
							enabled: true,
							epsilon: DEFAULT_EPSILON_BUDGET,
							delta: DEFAULT_DELTA_BUDGET,
							mode: 'epsilon'
						}
					));

				useWorkspaceStore.setState({ dpFields: initialDpFieldsArray });
			}
		}, 
		[datasetColumnsList, storeColumnRolesMap, currentDpFieldsList]
	);

	const activeDpFieldsList = useMemo(
		() => currentDpFieldsList.filter(fieldItemRecord => fieldItemRecord.enabled),
		[currentDpFieldsList]
	);

	/**
	 * 函數名稱: handleApplyPrivacyLevelPreset
	 * 函數功能: 將指定之「目標總預算」平均分配給目前所有已啟用的差分隱私欄位 (activeDpFieldsList)，
	 *           並同步將該目標值設定為總隱私預算上限，讓預算中心儀表板與所選隱私等級一致。
	 *
	 * 輸入參數 (Input):
	 *   - targetTotalEpsilonValue (number): 該隱私等級對應之總 ε 預算目標 (高/中/低隱私分別為 1.0／5.0／10.0)
	 * 返回值 (Return): void
	 */
	const handleApplyPrivacyLevelPreset = (targetTotalEpsilonValue: number): void =>
	{
		if (activeDpFieldsList.length === 0)
		{
			messageApi.warning(translate('step3_dp.preset_no_active_fields', '目前沒有已啟用差分隱私的欄位，無法套用預算預設。'));
			return;
		}

		const perFieldEpsilonValue = parseFloat((targetTotalEpsilonValue / activeDpFieldsList.length).toFixed(4));

		useWorkspaceStore.setState(
			(currentStoreState) =>
			(
				{
					dpFields: currentStoreState.dpFields.map(
						(fieldItemRecord) => fieldItemRecord.enabled ? { ...fieldItemRecord, epsilon: perFieldEpsilonValue } : fieldItemRecord
					),
					budgetLimitEpsilon: targetTotalEpsilonValue
				}
			)
		);

		messageApi.success(
			translate(
				'step3_dp.preset_applied',
				{
					total: targetTotalEpsilonValue,
					count: activeDpFieldsList.length,
					perField: perFieldEpsilonValue,
					defaultValue: `已將總預算 ε={{total}} 平均分配至 {{count}} 個已啟用欄位 (每欄位 ε={{perField}})`
				}
			)
		);
	};

	const equivalentConvertedFieldsList = useMemo(
		() => 
		{
			return activeDpFieldsList.map(
				(activeFieldItemRecord) => 
				{
					const originalEpsilonValue = activeFieldItemRecord.epsilon ?? DEFAULT_EPSILON_BUDGET;
					const originalDeltaValue = activeFieldItemRecord.delta ?? DEFAULT_DELTA_BUDGET;
					let calculatedEquivalentEpsilonValue = originalEpsilonValue;

					if (activeFieldItemRecord.mode === 'epsilon-delta' && originalDeltaValue > 0 && globalTargetDeltaValue > 0 && originalDeltaValue !== globalTargetDeltaValue) 
					{
						const deltaRatioCalculatedValue = Math.log(1 / globalTargetDeltaValue) / Math.log(1 / originalDeltaValue);
						calculatedEquivalentEpsilonValue = originalEpsilonValue * deltaRatioCalculatedValue;
					}

					return { ...activeFieldItemRecord, equivalentEpsilon: parseFloat(calculatedEquivalentEpsilonValue.toFixed(4)) } as ConvertedField;
				}
			);
		}, 
		[activeDpFieldsList, globalTargetDeltaValue]
	);

	const totalEquivalentEpsilonSumValue = useMemo(
		() => 
		{
			const epsilonSummationResultValue = equivalentConvertedFieldsList.reduce(
				(accumulatorValue, currentConvertedFieldItem) => accumulatorValue + currentConvertedFieldItem.equivalentEpsilon, 
				0
			);
			return parseFloat(epsilonSummationResultValue.toFixed(4));
		}, 
		[equivalentConvertedFieldsList]
	);

	// 移除 M 次邏輯，單次耗損即為總耗損
	const safeBudgetLimitThresholdValue = globalBudgetLimitEpsilonValue || DEFAULT_BUDGET_LIMIT_EPSILON;                      
	const budgetUsagePercentageValue = Math.min((totalEquivalentEpsilonSumValue / safeBudgetLimitThresholdValue) * 100, 100);          
	const isBudgetDangerAlertStatus = budgetUsagePercentageValue >= DANGER_BUDGET_USAGE_PERCENT_THRESHOLD;            
	const isBudgetWarningAlertStatus = budgetUsagePercentageValue >= WARNING_BUDGET_USAGE_PERCENT_THRESHOLD && !isBudgetDangerAlertStatus; 

	useEffect(
		() => 
		{
			if (globalTargetDeltaValue === undefined || globalTargetDeltaValue === null || globalTargetDeltaValue <= 0 || globalTargetDeltaValue >= 1) 
			{
				setStepValidationAction(false, translate('step3_dp.error_delta_invalid', '目標 Delta (δ) 必須介於 0 與 1 之間。'));
				return;
			}
			
			const hasInvalidEpsilonFieldStatus = activeDpFieldsList.some(
				(activeFieldItemRecord) => (activeFieldItemRecord.epsilon ?? DEFAULT_EPSILON_BUDGET) <= 0
			);

			if (hasInvalidEpsilonFieldStatus) 
			{
				setStepValidationAction(false, translate('step3_dp.error_epsilon_zero', '欄位中，Epsilon (ε) 必須大於 0。'));
				return;
			}

			if (totalEquivalentEpsilonSumValue > safeBudgetLimitThresholdValue) 
			{
				setStepValidationAction(false, translate('step3_dp.error_budget_exceeded', '消耗的總隱私預算已超過設定上限，請調降各欄位的 ε。'));
				return;
			}

			setStepValidationAction(true, null);
		}, 
		[globalTargetDeltaValue, activeDpFieldsList, totalEquivalentEpsilonSumValue, safeBudgetLimitThresholdValue, setStepValidationAction, translate]
	);

	const getDPEchartsOption = (): Record<string, unknown> => 
	{
		const originalDensityDistributionArray = [5, 18, 45, 85, 100, 85, 45, 18, 5];
		const sanitizedDisplayEpsilonValue = totalEquivalentEpsilonSumValue === 0 ? 0.1 : totalEquivalentEpsilonSumValue;
		const calculatedNoiseFactorMultiplierValue = Math.max(0, (10 - Math.min(10, sanitizedDisplayEpsilonValue)) / 9.9); 
		
		const noisyDensityDistributionArray = originalDensityDistributionArray.map(
			(densityDataValue) => Math.max(10, densityDataValue * (1 - calculatedNoiseFactorMultiplierValue * 0.45) + (100 - densityDataValue) * calculatedNoiseFactorMultiplierValue * 0.55)
		);

		return {
			backgroundColor: 'transparent',
			tooltip: { trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: token.colorBorder, type: 'dashed' } } },
			legend: { data: [translate('step3_dp.chart_original', '原始分佈'), translate('step3_dp.chart_noisy', '加噪後分佈')], textStyle: { color: token.colorTextSecondary }, top: '0%', icon: 'circle' },
			grid: { top: '15%', left: '5%', right: '5%', bottom: '12%', containLabel: true },
			xAxis: { type: 'category', boundaryGap: false, data: ['20K', '30K', '40K', '50K', '60K', '70K', '80K', '90K', '100K'], name: translate('step3_dp.chart_x_axis', '數值區間'), nameLocation: 'center', nameGap: 30, nameTextStyle: { color: token.colorTextSecondary, fontWeight: 500 }, axisLabel: { color: token.colorTextDescription }, axisLine: { lineStyle: { color: token.colorBorder } } },
			yAxis: { type: 'value', name: translate('step3_dp.chart_y_axis', '密度/頻率'), nameLocation: 'end', nameTextStyle: { color: token.colorTextSecondary }, axisLabel: { show: false }, splitLine: { lineStyle: { color: token.colorSplit } }, axisLine: { show: false } },
			series: [
				{ name: translate('step3_dp.chart_original', '原始分佈'), type: 'line', smooth: true, color: isDarkModeActiveStatus ? '#434343' : '#d9d9d9', data: originalDensityDistributionArray, areaStyle: { opacity: 0.05 }, lineStyle: { width: 1.5, type: 'dashed' }, showSymbol: false }, 
				{ name: translate('step3_dp.chart_noisy', '加噪後分佈'), type: 'line', smooth: true, color: token.colorPrimary, data: noisyDensityDistributionArray, areaStyle: { opacity: isDarkModeActiveStatus ? 0.2 : 0.25 }, lineStyle: { width: 3.5 }, showSymbol: false, itemStyle: { shadowBlur: 12, shadowColor: token.colorPrimary } }
			]
		};
	};

	const conversionTableColumnsConfig = [
		{ title: translate('step3_dp.col_field', '欄位名稱'), dataIndex: 'fieldName', key: 'fieldName', render: (fieldNameTextString: string) => <Text strong style={{ fontSize: 13 }}>{fieldNameTextString}</Text> },
		{ 
			title: translate('step3_dp.col_original', '原始設定'), 
			key: 'original', 
			render: (_: unknown, convertedRecordItem: ConvertedField) => (
				<div style={{ fontSize: 12, color: token.colorTextSecondary }}>
					ε: {convertedRecordItem.epsilon ?? DEFAULT_EPSILON_BUDGET} {convertedRecordItem.mode === 'epsilon-delta' && ` | δ: ${convertedRecordItem.delta ?? DEFAULT_DELTA_BUDGET}`}
				</div>
			)
		},
		{ 
			title: translate('step3_dp.col_equivalent', '等效 ε'), 
			dataIndex: 'equivalentEpsilon', 
			key: 'equivalentEpsilon', 
			align: 'right' as const,
			render: (equivalentEpsilonDataValue: number) => <Text strong style={{ color: '#722ed1', fontSize: 14 }}>{equivalentEpsilonDataValue}</Text> 
		}
	];

	return (
		<div style={{ maxWidth: '1400px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>

			{/* 頂部說明 Alert */}
			<Alert 
				title={translate('step3_dp.title', '差分隱私參數設定與評估')} 
				description={translate('step3_dp.description', '支援個別欄位的 ε-DP 與 (ε,δ)-DP 混合設定。系統將依據您的「全域目標 Delta」自動執行預算換算，並評估總預算消耗率。')} 
				type="info" 
				showIcon 
			/>

			{/* 區塊 1：全域隱私目標設定 */}
			<Card 
				title={<span style={{ display: 'flex', alignItems: 'center' }}><GlobalOutlined style={{ marginRight: 8, color: token.colorPrimary }} />{translate('step3_dp.global_settings_title', '1. 全域隱私目標設定')}</span>} 
				variant="borderless" 
				style={{ background: token.colorBgContainer, boxShadow: isDarkModeActiveStatus ? 'none' : '0 2px 8px rgba(0,0,0,0.04)' }}
			>
				{/* ★ 修正排版：改為均分 3 等分的 span={8}，視覺更平衡 */}
				<Row gutter={[48, 32]}>
					<Col span={8}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
								<Text strong>{translate('step3_dp.global_delta', '全域目標 Delta (基準 δ)')}</Text>
								<InputNumber 
									min={1e-10} max={0.9999999999} step={0.0001} 
									value={globalTargetDeltaValue} 
									onChange={(inputTargetDeltaNumberValue) => useWorkspaceStore.setState({ targetDelta: inputTargetDeltaNumberValue ?? DEFAULT_GLOBAL_TARGET_DELTA })} 
									style={{ width: '120px' }} 
									stringMode
								/>
							</div>
							<Text type="secondary" style={{ fontSize: 13, lineHeight: 1.5, textAlign: 'left' }}>
								{translate('step3_dp.global_delta_desc', '定義資料集整體的容錯率上限。當欄位模式為 (ε,δ)-DP 時，將以此值為基準進行隱私預算的統一換算。')}
							</Text>
						</div>
					</Col>

					<Col span={8}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
								<Text strong>{translate('step3_dp.budget_limit_label', '總隱私預算上限 (ε Limit)')}</Text>
								<InputNumber 
									step={0.5} 
									value={globalBudgetLimitEpsilonValue} 
									onChange={(inputBudgetLimitNumberValue) => useWorkspaceStore.setState({ budgetLimitEpsilon: inputBudgetLimitNumberValue === null ? undefined : inputBudgetLimitNumberValue })} 
									onBlur={
										(inputBlurEventObj) => 
										{
											const parsedCurrentInputNumberValue = parseFloat(inputBlurEventObj.target.value);
											if (isNaN(parsedCurrentInputNumberValue)) useWorkspaceStore.setState({ budgetLimitEpsilon: DEFAULT_BUDGET_LIMIT_EPSILON });
											else if (parsedCurrentInputNumberValue < MIN_EPSILON_BUDGET_LIMIT) useWorkspaceStore.setState({ budgetLimitEpsilon: MIN_EPSILON_BUDGET_LIMIT });
											else if (parsedCurrentInputNumberValue > MAX_EPSILON_BUDGET_LIMIT) useWorkspaceStore.setState({ budgetLimitEpsilon: MAX_EPSILON_BUDGET_LIMIT });
										}
									}
									style={{ width: '120px' }} 
								/>
							</div>
							<Text type="secondary" style={{ fontSize: 13, lineHeight: 1.5, textAlign: 'left' }}>
								{translate('step3_dp.budget_limit_desc', '設定系統觸發預算風險警告前的最大允許 Epsilon (ε) 預算額度。')}
							</Text>
						</div>
					</Col>

					<Col span={8}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
								<Text strong>{translate('step3_dp.out_of_bounds_strategy', '數值越界處理策略')}</Text>
								<Select 
									value={outOfBoundsStrategyTypeValue ?? 'clip'} 
									onChange={(dropdownSelectedStrategyString) => useWorkspaceStore.setState({ outOfBoundsStrategy: dropdownSelectedStrategyString })} 
									style={{ width: '160px' }}
									options={
										[
											{ value: 'clip', label: translate('step3_dp.strategy_clip', '1. 截斷至邊界') },
											{ value: 'wrap', label: translate('step3_dp.strategy_wrap', '2. 環繞機制') },
											{ value: 'reflect', label: translate('step3_dp.strategy_reflect', '3. 鏡像反射') },
										]
									}
								/>
							</div>
							<Text type="secondary" style={{ fontSize: 13, lineHeight: 1.5, textAlign: 'left' }}>
								{translate('step3_dp.out_of_bounds_desc', '當數值型資料加入雜訊後超出邊界時，系統將依據此策略進行數值校正以確保合理性。')}
							</Text>
						</div>
					</Col>
				</Row>
			</Card>

			{/* 區塊 2：個別欄位 ε/δ 參數微調列表 */}
			<Card
				title={<span><ControlOutlined style={{ marginRight: 8, color: '#13c2c2' }} />{translate('step3_dp.field_tuning_title', '2. 個別欄位隱私預算微調')}</span>}
				extra={
					<Space size={8}>
						<Space size={4}>
							<ThunderboltOutlined style={{ fontSize: 12, color: token.colorTextTertiary }} />
							<Text type="secondary" style={{ fontSize: 12, fontWeight: 500 }}>{translate('step3_dp.preset_label', '快速套用：')}</Text>
						</Space>
						{PRIVACY_LEVEL_PRESET_LIST.map(
							(presetItemRecord) => (
								<Button
									key={presetItemRecord.key}
									size="small"
									shape="round"
									onClick={() => handleApplyPrivacyLevelPreset(presetItemRecord.targetTotalEpsilon)}
									style={{
										color: presetItemRecord.accentColor,
										borderColor: `${presetItemRecord.accentColor}66`,
										background: `${presetItemRecord.accentColor}14`,
										fontWeight: 600,
										boxShadow: 'none',
										transition: 'background 0.2s ease, border-color 0.2s ease',
									}}
									onMouseEnter={(mouseEnterEvent) => {
										mouseEnterEvent.currentTarget.style.background = `${presetItemRecord.accentColor}29`;
										mouseEnterEvent.currentTarget.style.borderColor = presetItemRecord.accentColor;
									}}
									onMouseLeave={(mouseLeaveEvent) => {
										mouseLeaveEvent.currentTarget.style.background = `${presetItemRecord.accentColor}14`;
										mouseLeaveEvent.currentTarget.style.borderColor = `${presetItemRecord.accentColor}66`;
									}}
								>
									<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
										<span style={{ width: 6, height: 6, borderRadius: '50%', background: presetItemRecord.accentColor, display: 'inline-block' }} />
										{translate(presetItemRecord.labelKey, presetItemRecord.labelDefault)}
										<span style={{ opacity: 0.75, fontWeight: 400 }}>(ε={presetItemRecord.targetTotalEpsilon})</span>
									</span>
								</Button>
							)
						)}
					</Space>
				}
				variant="borderless"
				style={{ background: token.colorBgContainer, boxShadow: isDarkModeActiveStatus ? 'none' : '0 2px 8px rgba(0,0,0,0.04)' }}
				styles={{ body: { padding: '16px' } }}
			>
				<div 
					style={
						{ 
							maxHeight: '320px', 
							overflowY: 'auto', 
							paddingRight: '12px',
							display: 'flex', 
							flexDirection: 'column', 
							gap: '8px' 
						}
					}
				>
					{activeDpFieldsList.length === 0 ? (
						<Text type="secondary" style={{ textAlign: 'center', padding: '24px 0', display: 'block' }}>
							未包含需執行差分隱私處理的欄位。
						</Text>
					) : (
						activeDpFieldsList.map(
							(activeFieldItemRecord) => 
							(
								<div 
									key={activeFieldItemRecord.id}
									style={
										{
											display: 'flex',
											alignItems: 'center',
											padding: '12px 16px',
											background: isDarkModeActiveStatus ? '#1f1f1f' : '#f8fafc',
											border: `1px solid ${token.colorPrimaryBorder}`,
											borderRadius: '8px',
											transition: 'all 0.2s ease',
										}
									}
								>
									<div style={{ flex: '0 0 25%', display: 'flex', alignItems: 'center', gap: '12px' }}>
										<div style={{ overflow: 'hidden' }}>
											<Text strong style={{ display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
												{activeFieldItemRecord.fieldName}
											</Text>
											<Text type="secondary" style={{ fontSize: '12px' }}>{activeFieldItemRecord.fieldType || 'QI'}</Text>
										</div>
									</div>

									<div style={{ flex: 1, display: 'flex', gap: '24px', alignItems: 'center' }}>
										<Select 
											size="middle" 
											value={activeFieldItemRecord.mode || 'epsilon'} 
											onChange={(dropdownSelectedModeString) => updateFieldDP(activeFieldItemRecord.id, 'mode', dropdownSelectedModeString)}
											options={[{ value: 'epsilon', label: 'ε-DP' }, { value: 'epsilon-delta', label: '(ε, δ)-DP' }]}
											style={{ width: '110px' }}
										/>

										<div style={{ flex: 1, display: 'flex', gap: '24px', alignItems: 'center' }}>
											<div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
												<Text type="secondary" style={{ width: '20px', textAlign: 'right' }}>ε</Text>
												<Slider 
													min={0.01} max={20} step={0.01} 
													value={activeFieldItemRecord.epsilon ?? DEFAULT_EPSILON_BUDGET} 
													onChange={(sliderEpsilonNumberValue) => updateFieldDP(activeFieldItemRecord.id, 'epsilon', sliderEpsilonNumberValue)} 
													style={{ flex: 1, margin: 0 }}
												/>
												<InputNumber 
													min={0.001} max={100} step={0.01} 
													value={activeFieldItemRecord.epsilon ?? DEFAULT_EPSILON_BUDGET} 
													onChange={(inputEpsilonNumberValue) => updateFieldDP(activeFieldItemRecord.id, 'epsilon', inputEpsilonNumberValue || 0.01)} 
													size="small" style={{ width: '100px' }} 
												/>
											</div>

											{activeFieldItemRecord.mode === 'epsilon-delta' && (
												<div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
													<Text type="secondary" style={{ width: '20px', textAlign: 'right' }}>δ</Text>
													<Slider 
														min={1e-8} max={0.1} step={0.0001} 
														value={activeFieldItemRecord.delta ?? DEFAULT_DELTA_BUDGET} 
														onChange={(sliderDeltaNumberValue) => updateFieldDP(activeFieldItemRecord.id, 'delta', sliderDeltaNumberValue)} 
														style={{ flex: 1, margin: 0 }} 
														tooltip={{ formatter: (tooltipDeltaNumberValue) => tooltipDeltaNumberValue?.toFixed(6) }}
													/>
													<InputNumber 
														min={1e-10} max={0.99} step={0.0001} 
														value={activeFieldItemRecord.delta ?? DEFAULT_DELTA_BUDGET} 
														onChange={(inputDeltaNumberValue) => updateFieldDP(activeFieldItemRecord.id, 'delta', inputDeltaNumberValue || DEFAULT_DELTA_BUDGET)} 
														size="small" style={{ width: '100px' }} 
														stringMode
													/>
												</div>
											)}
										</div>
									</div>
								</div>
							)
						)
					)}
				</div>
			</Card>

			{/* 區塊 3 與 4：預算中心與圖表模擬 */}
			<Row gutter={24} style={{ alignItems: 'stretch' }}>
				
				{/* 區塊 3：隱私預算中心儀表板 */}
				<Col span={8}>
					<Card 
						title={<span><DashboardOutlined style={{ marginRight: 8, color: '#faad14' }} />{translate('step3_dp.card2_title', '3. 隱私預算中心')}</span>} 
						variant="borderless" 
						style={
							{ 
								height: '100%', 
								background: isDarkModeActiveStatus ? '#141414' : '#fafafa',
								border: `1px solid ${isDarkModeActiveStatus ? '#303030' : '#e8e8e8'}`,
								boxShadow: isDarkModeActiveStatus ? 'inset 0 2px 10px rgba(0,0,0,0.5)' : 'none'
							}
						}
					>
						<div style={{ textAlign: 'center', padding: '24px 0 16px 0' }}>
							<Progress 
								type="dashboard" 
								percent={budgetUsagePercentageValue} 
								format={() => `${totalEquivalentEpsilonSumValue}`}
								strokeColor={isBudgetDangerAlertStatus ? { '0%': '#ff4d4f', '100%': '#cf1322' } : isBudgetWarningAlertStatus ? { '0%': '#faad14', '100%': '#d48806' } : { '0%': '#13c2c2', '100%': '#52c41a' }}
								strokeWidth={10} 
								size={220} 
								style={{ filter: isDarkModeActiveStatus ? 'drop-shadow(0 0 8px rgba(0,0,0,0.5))' : 'none' }}
							/>

							<div style={{ marginTop: 24 }}>
								<Text type="secondary" style={{ fontSize: 14, display: 'block', marginBottom: 4 }}>
									{translate('step3_dp.accumulated_cost', { limit: safeBudgetLimitThresholdValue, defaultValue: `總預算消耗 / 預算上限 (${safeBudgetLimitThresholdValue})` })}
								</Text>

								<Tag 
									color={isBudgetDangerAlertStatus ? 'error' : isBudgetWarningAlertStatus ? 'warning' : 'success'} 
									style={{ fontSize: 16, padding: '4px 16px', borderRadius: 4, fontWeight: 'bold' }}
								>
									{isBudgetDangerAlertStatus ? translate('step3_dp.budget_danger', '預算透支風險') : isBudgetWarningAlertStatus ? translate('step3_dp.budget_warning', '預算水位偏低') : translate('step3_dp.budget_safe', '預算水位安全')}
								</Tag>
							</div>
						</div>

						<Divider style={{ margin: '24px 0', borderColor: isDarkModeActiveStatus ? '#303030' : '#e8e8e8' }} />
						
						<Table 
							dataSource={equivalentConvertedFieldsList}
							columns={conversionTableColumnsConfig}
							rowKey="id"
							pagination={false}
							size="small"
							bordered={false}
							scroll={{ y: 160 }}
							style={{ background: 'transparent' }}
							footer={
								() => 
								(
									<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 15, padding: '8px 4px 0 4px' }}>
										<Text strong>{translate('step3_dp.single_equivalent', '各欄位等效加總')}</Text>
										<Text strong style={{ color: '#722ed1', fontSize: 18 }}>ε = {totalEquivalentEpsilonSumValue}</Text>
									</div>
								)
							}
						/>
					</Card>
				</Col>

				{/* 區塊 4：全域噪聲分佈模擬圖表 */}
				<Col span={16}>
					<Card 
						title={<span><LineChartOutlined style={{ marginRight: 8, color: '#722ed1' }} />{translate('step3_dp.card3_title', '4. 全域動態噪聲分佈模擬')}</span>} 
						variant="borderless" 
						style={
							{ 
								height: '100%', 
								background: isDarkModeActiveStatus ? '#141414' : '#fafafa',
								border: `1px solid ${isDarkModeActiveStatus ? '#303030' : '#e8e8e8'}`,
								boxShadow: isDarkModeActiveStatus ? 'inset 0 2px 10px rgba(0,0,0,0.5)' : 'none'
							}
						}
					>
						<div style={{ display: 'flex', gap: '48px', marginBottom: '8px', padding: '0 16px' }}>
							<Statistic 
								title={<Text type="secondary" style={{ fontSize: 14 }}>{translate('step3_dp.unified_eps', '總等效 Epsilon')}</Text>} 
								value={totalEquivalentEpsilonSumValue} 
								prefix={<CalculatorOutlined style={{ fontSize: 24, marginRight: 8, color: token.colorPrimary }} />} 
								formatter={(formatterOutputValue) => <span style={{ fontSize: 42, fontWeight: 'bold', color: token.colorPrimary }}>{formatterOutputValue}</span>}
							/>

							<Statistic 
								title={<Text type="secondary" style={{ fontSize: 14 }}>{translate('step3_dp.protection_level', '當前保護強度')}</Text>} 
								value={totalEquivalentEpsilonSumValue <= HIGH_SECURITY_EPSILON_THRESHOLD ? translate('step3_dp.level_high', '高強度 (High)') : totalEquivalentEpsilonSumValue <= MEDIUM_SECURITY_EPSILON_THRESHOLD ? translate('step3_dp.level_medium', '中強度 (Medium)') : translate('step3_dp.level_low', '低強度 (Low)')} 
								prefix={<LockOutlined style={{ fontSize: 28, marginRight: 8, color: totalEquivalentEpsilonSumValue <= HIGH_SECURITY_EPSILON_THRESHOLD ? '#722ed1' : totalEquivalentEpsilonSumValue <= MEDIUM_SECURITY_EPSILON_THRESHOLD ? '#13c2c2' : '#fa8c16' }} />} 
								formatter={(formatterOutputValue) => <span style={{ fontSize: 42, fontWeight: 'bold', color: totalEquivalentEpsilonSumValue <= HIGH_SECURITY_EPSILON_THRESHOLD ? '#722ed1' : totalEquivalentEpsilonSumValue <= MEDIUM_SECURITY_EPSILON_THRESHOLD ? '#13c2c2' : '#fa8c16' }}>{formatterOutputValue}</span>}
							/>
						</div>

						<Divider style={{ margin: '16px 0', borderColor: isDarkModeActiveStatus ? '#303030' : '#e8e8e8' }} />

						<ReactECharts option={getDPEchartsOption()} style={{ height: '420px', width: '100%' }} theme={isDarkModeActiveStatus ? 'dark' : 'light'} />
					</Card>
				</Col>

			</Row>
		</div>
	);
}