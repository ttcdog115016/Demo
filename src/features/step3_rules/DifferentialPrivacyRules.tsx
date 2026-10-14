/**
 * ============================================================================
 * 檔案名稱 (File): DifferentialPrivacyRules.tsx
 * 模組功能 (Description): 差分隱私參數設定（2026-10-07 起為精簡白話版：保護強度卡、各欄位雜訊（詳細設定收合）、進階全域 δ；右側加噪效果示意圖＋三個重點數字）
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字)
 * ============================================================================
 */

import React, { useMemo, useEffect, useState } from 'react';
import {
	Alert, Slider, Row, Col,
	InputNumber, theme, Select, Progress, Typography, Button, Tooltip, App as AntdApp
} from 'antd';
import {
	QuestionCircleOutlined, CheckCircleFilled, SettingOutlined, UpOutlined, DownOutlined
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore, type DPField } from '../../store/useWorkspaceStore';
import {
	resolveIsDateTimeDpField, resolveInputNumberStepByDecimals, alignDpBoundsToMinimumUnit, alignDpDateTimeBoundsToNoiseGrid, resolveDpDatetimeNoiseUnit, applyDpDatetimeNoiseUnit, findDpBoundsFinerThanNoiseUnit,
	DP_DATETIME_NOISE_UNITS, type DpDatetimeNoiseUnit, resolveDpNoiseStepMax, isDpNoiseStepOutOfRange
} from '../../utils/dpFieldHelpers';
import { computeDefaultDpSensitivity, sumDpConsumedBudgets, isDpBudgetExceeded } from '../../utils/pipelineConfig';
import { useEnsureDatasetProfile } from '../../utils/datasetProfile';
import DatasetScaleHint from '../../components/DatasetScaleHint';

import { scaleFontSize, scaleChartFontSize } from '../../utils/fontScale';
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

