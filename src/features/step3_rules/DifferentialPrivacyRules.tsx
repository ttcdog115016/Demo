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
	InputNumber, theme, Select, Progress, Typography, Table, Tag, Button, Space, Tooltip, App as AntdApp
} from 'antd';
import {
	LineChartOutlined, CalculatorOutlined,
	DashboardOutlined, GlobalOutlined, ControlOutlined, LockOutlined, ThunderboltOutlined, QuestionCircleOutlined
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore, type DPField } from '../../store/useWorkspaceStore';
import {
	resolveIsDateTimeDpField, resolveInputNumberStepByDecimals, resolveDpDatetimeNoiseUnit, applyDpDatetimeNoiseUnit, findDpBoundsFinerThanNoiseUnit,
	DP_DATETIME_NOISE_UNITS, type DpDatetimeNoiseUnit
} from '../../utils/dpFieldHelpers';
import { computeDefaultDpSensitivity, computeDpConsumedBudgetsByField, sumDpConsumedBudgets } from '../../utils/pipelineConfig';

const { Text } = Typography;

/**
 * 預設隱私參數常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const DEFAULT_EPSILON_BUDGET = 1.0;
const DEFAULT_DELTA_BUDGET = 1e-5;
const DEFAULT_BUDGET_LIMIT_EPSILON = 20;
const MIN_EPSILON_BUDGET_LIMIT = 0.1;
const MAX_EPSILON_BUDGET_LIMIT = 100;
const DANGER_BUDGET_USAGE_PERCENT_THRESHOLD = 90;
const WARNING_BUDGET_USAGE_PERCENT_THRESHOLD = 75;
// ★ 修正: 使用者更正風險等級分級門檻，高強度收斂為 ε ≤ 1（原 2）、
//   中強度收斂為 1 < ε ≤ 10（原 2 < ε ≤ 8），低強度隨之改為 ε > 10（原 > 8）。
const HIGH_SECURITY_EPSILON_THRESHOLD = 1.0;
const MEDIUM_SECURITY_EPSILON_THRESHOLD = 10.0;

/**
 * Delta (δ) 相關欄位可容許範圍常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const GLOBAL_TARGET_DELTA_MIN_BOUND = 1e-10;
const GLOBAL_TARGET_DELTA_MAX_BOUND = 0.9999999999;
const FIELD_DELTA_INPUT_MIN_BOUND = 1e-10;
const FIELD_DELTA_INPUT_MAX_BOUND = 0.99;
const FIELD_DELTA_SLIDER_MIN_BOUND = 1e-8;
const FIELD_DELTA_SLIDER_MAX_BOUND = 0.1;

/**
 * Epsilon (ε) 相關欄位可容許範圍常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const FIELD_EPSILON_SLIDER_MIN_BOUND = 0.01;
const FIELD_EPSILON_SLIDER_MAX_BOUND = 20;
const FIELD_EPSILON_INPUT_MIN_BOUND = 0.001;
const FIELD_EPSILON_INPUT_MAX_BOUND = 100;

/**
 * 函數名稱: getScientificNotationPrecisionByRange
 * 函數功能: 依據欄位可容許之最小/最大值範圍，動態計算科學記號尾數應顯示之小數位數，
 *           使精度得以延伸至最小允許值的前一個數量級，避免顯示超出實際可容許範圍之無意義精度。
 *
 * 輸入參數 (Input):
 *   - minAllowedValueNumber (number): 該欄位允許之最小值
 *   - maxAllowedValueNumber (number): 該欄位允許之最大值
 * 返回值 (Return): number，科學記號尾數應顯示之小數位數 (最少為 0)
 */
const getScientificNotationPrecisionByRange = (minAllowedValueNumber: number, maxAllowedValueNumber: number): number =>
{
	const minValueExponentNumber = Math.floor(Math.log10(Math.abs(minAllowedValueNumber)));
	const maxValueExponentNumber = Math.floor(Math.log10(Math.abs(maxAllowedValueNumber)));
	return Math.max(0, maxValueExponentNumber - minValueExponentNumber - 1);
};

/**
 * 函數名稱: formatFloatValueAsScientificNotation
 * 函數功能: 將浮點數以科學記號格式化顯示，尾數小數位數依 getScientificNotationPrecisionByRange 動態計算。
 *
 * 輸入參數 (Input):
 *   - targetFloatValueNumber (number): 欲格式化之浮點數數值 (Ant Design InputNumber 內部初始化時可能傳入字串，故於此一併容錯轉型)
 *   - minAllowedValueNumber (number): 該欄位允許之最小值
 *   - maxAllowedValueNumber (number): 該欄位允許之最大值
 * 返回值 (Return): string，科學記號格式化後之字串 (例如 "1.2345e-5")；若數值無法轉換則原樣以字串傳回
 */
