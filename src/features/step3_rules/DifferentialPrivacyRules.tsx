/**
 * ============================================================================
 * 檔案名稱 (File): DifferentialPrivacyRules.tsx
 * 模組功能 (Description): 差分隱私參數設定與隱私預算中心組件 (提供全域與個別欄位 ε/δ 參數微調、等效隱私預算換算、連續查詢累積耗損與動態噪聲分佈模擬)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字)
 * ============================================================================
 */

import React, { useMemo, useEffect } from 'react';
import { 
	Alert, Card, Slider, Row, Col, Statistic, Divider, 
	InputNumber, theme, Select, Space, Progress, Typography, Table, Tag
} from 'antd';
import { 
	LineChartOutlined, CalculatorOutlined, 
	DashboardOutlined, GlobalOutlined, ControlOutlined, LockOutlined
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
const DEFAULT_QUERY_COUNT = 1;
const DEFAULT_BUDGET_LIMIT_EPSILON = 10;
const MIN_EPSILON_BUDGET_LIMIT = 0.1;
const MAX_EPSILON_BUDGET_LIMIT = 100;
const DANGER_BUDGET_USAGE_PERCENT_THRESHOLD = 90;
const WARNING_BUDGET_USAGE_PERCENT_THRESHOLD = 75;
const HIGH_SECURITY_EPSILON_THRESHOLD = 2.0;
const MEDIUM_SECURITY_EPSILON_THRESHOLD = 8.0;

/**
 * 轉換後等效隱私預算欄位資料結構
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export type ConvertedField = DPField & {
	equivalentEpsilon: number; // 依據全域 Target Delta 換算後之等效 Epsilon 數值
};

/**
 * 函數名稱: DifferentialPrivacyRules
 * 函數功能: 渲染步驟三差分隱私規則設定介面，提供全域 Baseline δ 設定、模擬連續查詢次數滑桿、各欄位 ε/δ 微調控制列、隱私預算消耗儀表板，以及 ECharts 噪聲加噪密度分佈圖表。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 差分隱私規則設定 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 
 *   - 被 Step 3 導覽精靈組件載入渲染
 *   - 訂閱與更新 useWorkspaceStore 中的 targetDelta, queryCount, dpFields 等全域狀態
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function DifferentialPrivacyRules(): React.ReactElement 
{
	const { token } = theme.useToken();
	
	// 深色主題狀態判定 (符合規範 g)
	const isDarkModeActiveStatus = token.colorBgContainer !== '#ffffff';

	const { t: translate } = useTranslation();
	
	// 從 WorkspaceStore 讀取全域狀態與 Action (符合規範 g, i)
	const currentDpFieldsList = useWorkspaceStore(
		(state) => state.dpFields
	);

	const datasetColumnsList = useWorkspaceStore(
		(state) => state.columns
	);

	const storeColumnRolesMap = useWorkspaceStore(
		(state) => state.columnRoles
	);

	const globalTargetDeltaValue = useWorkspaceStore(
		(state) => state.targetDelta
	);

	const simulatedQueryCountValue = useWorkspaceStore(
		(state) => state.queryCount
	);

	const globalBudgetLimitEpsilonValue = useWorkspaceStore(
		(state) => state.budgetLimitEpsilon
	);

	const outOfBoundsStrategyTypeValue = useWorkspaceStore(
		(state) => state.outOfBoundsStrategy
	);

	const setStepValidationAction = useWorkspaceStore(
		(state) => state.setStepValidation
	);

	/**
	 * 函數名稱: updateFieldDP
	 * 函數功能: 局部更新特定 ID 之 DPField 屬性值至全域 Zustand Store。
	 * 
	 * 輸入參數 (Input):
	 *   - targetFieldIdStr (string): 欄位識別碼
	 *   - targetAttributeKeyName (AttributeKey): DPField 屬性鍵值
	 *   - newAttributeValueData (DPField[AttributeKey]): 更新之數值
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 於欄位微調 Select, Slider, InputNumber onChange 時調用
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記
	 */
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

	// 進入元件防呆初始化：若未有 dpFields 設定，自動過濾非 Identifier 欄位進行預設初始化 (符合規範 g)
	useEffect(
		() => 
		{
			if ((!currentDpFieldsList || currentDpFieldsList.length === 0) && datasetColumnsList.length > 0) 
			{
				const initialDpFieldsArray: DPField[] = datasetColumnsList
					.filter(
						(columnNameString) => (storeColumnRolesMap[columnNameString] || '').toLowerCase() !== 'identifier'
					)
					.map(
						(columnNameString, columnIndexNumber) => 
						(
							{
								id: `dp-col-${columnIndexNumber}-${columnNameString}`,
								fieldName: columnNameString,
								fieldType: (storeColumnRolesMap[columnNameString] || 'Quasi-Identifier') as DPField['fieldType'],
								enabled: true,
								epsilon: DEFAULT_EPSILON_BUDGET,
								delta: DEFAULT_DELTA_BUDGET,
								mode: 'epsilon'
							}
						)
					);

				useWorkspaceStore.setState({ dpFields: initialDpFieldsArray });
			}
		}, 
		[datasetColumnsList, storeColumnRolesMap, currentDpFieldsList]
	);

	// 篩選已啟用差分隱私處理之欄位 (符合規範 g)
	const activeDpFieldsList = useMemo(
		() => currentDpFieldsList.filter(fieldItemRecord => fieldItemRecord.enabled), 
		[currentDpFieldsList]
	);

	// 依據全域 Target Delta 計算各欄位之等效 ε (ConvertedField) (符合規範 g)
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

	// 計算單次查詢之總等效 Epsilon 數值 (符合規範 g)
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

	// 計算經過 M 次連續查詢後累積消耗之 Epsilon 總成本與預算門檻比較 (符合規範 g)
	const accumulatedEpsilonCostValue = parseFloat((totalEquivalentEpsilonSumValue * simulatedQueryCountValue).toFixed(3)); // 累積耗損 ε

	const safeBudgetLimitThresholdValue = globalBudgetLimitEpsilonValue || DEFAULT_BUDGET_LIMIT_EPSILON;                      // 安全預算門檻

	const budgetUsagePercentageValue = Math.min((accumulatedEpsilonCostValue / safeBudgetLimitThresholdValue) * 100, 100);          // 預算耗用百分比

	const isBudgetDangerAlertStatus = budgetUsagePercentageValue >= DANGER_BUDGET_USAGE_PERCENT_THRESHOLD;            // 是否達到預算危險警戒 (>= 90%)

	const isBudgetWarningAlertStatus = budgetUsagePercentageValue >= WARNING_BUDGET_USAGE_PERCENT_THRESHOLD && !isBudgetDangerAlertStatus; // 是否達到預算警告警戒 (75% ~ 89%)

	// 即時檢查隱私預算與 Delta 數值合規性，更新步驟導引驗證狀態 (符合規範 g)
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

			if (accumulatedEpsilonCostValue > safeBudgetLimitThresholdValue) 
			{
				setStepValidationAction(false, translate('step3_dp.error_budget_exceeded', '消耗的總隱私預算已超過設定上限，請調降各欄位的 ε 或是減少模擬查詢次數。'));

				return;
			}

			setStepValidationAction(true, null);
		}, 
		[globalTargetDeltaValue, activeDpFieldsList, accumulatedEpsilonCostValue, safeBudgetLimitThresholdValue, setStepValidationAction, translate]
	);

	/**
	 * 函數名稱: getDPEchartsOption
	 * 函數功能: 依據當前總等效 Epsilon 計算噪聲干擾程度，構建並回傳 ECharts 折線分佈圖表 Option 物件。
	 * 
	 * 輸入參數 (Input): 無
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): 
	 *   - Record<string, unknown>: ECharts 設定選項物件
	 * 呼叫關係 (Call Relations): 綁定於 ReactECharts 元件之 option 屬性
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記
	 */
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
			legend: { data: [translate('step3_dp.chart_original', 'Original Distribution'), translate('step3_dp.chart_noisy', 'Noisy Distribution')], textStyle: { color: token.colorTextSecondary }, top: '0%', icon: 'circle' },
			grid: { top: '15%', left: '5%', right: '5%', bottom: '12%', containLabel: true },
			xAxis: { type: 'category', boundaryGap: false, data: ['20K', '30K', '40K', '50K', '60K', '70K', '80K', '90K', '100K'], name: translate('step3_dp.chart_x_axis', 'Value Range'), nameLocation: 'center', nameGap: 30, nameTextStyle: { color: token.colorTextSecondary, fontWeight: 500 }, axisLabel: { color: token.colorTextDescription }, axisLine: { lineStyle: { color: token.colorBorder } } },
			yAxis: { type: 'value', name: translate('step3_dp.chart_y_axis', 'Density/Frequency'), nameLocation: 'end', nameTextStyle: { color: token.colorTextSecondary }, axisLabel: { show: false }, splitLine: { lineStyle: { color: token.colorSplit } }, axisLine: { show: false } },
			series: [
				{ name: translate('step3_dp.chart_original', 'Original Distribution'), type: 'line', smooth: true, color: isDarkModeActiveStatus ? '#434343' : '#d9d9d9', data: originalDensityDistributionArray, areaStyle: { opacity: 0.05 }, lineStyle: { width: 1.5, type: 'dashed' }, showSymbol: false }, 
				{ name: translate('step3_dp.chart_noisy', 'Noisy Distribution'), type: 'line', smooth: true, color: token.colorPrimary, data: noisyDensityDistributionArray, areaStyle: { opacity: isDarkModeActiveStatus ? 0.2 : 0.25 }, lineStyle: { width: 3.5 }, showSymbol: false, itemStyle: { shadowBlur: 12, shadowColor: token.colorPrimary } }
			]
		};
	};

	// 隱私預算中心對照表格欄位定義 (符合規範 g, h)
	const conversionTableColumnsConfig = [
		{ title: translate('step3_dp.col_field', 'Field Name'), dataIndex: 'fieldName', key: 'fieldName', render: (fieldNameTextString: string) => <Text strong style={{ fontSize: 13 }}>{fieldNameTextString}</Text> },
		{ 
			title: translate('step3_dp.col_original', 'Original Setting'), 
			key: 'original', 
			render: (_: unknown, convertedRecordItem: ConvertedField) => (
				<div style={{ fontSize: 12, color: token.colorTextSecondary }}>
					ε: {convertedRecordItem.epsilon ?? DEFAULT_EPSILON_BUDGET} {convertedRecordItem.mode === 'epsilon-delta' && ` | δ: ${convertedRecordItem.delta ?? DEFAULT_DELTA_BUDGET}`}
				</div>
			)
		},
		{ 
			title: translate('step3_dp.col_equivalent', 'Equivalent ε'), 
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
				title={translate('step3_dp.title', 'Set Differential Privacy Parameters')} 
				description={translate('step3_dp.description', 'Supports per-field ε-DP and (ε,δ)-DP settings. The system converts budgets uniformly based on your Global Target Delta and tracks total budget consumption across multiple queries.')} 
				type="info" 
				showIcon 
			/>

			{/* 區塊 1：全域隱私目標與連續查詢模擬設定 */}
			<Card 
				title={<span><GlobalOutlined style={{ marginRight: 8, color: token.colorPrimary }} />{translate('step3_dp.global_settings_title', '1. Global Privacy Target Settings')}</span>} 
				variant="borderless" 
				style={{ background: token.colorBgContainer, boxShadow: isDarkModeActiveStatus ? 'none' : '0 2px 8px rgba(0,0,0,0.04)' }}
			>
				<Row gutter={48}>
					<Col span={12}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
								<Text strong>{translate('step3_dp.global_delta', 'Global Target Delta (Baseline δ)')}</Text>

								<InputNumber 
									min={1e-10} max={0.9999999999} step={0.0001} 
									value={globalTargetDeltaValue} 
									onChange={
										(inputTargetDeltaNumberValue) => useWorkspaceStore.setState({ targetDelta: inputTargetDeltaNumberValue ?? DEFAULT_GLOBAL_TARGET_DELTA })
									} 
									style={{ width: '150px' }} 
									stringMode
								/>
							</div>

							<Text type="secondary" style={{ fontSize: 13 }}>
								{translate('step3_dp.global_delta_desc', 'Defines the overall dataset error tolerance ceiling. Used as a baseline for conversion when fields are set to epsilon-delta mode.')}
							</Text>
						</div>
					</Col>

					<Col span={12}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
								<Text strong>{translate('step3_dp.simulate_query', 'Simulated Continuous Queries / Publishes')}</Text>

								<Space>
									<Text strong style={{ color: token.colorWarning }}>{translate('step3_dp.query_times', { count: simulatedQueryCountValue, defaultValue: `${simulatedQueryCountValue} Times` })}</Text>

									<InputNumber 
										min={1} max={10000} 
										value={simulatedQueryCountValue} 
										onChange={
											(inputSimulatedQueryNumberValue) => useWorkspaceStore.setState({ queryCount: inputSimulatedQueryNumberValue ?? DEFAULT_QUERY_COUNT })
										} 
										size="small" style={{ width: '100px' }} 
									/>
								</Space>
							</div>

							<Slider 
								min={1} max={1000} 
								value={simulatedQueryCountValue} 
								onChange={
									(sliderSimulatedQueryCountValue) => useWorkspaceStore.setState({ queryCount: sliderSimulatedQueryCountValue })
								} 
								style={{ margin: 0 }}
							/>
						</div>
					</Col>
				</Row>
				
				<Divider dashed style={{ margin: '20px 0' }} />

				<Row gutter={48}>
					<Col span={12}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
								<Text strong>{translate('step3_dp.budget_limit_label', 'Total Budget Limit (ε Limit)')}</Text>

								<InputNumber 
									step={0.5} 
									value={globalBudgetLimitEpsilonValue} 
									onChange={
										(inputBudgetLimitNumberValue) => useWorkspaceStore.setState({ budgetLimitEpsilon: inputBudgetLimitNumberValue === null ? undefined : inputBudgetLimitNumberValue })
									} 
									onBlur={
										(inputBlurEventObj) => 
										{
											const parsedCurrentInputNumberValue = parseFloat(inputBlurEventObj.target.value);

											if (isNaN(parsedCurrentInputNumberValue)) 
											{
												useWorkspaceStore.setState({ budgetLimitEpsilon: DEFAULT_BUDGET_LIMIT_EPSILON });
											} 
											else if (parsedCurrentInputNumberValue < MIN_EPSILON_BUDGET_LIMIT) 
											{
												useWorkspaceStore.setState({ budgetLimitEpsilon: MIN_EPSILON_BUDGET_LIMIT });
											} 
											else if (parsedCurrentInputNumberValue > MAX_EPSILON_BUDGET_LIMIT) 
											{
												useWorkspaceStore.setState({ budgetLimitEpsilon: MAX_EPSILON_BUDGET_LIMIT });
											}
										}
									}
									style={{ width: '150px' }} 
								/>
							</div>

							<Text type="secondary" style={{ fontSize: 13 }}>
								{translate('step3_dp.budget_limit_desc', 'Set maximum allowable cumulative epsilon budget before system flags budget risk.')}
							</Text>
						</div>
					</Col>

					<Col span={12}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
								<Text strong>{translate('step3_dp.out_of_bounds_strategy', 'Out-of-Bounds Strategy')}</Text>

								<Select 
									value={outOfBoundsStrategyTypeValue ?? 'clip'} 
									onChange={
										(dropdownSelectedStrategyString) => useWorkspaceStore.setState({ outOfBoundsStrategy: dropdownSelectedStrategyString })
									} 
									style={{ width: '220px' }}
									options={
										[
											{ value: 'clip', label: translate('step3_dp.strategy_clip', '1. Clamp / Clip to Bounds') },
											{ value: 'wrap', label: translate('step3_dp.strategy_wrap', '2. Wrap-around (Modulo)') },
											{ value: 'reflect', label: translate('step3_dp.strategy_reflect', '3. Reflect / Bounce Back') },
										]
									}
								/>
							</div>

							<Text type="secondary" style={{ fontSize: 13 }}>
								{translate('step3_dp.out_of_bounds_desc', 'When noisy numerical data exceeds lower/upper bounds, applies post-processing to keep values realistic.')}
							</Text>
						</div>
					</Col>
				</Row>
			</Card>

			{/* 區塊 2：個別欄位 ε/δ 參數微調列表 */}
			<Card 
				title={<span><ControlOutlined style={{ marginRight: 8, color: '#13c2c2' }} />{translate('step3_dp.field_tuning_title', '2. Individual Field Fine-Tuning')}</span>} 
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
													min={0.01} max={10} step={0.01} 
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
						title={<span><DashboardOutlined style={{ marginRight: 8, color: '#faad14' }} />{translate('step3_dp.card2_title', '3. Privacy Budget Center')}</span>} 
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
								format={() => `${accumulatedEpsilonCostValue}`}
								strokeColor={isBudgetDangerAlertStatus ? { '0%': '#ff4d4f', '100%': '#cf1322' } : isBudgetWarningAlertStatus ? { '0%': '#faad14', '100%': '#d48806' } : { '0%': '#13c2c2', '100%': '#52c41a' }}
								strokeWidth={10} 
								size={220} 
								style={{ filter: isDarkModeActiveStatus ? 'drop-shadow(0 0 8px rgba(0,0,0,0.5))' : 'none' }}
							/>

							<div style={{ marginTop: 24 }}>
								<Text type="secondary" style={{ fontSize: 14, display: 'block', marginBottom: 4 }}>
									{translate('step3_dp.accumulated_cost', { limit: safeBudgetLimitThresholdValue, defaultValue: `Accumulated Cost / Limit (${safeBudgetLimitThresholdValue})` })}
								</Text>

								<Tag 
									color={isBudgetDangerAlertStatus ? 'error' : isBudgetWarningAlertStatus ? 'warning' : 'success'} 
									style={{ fontSize: 16, padding: '4px 16px', borderRadius: 4, fontWeight: 'bold' }}
								>
									{isBudgetDangerAlertStatus ? translate('step3_dp.budget_danger', 'Over Budget Risk') : isBudgetWarningAlertStatus ? translate('step3_dp.budget_warning', 'Budget Running Low') : translate('step3_dp.budget_safe', 'Sufficient Budget')}
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
										<Text strong>{translate('step3_dp.single_equivalent', 'Single Query Equivalent')}</Text>
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
						title={<span><LineChartOutlined style={{ marginRight: 8, color: '#722ed1' }} />{translate('step3_dp.card3_title', '4. Global Noise Simulation')}</span>} 
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
								title={<Text type="secondary" style={{ fontSize: 14 }}>{translate('step3_dp.unified_eps', 'Total Equivalent Epsilon')}</Text>} 
								value={totalEquivalentEpsilonSumValue} 
								prefix={<CalculatorOutlined style={{ fontSize: 24, marginRight: 8, color: token.colorPrimary }} />} 
								formatter={(formatterOutputValue) => <span style={{ fontSize: 42, fontWeight: 'bold', color: token.colorPrimary }}>{formatterOutputValue}</span>}
							/>

							<Statistic 
								title={<Text type="secondary" style={{ fontSize: 14 }}>{translate('step3_dp.protection_level', 'Current Protection Level')}</Text>} 
								value={totalEquivalentEpsilonSumValue <= HIGH_SECURITY_EPSILON_THRESHOLD ? translate('step3_dp.level_high', 'High Security') : totalEquivalentEpsilonSumValue <= MEDIUM_SECURITY_EPSILON_THRESHOLD ? translate('step3_dp.level_medium', 'Medium Security') : translate('step3_dp.level_low', 'Low Security')} 
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