/**
 * Epsilon (ε) 相關欄位可容許範圍常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const FIELD_EPSILON_SLIDER_MIN_BOUND = 0.01;
const FIELD_EPSILON_SLIDER_MAX_BOUND = 20;
const FIELD_EPSILON_INPUT_MIN_BOUND = 0.001;
const FIELD_EPSILON_INPUT_MAX_BOUND = 100;

// ★ 2026-10-07 白話版：數字改一般寫法、δ 用最短科學記號（見元件內 formatPlainNumber／formatCompactScientific），
//   原固定位數科學記號格式化函式已移除。

/**
 * 隱私等級預設清單：點擊後將「目標總預算」均分給目前已啟用的欄位，並同步更新總預算上限
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const PRIVACY_LEVEL_PRESET_LIST: { key: string; labelKey: string; labelDefault: string; plainTitle: string; plainDesc: string; targetTotalEpsilon: number; accentColor: string }[] = [
	{ key: 'high', labelKey: 'step3_dp.preset_high', labelDefault: '高隱私 (High Privacy)', plainTitle: '高保護', plainDesc: '雜訊多・最安全', targetTotalEpsilon: 1.0, accentColor: '#52c41a' },
	{ key: 'medium', labelKey: 'step3_dp.preset_medium', labelDefault: '中隱私 (Medium Privacy)', plainTitle: '中保護', plainDesc: '平衡', targetTotalEpsilon: 5.0, accentColor: '#faad14' },
	{ key: 'low', labelKey: 'step3_dp.preset_low', labelDefault: '低隱私 (Low Privacy)', plainTitle: '低保護', plainDesc: '雜訊少・較精確', targetTotalEpsilon: 15.0, accentColor: '#fa541c' },
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
	// ★ 2026-10-08：資料規模提示需要整份資料的筆數（utils/datasetProfile.ts 完整掃描一次的結果）
	useEnsureDatasetProfile();
	const datasetProfileSnapshot = useWorkspaceStore((state) => state.datasetProfile);
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

	// ★ 2026-10-01：預算一律取實際送給後端的 column_budgets（utils/pipelineConfig），ε、δ 各自逐欄相加，與 Step4、後端一致。
	//   （先前「等效 ε」換算到全域 δ 不是成立的差分隱私換算，已移除；2026-10-07 白話版亦移除逐欄換算表。）
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
	// ★ 2026-10-05：容許浮點誤差（例如總預算 1 平分 9 欄，加回去為 1.0000000000000002），見 isDpBudgetExceeded
	const isBudgetExceededStatus = isDpBudgetExceeded(totalEquivalentEpsilonSumValue, safeBudgetLimitThresholdValue);

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

			// ★ 2026-10-02：日期時間欄位的加噪步階不可超過雜訊單位上限（秒、分 ≤ 59，時 ≤ 23）
			const noiseStepOutOfRangeField = activeDpFieldsList.find(
				(activeFieldItemRecord) => activeFieldItemRecord.fieldType === 'Numeric' && resolveIsDateTimeDpField(activeFieldItemRecord)
					&& isDpNoiseStepOutOfRange(activeFieldItemRecord.noiseStep, resolveDpDatetimeNoiseUnit(activeFieldItemRecord))
			);
			if (noiseStepOutOfRangeField)
			{
				const noiseUnitOfField = resolveDpDatetimeNoiseUnit(noiseStepOutOfRangeField);
				setStepValidationAction(false, translate('step3_dp.error_noise_step_out_of_range', {
					field: noiseStepOutOfRangeField.fieldName, unit: translateNoiseUnit(noiseUnitOfField), max: resolveDpNoiseStepMax(noiseUnitOfField),
					defaultValue: `「${noiseStepOutOfRangeField.fieldName}」的加噪步階須介於 1～${resolveDpNoiseStepMax(noiseUnitOfField)} ${translateNoiseUnit(noiseUnitOfField)}，超過請改用較大的雜訊單位。`
				}));
				return;
			}

			if (isBudgetExceededStatus) 
			{
				setStepValidationAction(false, translate('step3_dp.error_budget_exceeded', '消耗的總隱私預算已超過設定上限，請調降各欄位的 ε。'));
				return;
			}

			setStepValidationAction(true, null);
		}, 
		// eslint-disable-next-line react-hooks/exhaustive-deps -- translateNoiseUnit 僅包裝 translate，已列入依賴
		[globalTargetDeltaValue, activeDpFieldsList, isBudgetExceededStatus, setStepValidationAction, translate]
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
			legend: { data: [translate('step3_dp.chart_original', '原始分佈'), translate('step3_dp.chart_noisy', '加噪後分佈')], textStyle: { color: token.colorTextSecondary, fontSize: scaleChartFontSize(12, token.fontSize) }, top: '0%', icon: 'circle' },
			grid: { top: '15%', left: '5%', right: '5%', bottom: '12%', containLabel: true },
			xAxis: { type: 'category', boundaryGap: false, data: ['20K', '30K', '40K', '50K', '60K', '70K', '80K', '90K', '100K'], name: translate('step3_dp.chart_x_axis', '數值區間'), nameLocation: 'center', nameGap: 30, nameTextStyle: { color: token.colorTextSecondary, fontWeight: 500, fontSize: scaleChartFontSize(12, token.fontSize) }, axisLabel: { color: token.colorTextDescription, fontSize: scaleChartFontSize(12, token.fontSize) }, axisLine: { lineStyle: { color: token.colorBorder } } },
			yAxis: { type: 'value', name: translate('step3_dp.chart_y_axis', '密度/頻率'), nameLocation: 'end', nameTextStyle: { color: token.colorTextSecondary, fontSize: scaleChartFontSize(12, token.fontSize) }, axisLabel: { show: false }, splitLine: { lineStyle: { color: token.colorSplit } }, axisLine: { show: false } },
			series: [
				{ name: translate('step3_dp.chart_original', '原始分佈'), type: 'line', smooth: true, color: isDarkModeActiveStatus ? '#434343' : '#d9d9d9', data: originalDensityDistributionArray, areaStyle: { opacity: 0.05 }, lineStyle: { width: 1.5, type: 'dashed' }, showSymbol: false }, 
				{ name: translate('step3_dp.chart_noisy', '加噪後分佈'), type: 'line', smooth: true, color: token.colorPrimary, data: noisyDensityDistributionArray, areaStyle: { opacity: isDarkModeActiveStatus ? 0.2 : 0.25 }, lineStyle: { width: 3.5 }, showSymbol: false, itemStyle: { ShadowBlur: 12, ShadowColor: token.colorPrimary } }
			]
		};
	};

	// ★ 2026-10-07 精簡白話版：自訂保護強度、每列「詳細」、進階 δ 的展開狀態（本元件無提前 return，hooks 順序固定）
	const [isCustomPrivacyModeStatus, setIsCustomPrivacyModeStatus] = useState<boolean>(false);
	const [openedFieldAdvancedIdMap, setOpenedFieldAdvancedIdMap] = useState<Record<string, boolean>>({});
	const [isGlobalAdvancedOpenStatus, setIsGlobalAdvancedOpenStatus] = useState<boolean>(false);

	const summaryTileStyle: React.CSSProperties = { flex: '1 1 0', minWidth: '8.5em', padding: '10px 12px', borderRadius: 8, background: token.colorFillQuaternary, border: `1px solid ${token.colorBorderSecondary}`, display: 'flex', flexDirection: 'column', gap: 2 };
	const summaryTileLabelStyle: React.CSSProperties = { fontSize: scaleFontSize(12), color: token.colorTextSecondary };
	const summaryTileValueStyle: React.CSSProperties = { fontSize: scaleFontSize(20), fontWeight: 700, color: token.colorText, lineHeight: 1.3 };

	/**
	 * ============================================================================
	 * ★ 2026-10-07 精簡白話版版面（比照 K-匿名 Step3）
	 * ============================================================================
	 * 使用者反映：原本「全域 δ／總預算上限 → 逐欄 ε/δ/模式/刻度/溢出/敏感度 → 儀表板＋換算表 → 噪聲圖」
	 * 對非相關背景的使用者太複雜。改為：
	 *   左側 ① 保護強度卡（高／中／低＝總 ε 1／5／15，點選即平均分配並設為上限；或自訂上限）
	 *        ② 各欄位雜訊（每欄只留 ε 滑桿；模式、δ、刻度、雜訊單位、溢出、敏感度收進每列「詳細」）
	 *        ③ 進階：全域 δ（預設收合）
	 *   右側 保留原「加噪效果模擬」示意圖，下方三格：保護強度、已用預算（ε／上限＋進度條）、預算狀態。
	 * 文字一律精簡，說明收進問號 Tooltip；數字改一般寫法（不再用科學記號）。
	 * 驗證邏輯、store 欄位與送後端的設定檔格式皆不變。
	 */
	const helpIcon = (tooltipContent: React.ReactNode): React.ReactNode => (
		<Tooltip title={tooltipContent}><QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} /></Tooltip>
	);

	// 深色主題下主色 #3f51b5 當文字對比不足，改用較亮的靛藍（與 K-匿名頁一致）
	const accentTextColor = isDarkModeActiveStatus ? '#9fa8ff' : token.colorPrimary;

	const sectionCardStyle: React.CSSProperties = {
		background: token.colorBgContainer,
		border: `1px solid ${token.colorBorderSecondary}`,
		borderRadius: 12,
		padding: '18px 20px',
		boxSizing: 'border-box',
		boxShadow: isDarkModeActiveStatus ? 'none' : '0 2px 8px rgba(0,0,0,0.04)'
	};

	const renderSectionHeader = (stepNumberText: string, titleText: string, tooltipText?: React.ReactNode, extraNode?: React.ReactNode): React.ReactNode => (
		<div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, fontSize: scaleFontSize(16), fontWeight: 700, color: token.colorText }}>
			<span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: token.colorPrimary, color: '#fff', fontSize: scaleFontSize(14), flexShrink: 0 }}>{stepNumberText}</span>
			<span style={{ flex: 1, minWidth: 0 }}>{titleText}{tooltipText ? helpIcon(tooltipText) : null}</span>
			{extraNode}
		</div>
	);

	const renderChoiceCard = (cardKey: string, testId: string, isSelected: boolean, onSelect: () => void, titleText: string, subText: React.ReactNode, dotColor?: string): React.ReactNode => (
		<div
			key={cardKey}
			role="radio"
			aria-checked={isSelected}
			tabIndex={0}
			data-testid={testId}
			onClick={onSelect}
			onKeyDown={(keyboardEvent) => { if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') { keyboardEvent.preventDefault(); onSelect(); } }}
			style={{
				flex: '1 1 0', minWidth: '7em', cursor: 'pointer', padding: '12px 14px', borderRadius: 10, textAlign: 'left',
				border: `2px solid ${isSelected ? accentTextColor : token.colorBorder}`,
				background: isSelected ? token.colorPrimaryBg : token.colorBgContainer,
				transition: 'border-color .15s, background .15s'
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: scaleFontSize(16), fontWeight: 700, color: isSelected ? accentTextColor : token.colorText }}>
				{isSelected
					? <CheckCircleFilled />
					: <span style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${dotColor || token.colorBorder}`, display: 'inline-block', flexShrink: 0 }} />}
				{titleText}
			</div>
			<div style={{ marginTop: 6, fontSize: scaleFontSize(13), color: token.colorTextSecondary, lineHeight: 1.5 }}>{subText}</div>
		</div>
	);

	// δ 這類極小值用最短的科學記號（1e-5、2.5e-6），不補多餘的 0
	const formatCompactScientific = (inputValue: number | string): string => {
		const parsedValue = Number(inputValue);
		return Number.isFinite(parsedValue) && parsedValue !== 0 ? parsedValue.toExponential() : String(inputValue);
	};

	// 一般寫法的數字（最多 4 位小數，無條件捨去，避免顯示值大於實際值）
	const formatPlainNumber = (numberValue: number): string => {
		if (!Number.isFinite(numberValue)) return String(numberValue);
		const truncatedValue = Math.trunc(numberValue * 1e4) / 1e4;
		return truncatedValue.toLocaleString(undefined, { maximumFractionDigits: 4 });
	};

	// ── ① 保護強度：目前設定是否剛好等於某個預設（上限＝預設總 ε，且每個啟用欄位 ε＝平均值） ──
	const matchedPrivacyPresetKey = (() => {
		if (activeDpFieldsList.length === 0) return undefined;
		const matchedPreset = PRIVACY_LEVEL_PRESET_LIST.find((presetItemRecord) => {
			const perFieldEpsilon = presetItemRecord.targetTotalEpsilon / activeDpFieldsList.length;
			return Math.abs((globalBudgetLimitEpsilonValue ?? 0) - presetItemRecord.targetTotalEpsilon) < 1e-9
				&& activeDpFieldsList.every((fieldItemRecord) => Math.abs((fieldItemRecord.epsilon ?? DEFAULT_EPSILON_BUDGET) - perFieldEpsilon) < 1e-9);
		});
		return matchedPreset?.key;
	})();
	const isCustomPrivacyLevelStatus = isCustomPrivacyModeStatus || !matchedPrivacyPresetKey;

	// ── 右側重點數字 ──
	const protectionLevelKey: 'high' | 'medium' | 'low' = totalEquivalentEpsilonSumValue <= HIGH_SECURITY_EPSILON_THRESHOLD ? 'high' : totalEquivalentEpsilonSumValue <= MEDIUM_SECURITY_EPSILON_THRESHOLD ? 'medium' : 'low';
	const protectionLevelColorMap = { high: '#52c41a', medium: '#faad14', low: '#fa541c' };
	const protectionLevelLabelMap = {
		high: translate('step3_dp.plain_level_high', '高'),
		medium: translate('step3_dp.plain_level_medium', '中'),
		low: translate('step3_dp.plain_level_low', '低')
	};
	const budgetStatusColor = isBudgetExceededStatus || isBudgetDangerAlertStatus ? token.colorError : isBudgetWarningAlertStatus ? token.colorWarning : token.colorSuccess;
	const budgetStatusText = isBudgetExceededStatus
		? translate('step3_dp.plain_budget_exceeded', '已超過上限')
		: isBudgetDangerAlertStatus
			? translate('step3_dp.plain_budget_danger', '接近上限')
			: isBudgetWarningAlertStatus
				? translate('step3_dp.plain_budget_warning', '用量偏高')
				: translate('step3_dp.plain_budget_safe', '正常');

	const fieldTypeLabel = (fieldItemRecord: DPField): string => fieldItemRecord.fieldType === 'Numeric'
		? (resolveIsDateTimeDpField(fieldItemRecord) ? translate('step3_dp.plain_type_datetime', '日期') : translate('step3_dp.plain_type_numeric', '數值'))
		: fieldItemRecord.fieldType === 'Categorical' ? translate('step3_dp.plain_type_categorical', '類別') : (fieldItemRecord.fieldType || '');

	/** 每列「詳細」裡的進階設定：模式、δ、刻度／雜訊單位與步階、溢出處理、敏感度 */
	const renderFieldAdvancedSettings = (activeFieldItemRecord: DPField): React.ReactNode => {
		const isDateTimeField = resolveIsDateTimeDpField(activeFieldItemRecord);
		const labelStyle: React.CSSProperties = { fontSize: scaleFontSize(12), color: token.colorTextSecondary, display: 'block', marginBottom: 4 };
		return (
			<div data-testid="dp-field-advanced" style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: token.colorFillQuaternary, display: 'flex', flexWrap: 'wrap', gap: '12px 20px' }}>
				<div>
					<span style={labelStyle}>{translate('step3_dp.plain_mode_label', '模式')}{helpIcon(translate('step3_dp.plain_mode_tip', 'ε-DP：只用 ε。(ε, δ)-DP：另外容許極小的失效機率 δ，雜訊可較少。沿用全域 δ：δ 使用下方「進階」的設定。'))}</span>
					<Select
						size="small"
						value={activeFieldItemRecord.mode || 'epsilon'}
						onChange={(dropdownSelectedModeString) => updateFieldDP(activeFieldItemRecord.id, 'mode', dropdownSelectedModeString)}
						options={[
							{ value: 'epsilon', label: 'ε-DP' },
							{ value: 'epsilon-delta', label: '(ε, δ)-DP' },
							// ★ 2026-10-01：不送 delta_budget，由 default_delta（全域目標 δ）補足；匯入設定檔時未指定 δ 的欄位即為此模式
							...(activeFieldItemRecord.fieldType === 'Numeric' ? [{ value: 'default-delta', label: translate('step3_dp.mode_default_delta', '沿用全域 δ') }] : [])
						]}
						style={{ width: '9.5em' }}
					/>
				</div>

				{activeFieldItemRecord.mode === 'epsilon-delta' && (
					<div>
						<span style={labelStyle}>δ</span>
						<InputNumber
							size="small"
							min={FIELD_DELTA_INPUT_MIN_BOUND} max={FIELD_DELTA_INPUT_MAX_BOUND} step={0.0001}
							value={activeFieldItemRecord.delta}
							onChange={(inputDeltaNumberValue) => updateFieldDP(activeFieldItemRecord.id, 'delta', inputDeltaNumberValue === null ? undefined : inputDeltaNumberValue)}
							formatter={(formatterInputValue, formatterInfoObj) => {
								if (formatterInfoObj?.userTyping || formatterInputValue === undefined || formatterInputValue === null) return String(formatterInputValue ?? '');
								return formatCompactScientific(formatterInputValue);
							}}
							style={{ width: '9.5em' }}
						/>
					</div>
				)}

				{activeFieldItemRecord.fieldType === 'Numeric' && (isDateTimeField ? (
					<>
						<div>
							{/* ★ 2026-10-01：雜訊單位可選天／時／分／秒（對應 config_dp.json 之 noise_unit）。切換時把已指定的敏感度換算成新單位。 */}
							<span style={labelStyle}>{translate('step3_dp.noise_unit_label', '雜訊單位')}</span>
							<Select
								size="small"
								data-testid="dp-noise-unit-select"
								value={resolveDpDatetimeNoiseUnit(activeFieldItemRecord)}
								onChange={(selectedNoiseUnit: DpDatetimeNoiseUnit) => changeFieldNoiseUnit(activeFieldItemRecord, selectedNoiseUnit)}
								style={{ width: '6.5em' }}
								options={DP_DATETIME_NOISE_UNITS.map((noiseUnitValue) => ({ value: noiseUnitValue, label: translateNoiseUnit(noiseUnitValue) }))}
							/>
						</div>
						<div>
							<span style={labelStyle}>{translate('step3_dp.noise_step_unit_label', '加噪步階 ({{unit}})', { unit: translateNoiseUnit(resolveDpDatetimeNoiseUnit(activeFieldItemRecord)) })}</span>
							{/* ★ 2026-10-02：步階上限依雜訊單位（秒、分 ≤ 59，時 ≤ 23，天不限），超過顯示紅框並阻擋下一步 */}
							<Tooltip title={resolveDpNoiseStepMax(resolveDpDatetimeNoiseUnit(activeFieldItemRecord)) !== undefined
								? translate('step3_dp.noise_step_max_tooltip', { max: resolveDpNoiseStepMax(resolveDpDatetimeNoiseUnit(activeFieldItemRecord)), unit: translateNoiseUnit(resolveDpDatetimeNoiseUnit(activeFieldItemRecord)), defaultValue: `可輸入 1～${resolveDpNoiseStepMax(resolveDpDatetimeNoiseUnit(activeFieldItemRecord))}；需要更大的步階請改用較大的雜訊單位。` })
								: undefined}>
								<InputNumber
									size="small"
									min={1}
									max={resolveDpNoiseStepMax(resolveDpDatetimeNoiseUnit(activeFieldItemRecord))}
									precision={0}
									status={isDpNoiseStepOutOfRange(activeFieldItemRecord.noiseStep, resolveDpDatetimeNoiseUnit(activeFieldItemRecord)) ? 'error' : undefined}
									value={activeFieldItemRecord.noiseStep}
									onChange={(inputNumberValue) => updateFieldDP(activeFieldItemRecord.id, 'noiseStep', inputNumberValue === null ? undefined : inputNumberValue)}
									style={{ width: '6.5em' }}
								/>
							</Tooltip>
						</div>
					</>
				) : (
					<div>
						<span style={labelStyle}>{translate('step3_dp.plain_minimum_unit', '加噪刻度')}{helpIcon(translate('step3_dp.plain_minimum_unit_tip', '加噪後的數值會是這個數字的倍數，例如 1 代表整數。'))}</span>
						<InputNumber
							size="small"
							min={0}
							step={resolveInputNumberStepByDecimals(activeFieldItemRecord.minimumUnit)}
							value={activeFieldItemRecord.minimumUnit}
							onChange={(inputNumberValue) => updateFieldDP(activeFieldItemRecord.id, 'minimumUnit', inputNumberValue === null ? undefined : inputNumberValue)}
							style={{ width: '8em' }}
						/>
					</div>
				))}

				{activeFieldItemRecord.fieldType === 'Numeric' && (
					<div>
						<span style={labelStyle}>{translate('step3_dp.out_of_bounds_strategy_short', '邊界溢出處理')}{helpIcon(translate('step3_dp.plain_oob_tip', '加噪後超出 Step2 上下限時：截斷＝改成邊界值；環繞＝從另一端繞回；鏡像＝從邊界反彈。'))}</span>
						<Select
							size="small"
							value={activeFieldItemRecord.outOfBoundsStrategy ?? 'clip'}
							onChange={(selectedStrategyValue) => updateFieldDP(activeFieldItemRecord.id, 'outOfBoundsStrategy', selectedStrategyValue)}
							style={{ width: '10em' }}
							options={[
								{ value: 'clip', label: translate('step3_dp.strategy_clip_short', '截斷 (Clip)') },
								{ value: 'wrap', label: translate('step3_dp.strategy_wrap_short', '環繞 (Wrap)') },
								{ value: 'reflect', label: translate('step3_dp.strategy_reflect_short', '鏡像 (Reflect)') },
							]}
						/>
					</div>
				)}

				{/* ★ 2026-10-01：敏感度可自訂（對應 config_dp.json 之 sensitivity）。留空時以邊界寬度計算。 */}
				{activeFieldItemRecord.fieldType === 'Numeric' && (() => {
					const defaultSensitivityValue = computeDefaultDpSensitivity(activeFieldItemRecord, isDateTimeField);
					const sensitivityUnitText = isDateTimeField ? ` ${translateNoiseUnit(resolveDpDatetimeNoiseUnit(activeFieldItemRecord))}` : '';
					return (
						<div>
							<span style={labelStyle}>{translate('step3_dp.sensitivity_label', '敏感度')}{helpIcon(translate('step3_dp.sensitivity_tooltip', '留空時，系統會依邊界寬度自動計算，保護力最強，但雜訊也最大；調小可以保留較多資料細節，但保護力會跟著降低。'))}</span>
							<InputNumber
								size="small"
								min={0}
								value={activeFieldItemRecord.sensitivity}
								placeholder={defaultSensitivityValue !== null
									? translate('step3_dp.sensitivity_auto_placeholder', '自動：{{value}}', { value: `${defaultSensitivityValue.toLocaleString()}${sensitivityUnitText}` })
									: translate('step3_dp.sensitivity_auto', '自動')}
								onChange={(inputNumberValue) => updateFieldDP(activeFieldItemRecord.id, 'sensitivity', inputNumberValue === null || inputNumberValue <= 0 ? undefined : inputNumberValue)}
								style={{ width: '10.5em' }}
							/>
						</div>
					);
				})()}
			</div>
		);
	};

	/** 每列下方的提醒（不收合，避免被忽略） */
	const renderFieldHints = (activeFieldItemRecord: DPField): React.ReactNode => {
		if (activeFieldItemRecord.fieldType !== 'Numeric') return null;
		const isDateTimeField = resolveIsDateTimeDpField(activeFieldItemRecord);
		const hintAlertStyle: React.CSSProperties = { marginTop: 8, padding: '4px 12px', fontSize: scaleFontSize(12) };

		// TODO【待後端確認：DP格點起算點】：後端若改為從下限起算，以下兩則提示需改寫
		// ★ 2026-10-06：上下限不是加噪刻度的倍數時，送出前會向外對齊刻度（見 alignDpBoundsToMinimumUnit）
		if (!isDateTimeField)
		{
			const alignedBounds = alignDpBoundsToMinimumUnit(activeFieldItemRecord.lowerBound, activeFieldItemRecord.upperBound, activeFieldItemRecord.minimumUnit ?? 1);
			if (!alignedBounds || !alignedBounds.changed) return null;
			return (
				<div data-testid="dp-bounds-aligned-hint">
					<Alert type="info" showIcon style={hintAlertStyle}
						title={translate('step3_dp.plain_bounds_aligned', '上下限將調整為 {{alignedLower}}～{{alignedUpper}}', { alignedLower: alignedBounds.lower, alignedUpper: alignedBounds.upper })}
						action={helpIcon(translate('step3_dp.bounds_aligned_to_unit_hint', 'Step2 的上下限 {{lower}}～{{upper}} 不是加噪刻度 {{unit}} 的倍數，為確保輸出皆為 {{unit}} 的倍數，超出範圍的處理將改以 {{alignedLower}}～{{alignedUpper}} 為界（敏感度仍依原上下限計算）。', {
							lower: activeFieldItemRecord.lowerBound, upper: activeFieldItemRecord.upperBound, unit: activeFieldItemRecord.minimumUnit ?? 1,
							alignedLower: alignedBounds.lower, alignedUpper: alignedBounds.upper
						}))}
					/>
				</div>
			);
		}

		const noiseUnitOfField = resolveDpDatetimeNoiseUnit(activeFieldItemRecord);
		const alignedDateTimeBounds = alignDpDateTimeBoundsToNoiseGrid(activeFieldItemRecord.lowerBound, activeFieldItemRecord.upperBound, noiseUnitOfField, activeFieldItemRecord.noiseStep);
		// ★ 2026-10-01：Step2 邊界可選到秒，但雜訊單位預設為天；邊界比雜訊單位細時提醒
		const boundsFinestUnit = findDpBoundsFinerThanNoiseUnit(activeFieldItemRecord);
		return (
			<>
				{alignedDateTimeBounds && alignedDateTimeBounds.changed && (
					<div data-testid="dp-datetime-bounds-aligned-hint">
						<Alert type="info" showIcon style={hintAlertStyle}
							title={translate('step3_dp.plain_bounds_aligned', '上下限將調整為 {{alignedLower}}～{{alignedUpper}}', { alignedLower: alignedDateTimeBounds.lower, alignedUpper: alignedDateTimeBounds.upper })}
							action={helpIcon(translate('step3_dp.datetime_bounds_aligned_hint', '加噪結果以每 {{step}} 為一格（自 1970-01-01 起算），Step2 的上下限不在格點上，超出範圍的處理將改以 {{alignedLower}}～{{alignedUpper}} 為界，確保輸出都在格點上（敏感度仍依原上下限計算）。', {
								step: `${activeFieldItemRecord.noiseStep ?? 1} ${translateNoiseUnit(noiseUnitOfField)}`, alignedLower: alignedDateTimeBounds.lower, alignedUpper: alignedDateTimeBounds.upper
							}))}
						/>
					</div>
				)}
				{boundsFinestUnit && (
					<div data-testid="dp-noise-unit-coarser-warning">
						<Alert type="warning" showIcon style={hintAlertStyle}
							title={translate('step3_dp.noise_unit_coarser_warning', 'Step2 的上下限細到「{{boundsUnit}}」，但雜訊單位是「{{noiseUnit}}」，敏感度與加噪都以{{noiseUnit}}計，邊界的時間部分會四捨五入。如要以{{boundsUnit}}加噪，請把雜訊單位改為「{{boundsUnit}}」。', { boundsUnit: translateNoiseUnit(boundsFinestUnit), noiseUnit: translateNoiseUnit(noiseUnitOfField) })}
							action={
								<Button size="small" onClick={() => changeFieldNoiseUnit(activeFieldItemRecord, boundsFinestUnit)}>
									{translate('step3_dp.noise_unit_coarser_fix', '改為「{{boundsUnit}}」', { boundsUnit: translateNoiseUnit(boundsFinestUnit) })}
								</Button>
							}
						/>
					</div>
				)}
			</>
		);
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
			<Alert type="info" showIcon style={{ textAlign: 'left' }} title={translate('step3_dp.plain_intro_short', '選一個保護強度即可進入下一步，其餘已帶入建議值。')} />

			<Row gutter={[20, 16]} align="stretch">
				{/* 左側：設定 */}
				<Col xs={24} xl={11}>
					<div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

						{/* ① 保護強度 */}
						<div style={sectionCardStyle} data-testid="dp-plain-protection">
							{renderSectionHeader('1', translate('step3_dp.plain_sec1_title', '保護強度'), translate('step3_dp.plain_sec1_tip', '選定後，總預算 ε 會平均分給每個欄位。ε 越小，加入的雜訊越多、越安全，但資料越不精確。'))}
							<div role="radiogroup" aria-label={translate('step3_dp.plain_sec1_title', '保護強度')} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
								{PRIVACY_LEVEL_PRESET_LIST.map((presetItemRecord) => renderChoiceCard(
									presetItemRecord.key,
									`dp-preset-${presetItemRecord.key}`,
									!isCustomPrivacyLevelStatus && matchedPrivacyPresetKey === presetItemRecord.key,
									() => { setIsCustomPrivacyModeStatus(false); handleApplyPrivacyLevelPreset(presetItemRecord.targetTotalEpsilon); },
									translate(`step3_dp.plain_preset_${presetItemRecord.key}`, presetItemRecord.plainTitle),
									<>
										<div>{translate(`step3_dp.plain_preset_${presetItemRecord.key}_desc`, presetItemRecord.plainDesc)}</div>
										<div style={{ color: token.colorTextDescription }}>ε = {presetItemRecord.targetTotalEpsilon}</div>
									</>,
									presetItemRecord.accentColor
								))}
								{renderChoiceCard(
									'custom', 'dp-preset-custom', isCustomPrivacyLevelStatus,
									() => setIsCustomPrivacyModeStatus(true),
									translate('step3_dp.plain_preset_custom', '自訂'),
									translate('step3_dp.plain_preset_custom_desc', '逐欄調整 ε')
								)}
							</div>

							{isCustomPrivacyLevelStatus && (
								<Row gutter={12} align="middle" style={{ marginTop: 14 }}>
									<Col flex="none">
										<span style={{ color: token.colorText }}>{translate('step3_dp.plain_budget_limit', '總預算上限 ε')}</span>
										{helpIcon(translate('step3_dp.budget_limit_tooltip', '所有欄位使用的 ε 加總上限，數字越小保護越強。'))}
									</Col>
									<Col flex="none">
										<InputNumber
											aria-label="budget-limit-epsilon"
											step={0.5}
											value={globalBudgetLimitEpsilonValue}
											onChange={(inputBudgetLimitNumberValue) => useWorkspaceStore.setState({ budgetLimitEpsilon: inputBudgetLimitNumberValue === null ? undefined : inputBudgetLimitNumberValue })}
											onBlur={(inputBlurEventObj) => {
												const parsedCurrentInputNumberValue = parseFloat(inputBlurEventObj.target.value);
												if (isNaN(parsedCurrentInputNumberValue)) useWorkspaceStore.setState({ budgetLimitEpsilon: DEFAULT_BUDGET_LIMIT_EPSILON });
												else if (parsedCurrentInputNumberValue < MIN_EPSILON_BUDGET_LIMIT) useWorkspaceStore.setState({ budgetLimitEpsilon: MIN_EPSILON_BUDGET_LIMIT });
												else if (parsedCurrentInputNumberValue > MAX_EPSILON_BUDGET_LIMIT) useWorkspaceStore.setState({ budgetLimitEpsilon: MAX_EPSILON_BUDGET_LIMIT });
											}}
											style={{ width: '8.5em' }}
										/>
									</Col>
									<Col flex="auto" style={{ fontSize: scaleFontSize(12), color: token.colorTextDescription }}>
										{translate('step3_dp.plain_custom_hint', '在下方逐欄調整 ε')}
									</Col>
								</Row>
							)}
							{/* ★ 2026-10-08 諮詢會：資料筆數納入考量（完整掃描完成後才顯示） */}
							<DatasetScaleHint mode="differential-privacy" rowCount={datasetProfileSnapshot ? datasetProfileSnapshot.rowCount : 0} />
						</div>

						{/* ② 各欄位雜訊 */}
						<div style={sectionCardStyle} data-testid="dp-plain-fields">
							{renderSectionHeader('2', translate('step3_dp.plain_sec2_title', '各欄位雜訊'), translate('step3_dp.field_epsilon_tooltip', 'ε 越小雜訊越多、保護越強，但資料越不精確。'))}
							<div style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
								{activeDpFieldsList.length === 0 ? (
									<Text type="secondary" style={{ textAlign: 'center', padding: '16px 0', display: 'block' }}>
										{translate('step3_dp.plain_no_fields', '沒有啟用差分隱私的欄位')}
									</Text>
								) : activeDpFieldsList.map((activeFieldItemRecord) => {
									const isFieldAdvancedOpen = Boolean(openedFieldAdvancedIdMap[activeFieldItemRecord.id]);
									return (
										<div key={activeFieldItemRecord.id} data-testid={`dp-field-row-${activeFieldItemRecord.fieldName}`} style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${token.colorBorderSecondary}` }}>
											<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
												<div style={{ width: '7em', flexShrink: 0, overflow: 'hidden' }}>
													<div style={{ fontWeight: 600, color: token.colorText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={activeFieldItemRecord.fieldName}>{activeFieldItemRecord.fieldName}</div>
													<div style={{ fontSize: scaleFontSize(12), color: token.colorTextDescription }}>{fieldTypeLabel(activeFieldItemRecord)}</div>
												</div>
												<span style={{ color: token.colorTextSecondary }}>ε</span>
												<Slider
													min={FIELD_EPSILON_SLIDER_MIN_BOUND} max={FIELD_EPSILON_SLIDER_MAX_BOUND} step={0.01}
													value={activeFieldItemRecord.epsilon ?? DEFAULT_EPSILON_BUDGET}
													onChange={(sliderEpsilonNumberValue) => { setIsCustomPrivacyModeStatus(true); updateFieldDP(activeFieldItemRecord.id, 'epsilon', sliderEpsilonNumberValue); }}
													style={{ flex: 1, margin: '0 4px' }}
													tooltip={{ formatter: (tooltipEpsilonNumberValue) => tooltipEpsilonNumberValue === undefined ? '' : formatPlainNumber(tooltipEpsilonNumberValue) }}
												/>
												<InputNumber
													aria-label={`${activeFieldItemRecord.fieldName} epsilon`}
													min={FIELD_EPSILON_INPUT_MIN_BOUND} max={FIELD_EPSILON_INPUT_MAX_BOUND} step={0.01}
													value={activeFieldItemRecord.epsilon}
													onChange={(inputEpsilonNumberValue) => { setIsCustomPrivacyModeStatus(true); updateFieldDP(activeFieldItemRecord.id, 'epsilon', inputEpsilonNumberValue === null ? undefined : inputEpsilonNumberValue); }}
													formatter={(formatterInputValue, formatterInfoObj) => {
														if (formatterInfoObj?.userTyping || formatterInputValue === undefined || formatterInputValue === null || String(formatterInputValue) === '') return String(formatterInputValue ?? '');
														return formatPlainNumber(Number(formatterInputValue)).replace(/,/g, '');
													}}
													size="small"
													style={{ width: '6.5em' }}
												/>
												<Tooltip title={translate('step3_dp.plain_field_more_tip', '模式、刻度、溢出處理、敏感度')}>
													<Button
														size="small"
														type={isFieldAdvancedOpen ? 'primary' : 'text'}
														ghost={isFieldAdvancedOpen}
														aria-expanded={isFieldAdvancedOpen}
														aria-label={`${activeFieldItemRecord.fieldName} ${translate('step3_dp.plain_field_more', '詳細')}`}
														icon={<SettingOutlined />}
														onClick={() => setOpenedFieldAdvancedIdMap((currentMap) => ({ ...currentMap, [activeFieldItemRecord.id]: !currentMap[activeFieldItemRecord.id] }))}
													>
														{translate('step3_dp.plain_field_more', '詳細')}
													</Button>
												</Tooltip>
											</div>
											{isFieldAdvancedOpen && renderFieldAdvancedSettings(activeFieldItemRecord)}
											{renderFieldHints(activeFieldItemRecord)}
										</div>
									);
								})}
							</div>
						</div>

						{/* ③ 進階：全域 δ */}
						<div style={sectionCardStyle} data-testid="dp-plain-advanced">
							<div
								role="button"
								tabIndex={0}
								aria-expanded={isGlobalAdvancedOpenStatus}
								onClick={() => setIsGlobalAdvancedOpenStatus(!isGlobalAdvancedOpenStatus)}
								onKeyDown={(keyboardEvent) => { if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') { keyboardEvent.preventDefault(); setIsGlobalAdvancedOpenStatus(!isGlobalAdvancedOpenStatus); } }}
								style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
							>
								<span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: token.colorFillSecondary, color: token.colorText, fontSize: scaleFontSize(13), flexShrink: 0 }}>3</span>
								<span style={{ flex: 1, fontSize: scaleFontSize(16), fontWeight: 700, color: token.colorText }}>
									{translate('step3_dp.plain_sec3_title', '進階：失效容忍度 δ')}
									{helpIcon(translate('step3_dp.global_delta_desc', '這是一個很小的數字，代表隱私保護「萬一失效」的最大可接受機率。只有欄位選擇 (ε, δ)-DP 模式時才會用到此設定，一般維持預設值即可。'))}
								</span>
								<span style={{ color: token.colorTextSecondary }}>{isGlobalAdvancedOpenStatus ? <UpOutlined /> : <DownOutlined />}</span>
							</div>
							{isGlobalAdvancedOpenStatus && (
								<Row gutter={12} align="middle" style={{ marginTop: 14 }}>
									<Col flex="none"><span style={{ color: token.colorText }}>{translate('step3_dp.plain_global_delta', '全域 δ')}</span></Col>
									<Col flex="none">
										<InputNumber
											aria-label="global-target-delta"
											min={GLOBAL_TARGET_DELTA_MIN_BOUND} max={GLOBAL_TARGET_DELTA_MAX_BOUND} step={0.0001}
											value={globalTargetDeltaValue}
											onChange={(inputTargetDeltaNumberValue) => useWorkspaceStore.setState({ targetDelta: inputTargetDeltaNumberValue === null ? undefined : inputTargetDeltaNumberValue })}
											formatter={(formatterInputValue, formatterInfoObj) => {
												if (formatterInfoObj?.userTyping || formatterInputValue === undefined || formatterInputValue === null) return String(formatterInputValue ?? '');
												return formatCompactScientific(formatterInputValue);
											}}
											style={{ width: '10.5em' }}
										/>
									</Col>
								</Row>
							)}
						</div>
					</div>
				</Col>

				{/* 右側：原加噪效果模擬示意圖＋三個重點數字 */}
				<Col xs={24} xl={13}>
					<div style={{ ...sectionCardStyle, height: '100%', display: 'flex', flexDirection: 'column' }} data-testid="dp-plain-summary">
						<div style={{ fontSize: scaleFontSize(16), fontWeight: 700, color: token.colorText }}>
							{translate('step3_dp.plain_chart_title', '加噪效果示意')}
							{helpIcon(translate('step3_dp.plain_chart_tip', '示意圖：灰色虛線為原始分布，藍色為加噪後。ε 越小，曲線被雜訊抹得越平。僅供參考，實際結果以下一步運算為準。'))}
						</div>
						<ReactECharts option={getDPEchartsOption()} style={{ height: '420px', width: '100%' }} theme={isDarkModeActiveStatus ? 'dark' : 'light'} />
						<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
							<div data-testid="dp-plain-sum-level" style={summaryTileStyle}>
								<div style={summaryTileLabelStyle}>
									{translate('step3_dp.plain_sum_level', '保護強度')}
									{helpIcon(<div style={{ lineHeight: 1.8 }}>
										<div>{translate('step3_dp.protection_level_tooltip_desc', '依據本次總消耗隱私預算 (ε) 換算之風險等級：')}</div>
										<div>{translate('step3_dp.protection_level_tooltip_high', ' 高強度：ε ≤ {{threshold}}，低風險', { threshold: HIGH_SECURITY_EPSILON_THRESHOLD })}</div>
										<div>{translate('step3_dp.protection_level_tooltip_medium', ' 中強度：{{low}} < ε ≤ {{high}}，風險視應用情境而定 (平衡)', { low: HIGH_SECURITY_EPSILON_THRESHOLD, high: MEDIUM_SECURITY_EPSILON_THRESHOLD })}</div>
										<div>{translate('step3_dp.protection_level_tooltip_low', ' 低強度：ε > {{threshold}}，多數情境下屬高風險', { threshold: MEDIUM_SECURITY_EPSILON_THRESHOLD })}</div>
									</div>)}
								</div>
								<div style={{ ...summaryTileValueStyle, color: protectionLevelColorMap[protectionLevelKey] }}>{protectionLevelLabelMap[protectionLevelKey]}</div>
							</div>
							<div data-testid="dp-plain-sum-budget" style={summaryTileStyle}>
								<div style={summaryTileLabelStyle}>
									{translate('step3_dp.plain_sum_budget', '已用預算 ε')}
									{helpIcon(translate('step3_dp.plain_sum_budget_tip', '所有欄位 ε 的加總／總預算上限。'))}
								</div>
								<div style={summaryTileValueStyle}>
									{formatPlainNumber(totalEquivalentEpsilonSumValue)}
									<span style={{ fontSize: scaleFontSize(14), fontWeight: 400, color: token.colorTextSecondary }}> / {formatPlainNumber(safeBudgetLimitThresholdValue)}</span>
								</div>
								<Progress percent={budgetUsagePercentageValue} showInfo={false} size="small" strokeColor={budgetStatusColor} style={{ margin: 0 }} />
								{totalConsumedDeltaSumValue > 0 && (
									<div style={{ fontSize: scaleFontSize(12), color: token.colorTextDescription }}>δ = {totalConsumedDeltaSumValue.toExponential(1).replace('.0e', 'e')}</div>
								)}
							</div>
							<div data-testid="dp-plain-sum-status" style={summaryTileStyle}>
								<div style={summaryTileLabelStyle}>
									{translate('step3_dp.plain_sum_status', '預算狀態')}
									{helpIcon(translate('step3_dp.budget_center_tooltip', '此處顯示目前所有欄位的 ε 加總，佔您設定之預算上限的比例。顏色越紅代表用量越接近上限；一旦實際超過上限將無法進入下一步，建議調降部分欄位的 ε，或提高預算上限。用量夠低時不會顯示紅色警示。'))}
								</div>
								<div style={{ ...summaryTileValueStyle, color: budgetStatusColor }}>{budgetStatusText}</div>
							</div>
						</div>
					</div>
				</Col>
			</Row>
		</div>
	);
}