const formatFloatValueAsScientificNotation = (targetFloatValueNumber: number | string, minAllowedValueNumber: number, maxAllowedValueNumber: number): string =>
{
	const parsedFloatValueNumber = typeof targetFloatValueNumber === 'number' ? targetFloatValueNumber : Number(targetFloatValueNumber);
	if (Number.isNaN(parsedFloatValueNumber)) return String(targetFloatValueNumber);
	if (parsedFloatValueNumber === 0) return (0).toExponential(0);
	const scientificNotationPrecisionValue = getScientificNotationPrecisionByRange(minAllowedValueNumber, maxAllowedValueNumber);
	return parsedFloatValueNumber.toExponential(scientificNotationPrecisionValue);
};

/**
 * 函數名稱: truncateFloatValueAsScientificNotationTowardZero
 * 函數功能: 將浮點數以科學記號格式化顯示，尾數一律「無條件捨去」至指定小數位數 (不四捨五入)。
 *           採字串切割而非乘冪運算進行捨位，避免浮點數運算誤差導致捨位結果失準。
 *           限「個別欄位微調」區塊之 ε/δ 顯示使用；其餘全域/總計數值仍維持標準四捨五入顯示。
 *
 * 輸入參數 (Input):
 *   - targetFloatValueNumber (number): 欲格式化之浮點數數值
 *   - minAllowedValueNumber (number): 該欄位允許之最小值
 *   - maxAllowedValueNumber (number): 該欄位允許之最大值
 * 返回值 (Return): string，無條件捨去後之科學記號字串 (例如 "1.2345e-5")
 */
const truncateFloatValueAsScientificNotationTowardZero = (targetFloatValueNumber: number | string, minAllowedValueNumber: number, maxAllowedValueNumber: number): string =>
{
	const parsedFloatValueNumber = typeof targetFloatValueNumber === 'number' ? targetFloatValueNumber : Number(targetFloatValueNumber);
	if (Number.isNaN(parsedFloatValueNumber)) return String(targetFloatValueNumber);
	if (parsedFloatValueNumber === 0) return (0).toExponential(0);

	const scientificNotationPrecisionValue = getScientificNotationPrecisionByRange(minAllowedValueNumber, maxAllowedValueNumber);
	const negativeSignPrefixString = parsedFloatValueNumber < 0 ? '-' : '';
	const highPrecisionExponentialStringValue = Math.abs(parsedFloatValueNumber).toExponential(20);
	const [mantissaPartString, exponentPartString] = highPrecisionExponentialStringValue.split('e');
	const [mantissaIntegerPartString, mantissaFractionPartString = ''] = mantissaPartString.split('.');
	const truncatedMantissaFractionPartString = mantissaFractionPartString.slice(0, scientificNotationPrecisionValue).padEnd(scientificNotationPrecisionValue, '0');
	const truncatedMantissaString = scientificNotationPrecisionValue > 0 ? `${mantissaIntegerPartString}.${truncatedMantissaFractionPartString}` : mantissaIntegerPartString;

	return `${negativeSignPrefixString}${truncatedMantissaString}e${exponentPartString}`;
};

/**
 * 隱私等級預設清單：點擊後將「目標總預算」均分給目前已啟用的欄位，並同步更新總預算上限
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const PRIVACY_LEVEL_PRESET_LIST: { key: string; labelKey: string; labelDefault: string; targetTotalEpsilon: number; accentColor: string }[] = [
	{ key: 'high', labelKey: 'step3_dp.preset_high', labelDefault: '高隱私 (High Privacy)', targetTotalEpsilon: 1.0, accentColor: '#52c41a' },
	{ key: 'medium', labelKey: 'step3_dp.preset_medium', labelDefault: '中隱私 (Medium Privacy)', targetTotalEpsilon: 5.0, accentColor: '#faad14' },
	{ key: 'low', labelKey: 'step3_dp.preset_low', labelDefault: '低隱私 (Low Privacy)', targetTotalEpsilon: 15.0, accentColor: '#fa541c' },
];

/**
 * 轉換後等效隱私預算欄位資料結構
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
export type ConvertedField = DPField & {
	equivalentEpsilon: number; // 本欄實際送給後端的 ε（與 Step4 送出之 column_budgets 相同）
	consumedDelta: number;     // 本欄實際送給後端的 δ（類別型與 ε-DP 模式為 0）
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
	const setStepValidationAction = useWorkspaceStore((state) => state.setStepValidation);

	const translateNoiseUnit = (noiseUnitValue: DpDatetimeNoiseUnit): string => translate(`step3_dp.noise_unit_${noiseUnitValue}`, { day: '天', hour: '時', minute: '分', second: '秒' }[noiseUnitValue]);

	// 切換雜訊單位：一次寫入單位與換算後的敏感度（未指定敏感度時維持自動，由邊界寬度依新單位重算）
	const changeFieldNoiseUnit = (targetField: DPField, nextNoiseUnit: DpDatetimeNoiseUnit): void => {
		useWorkspaceStore.setState((currentStoreState) => ({
			dpFields: currentStoreState.dpFields.map((fieldItemRecord) => fieldItemRecord.id === targetField.id ? applyDpDatetimeNoiseUnit(fieldItemRecord, nextNoiseUnit) : fieldItemRecord)
		}));
	};

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
	 *   - targetTotalEpsilonValue (number): 該隱私等級對應之總 ε 預算目標 (高/中/低隱私分別為 1.0／5.0／15.0)
	 * 返回值 (Return): void
	 */
	const handleApplyPrivacyLevelPreset = (targetTotalEpsilonValue: number): void =>
	{
		if (activeDpFieldsList.length === 0)
		{
			messageApi.warning(translate('step3_dp.preset_no_active_fields', '目前沒有已啟用差分隱私的欄位，無法套用預算預設。'));
			return;
		}

		// ★ 修正：先前用 .toFixed(2) 把「每欄位 ε」四捨五入到小數點後 2 位再存入，
		// 當總預算除以已啟用欄位數除不盡時 (例如 ε=5 分 8 欄，5/8=0.625 被捨入成 0.63)，
		// 存入的每欄位 ε 加總會偏離使用者實際設定的總預算 (0.63×8=5.04，而非 5.00)，
		// 導致「全域等效差分加噪效果模擬」讀回來的統一基準等效 ε 跟著失真。
		// 現在改為存入未捨入的精確值，捨入僅用於下方成功訊息的顯示文字，不影響實際套用值。
		const perFieldEpsilonValue = targetTotalEpsilonValue / activeDpFieldsList.length;
		const perFieldEpsilonDisplayString = perFieldEpsilonValue.toFixed(4);

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
					perField: perFieldEpsilonDisplayString,
					defaultValue: `已將總預算 ε={{total}} 平均分配至 {{count}} 個已啟用欄位 (每欄位 ε={{perField}})`
				}
			)
		);
	};

	// ★ 2026-10-01：先前「等效 ε」把 (ε,δ)-DP 欄位換算到全域目標 δ：ε × ln(1/全域δ) ÷ ln(1/欄位δ)
	//   （例如 ε=5、δ=1e-5、全域 δ=1e-4 → 4）。這不是成立的差分隱私換算，會讓預算中心總和小於實際消耗：
	//   後端與 Step4 依基本組合定理逐欄相加（同例為 17，Step3 卻顯示 16），預算上限檢查也用了偏低的值。
	//   改為直接取實際送給後端的 column_budgets（utils/pipelineConfig.computeDpConsumedBudgetsByField），
	//   ε、δ 各自逐欄相加，與 Step4、後端一致。
	const consumedBudgetsByFieldName = useMemo(
		() => computeDpConsumedBudgetsByField(activeDpFieldsList, globalTargetDeltaValue),
		[activeDpFieldsList, globalTargetDeltaValue]
	);

	const equivalentConvertedFieldsList = useMemo(
		() => activeDpFieldsList.map(
			(activeFieldItemRecord) => ({
				...activeFieldItemRecord,
				equivalentEpsilon: consumedBudgetsByFieldName[activeFieldItemRecord.fieldName]?.epsilon ?? 0,
				consumedDelta: consumedBudgetsByFieldName[activeFieldItemRecord.fieldName]?.delta ?? 0
			} as ConvertedField)
		),
		[activeDpFieldsList, consumedBudgetsByFieldName]
	);

	// 參與下方預算上限判斷，保留完整精度，捨入交給顯示層處理
	const { totalEquivalentEpsilonSumValue, totalConsumedDeltaSumValue } = useMemo(
		() => {
			const { totalEpsilon, totalDelta } = sumDpConsumedBudgets(activeDpFieldsList, globalTargetDeltaValue);
			return { totalEquivalentEpsilonSumValue: totalEpsilon, totalConsumedDeltaSumValue: totalDelta };
		},
		[activeDpFieldsList, globalTargetDeltaValue]
	);

	// 移除 M 次邏輯，單次耗損即為總耗損
	const safeBudgetLimitThresholdValue = globalBudgetLimitEpsilonValue || DEFAULT_BUDGET_LIMIT_EPSILON;                      
	const budgetUsagePercentageValue = Math.min((totalEquivalentEpsilonSumValue / safeBudgetLimitThresholdValue) * 100, 100);          
	const isBudgetDangerAlertStatus = budgetUsagePercentageValue >= DANGER_BUDGET_USAGE_PERCENT_THRESHOLD;
	const isBudgetWarningAlertStatus = budgetUsagePercentageValue >= WARNING_BUDGET_USAGE_PERCENT_THRESHOLD && !isBudgetDangerAlertStatus;
	// ★ budgetUsagePercentageValue 已用 Math.min 封頂於 100，無法區分「即將耗盡」與「已實際超支」，故另以原始總量比對判斷
	const isBudgetExceededStatus = totalEquivalentEpsilonSumValue > safeBudgetLimitThresholdValue;

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
				{ name: translate('step3_dp.chart_noisy', '加噪後分佈'), type: 'line', smooth: true, color: token.colorPrimary, data: noisyDensityDistributionArray, areaStyle: { opacity: isDarkModeActiveStatus ? 0.2 : 0.25 }, lineStyle: { width: 3.5 }, showSymbol: false, itemStyle: { ShadowBlur: 12, ShadowColor: token.colorPrimary } }
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
					ε: {(convertedRecordItem.epsilon ?? DEFAULT_EPSILON_BUDGET).toFixed(2)} {convertedRecordItem.mode === 'default-delta' && convertedRecordItem.fieldType === 'Numeric' && ` | δ: ${translate('step3_dp.delta_from_global', '全域')}`}{convertedRecordItem.mode === 'epsilon-delta' && ` | δ: ${formatFloatValueAsScientificNotation(convertedRecordItem.delta ?? DEFAULT_DELTA_BUDGET, FIELD_DELTA_INPUT_MIN_BOUND, FIELD_DELTA_INPUT_MAX_BOUND)}`}
				</div>
			)
		},
		{ 
			title: translate('step3_dp.col_equivalent', '實際消耗 ε'), 
			dataIndex: 'equivalentEpsilon', 
			key: 'equivalentEpsilon', 
			align: 'right' as const,
			render: (equivalentEpsilonDataValue: number) => <Text strong style={{ color: '#722ed1', fontSize: 14 }}>{formatFloatValueAsScientificNotation(equivalentEpsilonDataValue, FIELD_EPSILON_INPUT_MIN_BOUND, FIELD_EPSILON_INPUT_MAX_BOUND)}</Text> 
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
				{/* ★ 修正排版：原第三欄「數值超出範圍時的處理方式」為全域統一設定，使用者反映應改為每個
				    數值/日期時間欄位各自設定（與邊界一同在 Step2 設定），故移至 Step2 個別欄位列，
				    此處改為均分 2 等分的 span={12}。 */}
				<Row gutter={[48, 32]}>
					<Col span={12}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
								<Text strong>
									{translate('step3_dp.global_delta', '全域目標 Delta（誤差容忍度 δ）')}
									<Tooltip title={translate('step3_dp.global_delta_tooltip', '極小的容錯機率上限，一般維持預設值即可。')}>
										<QuestionCircleOutlined style={{ marginLeft: 6, color: token.colorTextDescription, cursor: 'help' }} />
									</Tooltip>
								</Text>
								<InputNumber
									min={GLOBAL_TARGET_DELTA_MIN_BOUND} max={GLOBAL_TARGET_DELTA_MAX_BOUND} step={0.0001}
									value={globalTargetDeltaValue}
									onChange={(inputTargetDeltaNumberValue) => useWorkspaceStore.setState({ targetDelta: inputTargetDeltaNumberValue === null ? undefined : inputTargetDeltaNumberValue })}
									formatter={
										(formatterInputValue, formatterInfoObj) =>
										{
											if (formatterInfoObj?.userTyping || formatterInputValue === undefined || formatterInputValue === null) return String(formatterInputValue ?? '');
											return formatFloatValueAsScientificNotation(formatterInputValue, GLOBAL_TARGET_DELTA_MIN_BOUND, GLOBAL_TARGET_DELTA_MAX_BOUND);
										}
									}
									style={{ width: '150px' }}
								/>
							</div>
							<Text type="secondary" style={{ fontSize: 13, lineHeight: 1.5, textAlign: 'left' }}>
								{translate('step3_dp.global_delta_desc', '這是一個很小的數字，代表隱私保護「萬一失效」的最大可接受機率。只有欄位選擇 (ε, δ)-DP 模式時才會用到此設定，一般維持預設值即可。')}
							</Text>
						</div>
					</Col>

					<Col span={12}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
								<Text strong>
									{translate('step3_dp.budget_limit_label', '總隱私預算上限（ε 額度）')}
									<Tooltip title={translate('step3_dp.budget_limit_tooltip', '所有欄位使用的 ε 加總上限，數字越小保護越強。')}>
										<QuestionCircleOutlined style={{ marginLeft: 6, color: token.colorTextDescription, cursor: 'help' }} />
									</Tooltip>
								</Text>
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
									formatter={
										(formatterInputValue, formatterInfoObj) =>
										{
											if (formatterInfoObj?.userTyping || formatterInputValue === undefined || formatterInputValue === null) return String(formatterInputValue ?? '');
											return formatFloatValueAsScientificNotation(formatterInputValue, MIN_EPSILON_BUDGET_LIMIT, MAX_EPSILON_BUDGET_LIMIT);
										}
									}
									style={{ width: '150px' }}
								/>
							</div>
							<Text type="secondary" style={{ fontSize: 13, lineHeight: 1.5, textAlign: 'left' }}>
								{translate('step3_dp.budget_limit_desc', '所有欄位使用的隱私預算（ε）加總，不可超過這個數字；超過時系統會提出風險警告。')}
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
											flexDirection: 'column',
											gap: '10px',
											padding: '12px 16px',
											background: isDarkModeActiveStatus ? '#1f1f1f' : '#f8fafc',
											border: `1px solid ${token.colorPrimaryBorder}`,
											borderRadius: '8px',
											transition: 'all 0.2s ease',
										}
									}
								>
								<div style={{ display: 'flex', alignItems: 'center' }}>
									<div style={{ flex: '0 0 25%', display: 'flex', alignItems: 'center', gap: '12px' }}>
										<div style={{ overflow: 'hidden' }}>
											<Text strong style={{ display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
												{activeFieldItemRecord.fieldName}
											</Text>
											<Text type="secondary" style={{ fontSize: '12px' }}>{activeFieldItemRecord.fieldType || 'QI'}</Text>
										</div>
										<Tooltip title={translate('step3_dp.field_epsilon_tooltip', 'ε 越小雜訊越多、保護越強，但資料越不精確。')}>
											<QuestionCircleOutlined style={{ color: token.colorTextDescription, cursor: 'help', flexShrink: 0 }} />
										</Tooltip>
									</div>

									<div style={{ flex: 1, display: 'flex', gap: '24px', alignItems: 'center' }}>
										<Select 
											size="middle" 
											value={activeFieldItemRecord.mode || 'epsilon'} 
											onChange={(dropdownSelectedModeString) => updateFieldDP(activeFieldItemRecord.id, 'mode', dropdownSelectedModeString)}
											options={[
												{ value: 'epsilon', label: 'ε-DP' },
												{ value: 'epsilon-delta', label: '(ε, δ)-DP' },
												// ★ 2026-10-01：不送 delta_budget，由 default_delta（上方全域目標 δ）補足；匯入設定檔時未指定 δ 的欄位即為此模式
												...(activeFieldItemRecord.fieldType === 'Numeric' ? [{ value: 'default-delta', label: translate('step3_dp.mode_default_delta', '沿用全域 δ') }] : [])
											]}
											style={{ width: '130px' }}
										/>

										<div style={{ flex: 1, display: 'flex', gap: '24px', alignItems: 'center' }}>
											<div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
												<Text type="secondary" style={{ width: '20px', textAlign: 'right' }}>ε</Text>
												<Slider
													min={FIELD_EPSILON_SLIDER_MIN_BOUND} max={FIELD_EPSILON_SLIDER_MAX_BOUND} step={0.01}
													value={activeFieldItemRecord.epsilon ?? DEFAULT_EPSILON_BUDGET}
													onChange={(sliderEpsilonNumberValue) => updateFieldDP(activeFieldItemRecord.id, 'epsilon', sliderEpsilonNumberValue)}
													style={{ flex: 1, margin: 0 }}
													tooltip={{ formatter: (tooltipEpsilonNumberValue) => tooltipEpsilonNumberValue === undefined ? '' : truncateFloatValueAsScientificNotationTowardZero(tooltipEpsilonNumberValue, FIELD_EPSILON_SLIDER_MIN_BOUND, FIELD_EPSILON_SLIDER_MAX_BOUND) }}
												/>
												<InputNumber
													min={FIELD_EPSILON_INPUT_MIN_BOUND} max={FIELD_EPSILON_INPUT_MAX_BOUND} step={0.01}
													value={activeFieldItemRecord.epsilon}
													onChange={(inputEpsilonNumberValue) => updateFieldDP(activeFieldItemRecord.id, 'epsilon', inputEpsilonNumberValue === null ? undefined : inputEpsilonNumberValue)}
													formatter={
														(formatterInputValue, formatterInfoObj) =>
														{
															if (formatterInfoObj?.userTyping || formatterInputValue === undefined || formatterInputValue === null) return String(formatterInputValue ?? '');
															return truncateFloatValueAsScientificNotationTowardZero(formatterInputValue, FIELD_EPSILON_INPUT_MIN_BOUND, FIELD_EPSILON_INPUT_MAX_BOUND);
														}
													}
													size="small" style={{ width: '130px' }}
												/>
											</div>

											{activeFieldItemRecord.mode === 'epsilon-delta' && (
												<div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
													<Text type="secondary" style={{ width: '20px', textAlign: 'right' }}>δ</Text>
													<Slider
														min={FIELD_DELTA_SLIDER_MIN_BOUND} max={FIELD_DELTA_SLIDER_MAX_BOUND} step={0.0001}
														value={activeFieldItemRecord.delta ?? DEFAULT_DELTA_BUDGET}
														onChange={(sliderDeltaNumberValue) => updateFieldDP(activeFieldItemRecord.id, 'delta', sliderDeltaNumberValue)}
														style={{ flex: 1, margin: 0 }}
														tooltip={{ formatter: (tooltipDeltaNumberValue) => tooltipDeltaNumberValue === undefined ? '' : truncateFloatValueAsScientificNotationTowardZero(tooltipDeltaNumberValue, FIELD_DELTA_SLIDER_MIN_BOUND, FIELD_DELTA_SLIDER_MAX_BOUND) }}
													/>
													<InputNumber
														min={FIELD_DELTA_INPUT_MIN_BOUND} max={FIELD_DELTA_INPUT_MAX_BOUND} step={0.0001}
														value={activeFieldItemRecord.delta}
														onChange={(inputDeltaNumberValue) => updateFieldDP(activeFieldItemRecord.id, 'delta', inputDeltaNumberValue === null ? undefined : inputDeltaNumberValue)}
														formatter={
															(formatterInputValue, formatterInfoObj) =>
															{
																if (formatterInfoObj?.userTyping || formatterInputValue === undefined || formatterInputValue === null) return String(formatterInputValue ?? '');
																return truncateFloatValueAsScientificNotationTowardZero(formatterInputValue, FIELD_DELTA_INPUT_MIN_BOUND, FIELD_DELTA_INPUT_MAX_BOUND);
															}
														}
														size="small" style={{ width: '130px' }}
													/>
												</div>
											)}
										</div>
									</div>
								</div>

								{activeFieldItemRecord.fieldType === 'Numeric' && (
									<div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingLeft: 'calc(25% + 12px)' }}>
										<Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
											{resolveIsDateTimeDpField(activeFieldItemRecord) ? translate('step3_dp.noise_unit_label', '雜訊單位') : translate('step3_dp.minimum_unit_label', '加噪刻度 (Minimum Unit)')}
										</Text>
										{resolveIsDateTimeDpField(activeFieldItemRecord) ? (
											<>
												{/* ★ 2026-10-01：雜訊單位可選天／時／分／秒（對應 config_dp.json 之 noise_unit，先前固定為天）。
												    切換時把已指定的敏感度換算成新單位，讓它代表的時間長度不變；加噪步階維持「幾個單位一格」。 */}
												<Select
													size="small"
													data-testid="dp-noise-unit-select"
													value={resolveDpDatetimeNoiseUnit(activeFieldItemRecord)}
													onChange={(selectedNoiseUnit: DpDatetimeNoiseUnit) => changeFieldNoiseUnit(activeFieldItemRecord, selectedNoiseUnit)}
													style={{ width: '90px' }}
													options={DP_DATETIME_NOISE_UNITS.map((noiseUnitValue) => ({ value: noiseUnitValue, label: translateNoiseUnit(noiseUnitValue) }))}
												/>
												<Text type="secondary" style={{ fontSize: 12, marginLeft: '12px', flexShrink: 0 }}>
													{translate('step3_dp.noise_step_unit_label', '加噪步階 ({{unit}})', { unit: translateNoiseUnit(resolveDpDatetimeNoiseUnit(activeFieldItemRecord)) })}
												</Text>
												<InputNumber
													size="small"
													min={1}
													value={activeFieldItemRecord.noiseStep}
													onChange={(inputNumberValue) => updateFieldDP(activeFieldItemRecord.id, 'noiseStep', inputNumberValue === null ? undefined : inputNumberValue)}
													style={{ width: '90px' }}
												/>
											</>
										) : (
											<InputNumber
												size="small"
												min={0}
												step={resolveInputNumberStepByDecimals(activeFieldItemRecord.minimumUnit)}
												value={activeFieldItemRecord.minimumUnit}
												onChange={(inputNumberValue) => updateFieldDP(activeFieldItemRecord.id, 'minimumUnit', inputNumberValue === null ? undefined : inputNumberValue)}
												style={{ width: '110px' }}
											/>
										)}

										<Text type="secondary" style={{ fontSize: 12, marginLeft: '12px', flexShrink: 0 }}>
											{translate('step3_dp.out_of_bounds_strategy_short', '邊界溢出處理')}
										</Text>
										<Select
											size="small"
											value={activeFieldItemRecord.outOfBoundsStrategy ?? 'clip'}
											onChange={(selectedStrategyValue) => updateFieldDP(activeFieldItemRecord.id, 'outOfBoundsStrategy', selectedStrategyValue)}
											style={{ width: '160px' }}
											options={
												[
													{ value: 'clip', label: translate('step3_dp.strategy_clip_short', '截斷 (Clip)') },
													{ value: 'wrap', label: translate('step3_dp.strategy_wrap_short', '環繞 (Wrap)') },
													{ value: 'reflect', label: translate('step3_dp.strategy_reflect_short', '鏡像 (Reflect)') },
												]
											}
										/>

										{/* ★ 2026-10-01：敏感度可自訂（對應 config_dp.json 之 sensitivity）。留空時以邊界寬度計算
										    （數值型為上限 − 下限、日期型為相差時間，以雜訊單位計），也就是先前固定的做法；匯入的設定檔有指定時沿用。 */}
										<Text type="secondary" style={{ fontSize: 12, marginLeft: '12px', flexShrink: 0 }}>
											{translate('step3_dp.sensitivity_label', '敏感度')}
											<Tooltip title={translate('step3_dp.sensitivity_tooltip', '加噪幅度 ≈ 敏感度 ÷ ε。留空時以邊界寬度計算（數值型為上限減下限，日期型為兩日期相差的時間，以所選雜訊單位計），涵蓋邊界內任意變動、保護力最強，但雜訊也最大；調小可保留較多資料細節，但隱私保證隨之減弱。匯入的設定檔有指定敏感度時會沿用。')}>
												<QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} />
											</Tooltip>
										</Text>
										{(() => {
											const isDateTimeSensitivityField = resolveIsDateTimeDpField(activeFieldItemRecord);
											const defaultSensitivityValue = computeDefaultDpSensitivity(activeFieldItemRecord, isDateTimeSensitivityField);
											const sensitivityUnitText = isDateTimeSensitivityField ? ` ${translateNoiseUnit(resolveDpDatetimeNoiseUnit(activeFieldItemRecord))}` : '';
											return (
												<InputNumber
													size="small"
													min={0}
													value={activeFieldItemRecord.sensitivity}
													placeholder={defaultSensitivityValue !== null
														? translate('step3_dp.sensitivity_auto_placeholder', '自動：{{value}}', { value: `${defaultSensitivityValue.toLocaleString()}${sensitivityUnitText}` })
														: translate('step3_dp.sensitivity_auto', '自動')}
													onChange={(inputNumberValue) => updateFieldDP(activeFieldItemRecord.id, 'sensitivity', inputNumberValue === null || inputNumberValue <= 0 ? undefined : inputNumberValue)}
													style={{ width: '150px' }}
												/>
											);
										})()}
									</div>
								)}

								{/* ★ 2026-10-01：Step2 邊界可選到秒，但雜訊單位預設為天；邊界比雜訊單位細時提醒，
								    否則敏感度與加噪都以天計、邊界的時間部分被四捨五入，使用者不易察覺。 */}
								{activeFieldItemRecord.fieldType === 'Numeric' && resolveIsDateTimeDpField(activeFieldItemRecord) && (() => {
									const boundsFinestUnit = findDpBoundsFinerThanNoiseUnit(activeFieldItemRecord);
									if (!boundsFinestUnit) return null;
									const currentNoiseUnitText = translateNoiseUnit(resolveDpDatetimeNoiseUnit(activeFieldItemRecord));
									const boundsUnitText = translateNoiseUnit(boundsFinestUnit);
									return (
										<div style={{ paddingLeft: 'calc(25% + 12px)' }} data-testid="dp-noise-unit-coarser-warning">
											<Alert
												type="warning"
												showIcon
												style={{ padding: '4px 12px', fontSize: 12 }}
												title={translate('step3_dp.noise_unit_coarser_warning', 'Step2 的上下限細到「{{boundsUnit}}」，但雜訊單位是「{{noiseUnit}}」：敏感度與加噪都以{{noiseUnit}}計，邊界的時間部分會四捨五入。如要以{{boundsUnit}}加噪，請把雜訊單位改為「{{boundsUnit}}」。', { boundsUnit: boundsUnitText, noiseUnit: currentNoiseUnitText })}
												action={
													<Button size="small" onClick={() => changeFieldNoiseUnit(activeFieldItemRecord, boundsFinestUnit)}>
														{translate('step3_dp.noise_unit_coarser_fix', '改為「{{boundsUnit}}」', { boundsUnit: boundsUnitText })}
													</Button>
												}
											/>
										</div>
									);
								})()}
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
					{/* ★ QA 反映：紅色「危險：預算即將耗盡」警示先前完全沒有說明文字，使用者不確定
					    這是「需要改善」還是「僅供參考」。補上「?」提示：這是真的有意義的門檻——
					    ε 總量一旦超過預算上限就會被擋下無法進入下一步，紅色代表已經很接近該上限，
					    建議提前調整；並非任何情況都會出現，只有目前設定的 ε 用量偏高時才會亮紅。 */}
					<Card
						title={
							<span>
								<DashboardOutlined style={{ marginRight: 8, color: '#faad14' }} />
								{translate('step3_dp.card2_title', '3. 隱私預算中心')}
								<Tooltip title={translate('step3_dp.budget_center_tooltip', '此處顯示目前所有欄位的 ε 加總，佔您設定之預算上限的比例。顏色越紅代表用量越接近上限；一旦實際超過上限將無法進入下一步，建議調降部分欄位的 ε，或提高預算上限。用量夠低時不會顯示紅色警示。')}>
									<QuestionCircleOutlined style={{ marginLeft: 8, color: token.colorTextDescription, cursor: 'help', fontSize: 14 }} />
								</Tooltip>
							</span>
						}
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
						{/* ★ 使用者反映排版壅擠：儀表原本固定 220px 寬、外層 div 左右完全沒有留白
						    （padding 僅上下），在 Col span={8} 的欄寬下，儀表環幾乎頂到卡片邊緣。
						    改為縮小固定尺寸並補上左右留白，讓儀表與卡片邊界之間留有明顯呼吸空間。 */}
						<div style={{ textAlign: 'center', padding: '32px 16px 24px 16px' }}>
							<Progress
								type="dashboard"
								percent={budgetUsagePercentageValue}
								status={isBudgetDangerAlertStatus ? 'exception' : isBudgetWarningAlertStatus ? 'normal' : 'success'}
								format={
									() =>
									(
										// ★ 使用者反映：即使儀表環放大到 220px，中間的數值文字仍緊貼著環的
										//   內緣，看起來很擠。antd 預設字級是依環的寬度自動換算（220px 環
										//   約 39px 字），這裡改為明確指定較小的字級，讓文字跟環之間留出
										//   明顯間距，不再依賴自動換算值。
										<span style={{ color: isBudgetDangerAlertStatus ? '#cf1322' : isBudgetWarningAlertStatus ? '#d48806' : '#52c41a', fontSize: 26, lineHeight: 1.2 }}>
											{formatFloatValueAsScientificNotation(totalEquivalentEpsilonSumValue, FIELD_EPSILON_INPUT_MIN_BOUND, FIELD_EPSILON_INPUT_MAX_BOUND)}
										</span>
									)
								}
								strokeColor={isBudgetDangerAlertStatus ? { '0%': '#ff4d4f', '100%': '#cf1322' } : isBudgetWarningAlertStatus ? { '0%': '#faad14', '100%': '#d48806' } : { '0%': '#13c2c2', '100%': '#52c41a' }}
								/* ★ 使用者反映：儀表環先前縮小至 180px 後，內部消耗數值文字（例如
								   「1.6000e+1」）幾乎頂到環的內緣，視覺上看起來擁擠。放大回 220px
								   並同步加粗環寬，讓文字與環之間留有明顯呼吸空間；卡片本身已有
								   左右留白（見上方 padding 註解），放大後不會再頂到卡片邊緣。 */
								strokeWidth={10}
								size={220}
								style={{ filter: isDarkModeActiveStatus ? 'drop-Shadow(0 0 8px rgba(0,0,0,0.5))' : 'none' }}
							/>

							<div style={{ marginTop: 28 }}>
								<Text type="secondary" style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>
									{translate('step3_dp.accumulated_cost', { limit: safeBudgetLimitThresholdValue, defaultValue: `總預算消耗 / 預算上限 (${safeBudgetLimitThresholdValue})` })}
								</Text>

								<Tag
									color={isBudgetDangerAlertStatus ? 'error' : isBudgetWarningAlertStatus ? 'warning' : 'success'}
									style={{ fontSize: 16, padding: '4px 16px', borderRadius: 4, fontWeight: 'bold' }}
								>
									{isBudgetExceededStatus ? translate('step3_dp.budget_exceeded', '⚠️ 危險：預算已超支') : isBudgetDangerAlertStatus ? translate('step3_dp.budget_danger', '預算透支風險') : isBudgetWarningAlertStatus ? translate('step3_dp.budget_warning', '預算水位偏低') : translate('step3_dp.budget_safe', '預算水位安全')}
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
										<Text strong>{translate('step3_dp.single_equivalent', '本次消耗預算:')}</Text>
										<Text strong style={{ color: '#722ed1', fontSize: 18 }}>
											ε = {formatFloatValueAsScientificNotation(totalEquivalentEpsilonSumValue, FIELD_EPSILON_INPUT_MIN_BOUND, FIELD_EPSILON_INPUT_MAX_BOUND)}
											{totalConsumedDeltaSumValue > 0 && <span style={{ fontSize: 14, marginLeft: 12 }}>δ = {formatFloatValueAsScientificNotation(totalConsumedDeltaSumValue, FIELD_DELTA_INPUT_MIN_BOUND, FIELD_DELTA_INPUT_MAX_BOUND)}</span>}
										</Text>
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
								title={<Text type="secondary" style={{ fontSize: 14 }}>{translate('step3_dp.unified_eps', '本次總消耗 ε')}</Text>} 
								value={totalEquivalentEpsilonSumValue}
								prefix={<CalculatorOutlined style={{ fontSize: 24, marginRight: 8, color: token.colorPrimary }} />}
								formatter={(formatterOutputValue) => <span style={{ fontSize: 42, fontWeight: 'bold', color: token.colorPrimary }}>{formatFloatValueAsScientificNotation(Number(formatterOutputValue), FIELD_EPSILON_INPUT_MIN_BOUND, FIELD_EPSILON_INPUT_MAX_BOUND)}</span>}
							/>

							<Statistic
								title={
									<Text type="secondary" style={{ fontSize: 14 }}>
										{translate('step3_dp.protection_level', '當前保護強度')}
										<Tooltip
											title={
												<div style={{ lineHeight: 1.8 }}>
													<div>{translate('step3_dp.protection_level_tooltip_desc', '依據本次總消耗隱私預算 (ε) 換算之風險等級：')}</div>
													<div><span style={{ color: '#722ed1' }}>●</span> {translate('step3_dp.protection_level_tooltip_high', ' 高強度：ε ≤ {{threshold}}，低風險', { threshold: HIGH_SECURITY_EPSILON_THRESHOLD })}</div>
													<div><span style={{ color: '#13c2c2' }}>●</span> {translate('step3_dp.protection_level_tooltip_medium', ' 中強度：{{low}} < ε ≤ {{high}}，風險視應用情境而定 (平衡)', { low: HIGH_SECURITY_EPSILON_THRESHOLD, high: MEDIUM_SECURITY_EPSILON_THRESHOLD })}</div>
													<div><span style={{ color: '#fa8c16' }}>●</span> {translate('step3_dp.protection_level_tooltip_low', ' 低強度：ε > {{threshold}}，多數情境下屬高風險', { threshold: MEDIUM_SECURITY_EPSILON_THRESHOLD })}</div>
												</div>
											}
										>
											<QuestionCircleOutlined style={{ marginLeft: 6, color: token.colorTextDescription, cursor: 'help' }} />
										</Tooltip>
									</Text>
								}
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