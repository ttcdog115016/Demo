/**
 * ============================================================================
 * 檔案名稱 (File): KAnonymityRules.tsx
 * 模組功能 (Description): K-匿名參數設定與帕累托邊界模擬組件 (提供 K/L/T 參數控制、抑制率策略設定與 Pareto Front 隱私效用圖表模擬)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消滅魔術數字、單字元變數與含義不明之識別字) 以及變數撰寫參考 a) ~ h)
 * ============================================================================
 */

import React, { useState, useEffect } from 'react';
import { Alert, Card, Slider, Row, Col, Divider, InputNumber, theme, Select, Button, Tag } from 'antd';
import { LockOutlined, PlusOutlined, DeleteOutlined, WarningOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore } from '../../store/useWorkspaceStore';

/**
 * ============================================================================
 * 預設臨界點常數宣告 (Magic Numbers Constants)
 * ============================================================================
 */
const MIN_K_VALUE = 2;                     // K 值最小限制 (低於 2 等同無匿名效果)
const MAX_K_VALUE = 20;                    // K 值最大限制 (過大會導致資料破壞嚴重)
const MIN_L_VALUE = 1;                     // L 值最小限制
const MAX_L_VALUE = 10;                    // L 值最大限制
const MIN_T_VALUE = 0.01;                  // T 值最小限制
const MAX_T_VALUE = 1.0;                   // T 值最大限制
const DEFAULT_T_VALUE = 0.15;              // 系統預設 T 趨近性基準值
const MIN_SUPPRESSION_PERCENT = 0;         // 最小抑制率百分比
const MAX_SUPPRESSION_PERCENT = 50;        // 最大允許抑制率百分比 (超過 50% 資料失去意義)
const SUPPRESSION_PENALTY_THRESHOLD = 12;  // 計算 Pareto 懲罰之抑制率門檻 (%)

/**
 * ECharts 繪圖工具提示 (Tooltip) 參數型別介面
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface TooltipParams 
{
	name: string;        // 數據點名稱 (如 "Current Setting")
	seriesName?: string; // 系列圖表名稱
	value: number[];     // 數據座標數值對 [X(Utility), Y(Privacy)]
	data: number[];      // 圖表原始數據陣列
}

/**
 * 函數名稱: KAnonymityRules
 * 函數功能: 渲染步驟三 K-匿名規則設定介面，提供 K-Anonymity (k)、L-Diversity (l)、T-Closeness (t) 參數調整滑桿、準識別碼威脅組合選單、抑制率策略設定，以及帕累托前沿 (Pareto Front) 隱私/效用平衡模擬圖表。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: K-匿名規則設定 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 
 *   - 被 Step 3 導覽精靈組件載入渲染
 *   - 訂閱與更新 useWorkspaceStore 中的 kValue, lValue, tValue, maxSuppression 等全域狀態
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function KAnonymityRules(): React.ReactElement 
{
	// 取得 Ant Design 當前主題 Token，用於決定元件配色
	const { token } = theme.useToken();
	
	// 深色主題狀態判定 (判斷背景色是否非純白) (符合規範 g)
	const isDarkModeActiveStatus = token.colorBgContainer !== '#ffffff';

	const { t: translate } = useTranslation();

	/**
	 * ============================================================================
	 * 全域狀態訂閱區塊 (來自 useWorkspaceStore)
	 * ============================================================================
	 */
	const currentKValue = useWorkspaceStore(
		(state) => state.kValue
	);                                                     // K-匿名群組大小 k

	const maxSuppressionPercentageValue = useWorkspaceStore(
		(state) => state.maxSuppression
	);                                                     // 最大允許抑制率 (%)

	const currentLValue = useWorkspaceStore(
		(state) => state.lValue
	);                                                     // L-多樣性 l

	const currentTValue = useWorkspaceStore(
		(state) => state.tValue
	);                                                     // T-趨近性 t

	const currentSuppressionMethodTypeStr = useWorkspaceStore(
		(state) => state.suppressionMethod
	);                                                     // 抑制方式 ('row' | 'cell')

	const currentLimitExceededActionTypeStr = useWorkspaceStore(
		(state) => state.limitExceededAction
	);                                                     // 抑制率超限處置動作

	// 修復 ts(2304) 與 eslint 錯誤：確保宣告變數名稱為 datasetColumnsListArray
	const datasetColumnsListArray = useWorkspaceStore(
		(state) => state.columns
	) || [];                                               // 數據欄位名稱清單

	const columnPrivacyRolesMapDict = useWorkspaceStore(
		(state) => state.columnRoles
	) || {};                                               // 欄位隱私角色對應

	const setStepValidationAction = useWorkspaceStore(
		(state) => state.setStepValidation
	);                                                     // 步驟驗證設定 Action

	/**
	 * ============================================================================
	 * 全頁即時防呆與邏輯校驗機制 (Effect Hook)
	 * ============================================================================
	 * 函數功能: 當 K, L, T 或抑制率變化時，驗證這些參數在數學與實務上是否衝突。
	 * 規範對照: 符合規範 d) 嚴格校驗變數資料，防止不合理值發生
	 */
	useEffect(
		() => 
		{
			// 1. 驗證 K 值是否過小
			if (currentKValue === undefined || currentKValue === null || currentKValue < MIN_K_VALUE) 
			{
				setStepValidationAction(false, translate('step3.error_k_too_small', 'K 值必須大於等於 2（K=1 等同於沒有匿名效果）。'));

				return;
			}

			// 2. 驗證 K 必須大於等於 L (L-Diversity 數學限制：多樣性類別數不可能超過群組筆數)
			if (currentKValue < currentLValue) 
			{
				setStepValidationAction(false, translate('step3.error_k_less_than_l', `參數衝突：要求資料具備 ${currentLValue} 種多樣性 (L=${currentLValue})，但群組大小僅有 ${currentKValue} (K=${currentKValue})，這是數學上無法達成的。請確保 K ≥ L。`));

				return;
			}

			// 3. 驗證 T 值是否落在 0~1 的機率範圍內
			if (currentTValue === undefined || currentTValue === null || currentTValue <= 0 || currentTValue > 1) 
			{
				setStepValidationAction(false, translate('step3.error_t_range', 'T-Closeness (t) 必須介於 0 與 1 之間。'));

				return;
			}
			
			// 驗證通過，解鎖進入下一步的權限
			setStepValidationAction(true, null);
		}, 
		[currentKValue, currentLValue, currentTValue, maxSuppressionPercentageValue, setStepValidationAction, translate]
	);

	/**
	 * 函數名稱: handleKValueChange
	 * 函數功能: 處理 K-匿名 k 數值變更事件，寫入全域 WorkspaceStore。
	 */
	const handleKValueChange = (inputKNumberValue: number | null): void => 
	{
		useWorkspaceStore.setState({ kValue: inputKNumberValue ?? MIN_K_VALUE });
	};

	/**
	 * 函數名稱: handleLValueChange
	 * 函數功能: 處理 L-多樣性 l 數值變更事件，寫入全域 WorkspaceStore。
	 */
	const handleLValueChange = (inputLNumberValue: number | null): void => 
	{
		useWorkspaceStore.setState({ lValue: inputLNumberValue ?? MIN_L_VALUE });
	};

	/**
	 * 函數名稱: handleTValueChange
	 * 函數功能: 處理 T-趨近性 t 數值變更事件，寫入全域 WorkspaceStore。
	 */
	const handleTValueChange = (inputTNumberValue: number | null): void => 
	{
		useWorkspaceStore.setState({ tValue: inputTNumberValue ?? DEFAULT_T_VALUE });
	};

	/**
	 * 函數名稱: handleMaxSuppressionChange
	 * 函數功能: 處理最大允許抑制率限制數值變更事件，寫入全域 WorkspaceStore。
	 */
	const handleMaxSuppressionChange = (inputSuppressionPercentageValue: number | null): void => 
	{
		useWorkspaceStore.setState({ maxSuppression: inputSuppressionPercentageValue ?? MIN_SUPPRESSION_PERCENT });
	};

	/**
	 * 函數名稱: handleSuppressionMethodChange
	 * 函數功能: 處理抑制層級方式 (Row/Cell) 下拉選單切換事件，寫入全域 WorkspaceStore。
	 */
	const handleSuppressionMethodChange = (selectedMethodTypeString: string): void => 
	{
		useWorkspaceStore.setState({ suppressionMethod: selectedMethodTypeString });
	};

	/**
	 * 函數名稱: handleLimitExceededActionChange
	 * 函數功能: 處理抑制率超限時應變處置動作選單變更事件，寫入全域 WorkspaceStore。
	 */
	const handleLimitExceededActionChange = (selectedActionTypeString: string): void => 
	{
		useWorkspaceStore.setState({ limitExceededAction: selectedActionTypeString });
	};

	// 修復 ts(7006) 與 ts(2552) 錯誤：加入明確 : string 型別註記，並統一變數名稱為 datasetColumnsListArray
	const filteredQuasiIdentifierColumnsList = datasetColumnsListArray.filter(
		(columnNameString: string) => 
		{
			const roleNameLowerCaseString = (columnPrivacyRolesMapDict[columnNameString] || '').toLowerCase();

			return roleNameLowerCaseString === 'qi' || roleNameLowerCaseString === 'quasi' || roleNameLowerCaseString === 'quasi-identifier';
		}
	);

	// 預設準識別碼欄位備用清單 (若沒有明確標示的，則排除 Identifier 後全數納入)
	const quasiIdentifierColumnsArray = filteredQuasiIdentifierColumnsList.length > 0 
		? filteredQuasiIdentifierColumnsList 
		: datasetColumnsListArray.filter((columnNameString: string) => (columnPrivacyRolesMapDict[columnNameString] || '').toLowerCase() !== 'identifier');

	// 自訂威脅組合模式開關與組合數據狀態 (符合規範 g)
	const [calculationModeType, setCalculationModeType] = useState<'all' | 'custom'>('all');

	// 記錄使用者配置的多個威脅子集陣列 (例如: [["Age", "Gender"], ["Zipcode", "Age"]])
	const [quasiIdentifierCombinationsList, setQuasiIdentifierCombinationsList] = useState<string[][]>([[]]);

	/**
	 * 函數名稱: addCombination
	 * 函數功能: 新增一組空白之準識別碼威脅組合選單列。
	 */
	const addCombination = (): void => 
	{
		setQuasiIdentifierCombinationsList([...quasiIdentifierCombinationsList, []]);
	};

	/**
	 * 函數名稱: removeCombination
	 * 函數功能: 依據索引刪除指定之準識別碼威脅組合選單列。
	 */
	const removeCombination = (targetRowIndexNumber: number): void => 
	{ 
		const updatedCombinationsListArray = quasiIdentifierCombinationsList.filter(
			(_, currentCombinationIndex) => currentCombinationIndex !== targetRowIndexNumber
		); 

		setQuasiIdentifierCombinationsList(updatedCombinationsListArray.length ? updatedCombinationsListArray : [[]]); 
	};

	/**
	 * 函數名稱: updateCombination
	 * 函數功能: 更新特定索引威脅組合所勾選之準識別碼欄位陣列。
	 */
	const updateCombination = (targetRowIndexNumber: number, selectedColumnsValuesArray: string[]): void => 
	{ 
		const updatedCombinationsListArray = [...quasiIdentifierCombinationsList]; 

		updatedCombinationsListArray[targetRowIndexNumber] = selectedColumnsValuesArray; 

		setQuasiIdentifierCombinationsList(updatedCombinationsListArray); 
	};

	/**
	 * ============================================================================
	 * 帕累托邊界 (Pareto Front) 圖表模擬器與座標演算區塊
	 * ============================================================================
	 * 函數名稱: getKAnonymityChartOption
	 * 函數功能: 依據當前 K/L/T 參數與抑制率門檻，繪製 Pareto Front 隱私 vs 數據可用性權衡模擬曲線圖表。
	 * 
	 * 計算邏輯:
	 * 1. 使用 Math.pow 繪製出由左上至右下彎曲的「最優可能邊界曲線」(Pareto Frontier)。
	 * 2. 依據 K, L, T 值計算加權後的「隱私保護強度」(Y軸: Privacy Level)。
	 * 3. 依據最大抑制率 (maxSuppression) 計算對「資料效用」的懲罰扣分 (X軸: Utility)。
	 * 4. 點離 Pareto 前沿越近代表演算法設定越優秀；越往左下角代表「效用跟隱私雙輸」。
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記
	 */
	const getKAnonymityChartOption = (): Record<string, unknown> => 
	{
		// 1. 繪製 Pareto Front 模擬邊界曲線陣列數據 (計算 40 個點畫出平滑曲線)
		const paretoLineDataCoordinatesArray = Array.from(
			{ length: 40 }, 
			(_, dataPointIndexNumber) => 
			{
				const calculatedYCoordinateValue = 15 + (dataPointIndexNumber * (80 / 39));

				const calculatedXCoordinateValue = 100 - Math.pow((calculatedYCoordinateValue - 15) / 80, 2.5) * 85;

				return [Number(calculatedXCoordinateValue.toFixed(1)), Number(calculatedYCoordinateValue.toFixed(1))];
			}
		);

		// 2. 計算各參數之隱私保護強度權重 (Y軸，數值越大代表隱私保護程度越高)
		const weightScoreForKValue = (currentKValue - MIN_K_VALUE) / 18;        

		const weightScoreForLValue = (currentLValue - MIN_L_VALUE) / 9;         

		const weightScoreForTValue = (1 - currentTValue) / 0.99;      
		
		// 三個參數合併計分，權重配比 (K佔50%, L佔25%, T佔25%)
		const combinedPrivacyIntensityScoreValue = Math.min(1, Math.max(0, (weightScoreForKValue * 0.5) + (weightScoreForLValue * 0.25) + (weightScoreForTValue * 0.25)));

		// 換算為 15~95% 之間的圖表 Y 軸座標
		const optimalYCoordinateValue = 15 + (combinedPrivacyIntensityScoreValue * 80);

		// 根據 Y 值，在最優邊界線上對應的最高理想 X 軸可用性分數
		const optimalXCoordinateValue = 100 - Math.pow((optimalYCoordinateValue - 15) / 80, 2.5) * 85;

		// 3. 抑制率扣分懲罰強度計算 (若容忍高抑制率，代表實質被刪除的資料變多，因此必須對 X 軸的可用性扣分)
		const suppressionPenaltyScoreValue = maxSuppressionPercentageValue >= SUPPRESSION_PENALTY_THRESHOLD ? 0 : (SUPPRESSION_PENALTY_THRESHOLD - maxSuppressionPercentageValue) * 1.8;

		// 最終當前的資料效用座標點 (X軸)
		const penalizedXCoordinateValue = Math.max(2, optimalXCoordinateValue - Math.pow(suppressionPenaltyScoreValue, 1.2));

		// 組合成為畫面上的橘色標記點
		const currentDataPointCoordinatesArray = [Number(penalizedXCoordinateValue.toFixed(1)), Number(optimalYCoordinateValue.toFixed(1))];

		return {
			backgroundColor: 'transparent',
			tooltip: { 
				trigger: 'item', 
				formatter: (tooltipParamsObj: TooltipParams) => 
				{
					if (tooltipParamsObj.name === translate('step3.current_setting')) 
					{
						return `<div style="font-weight:bold;margin-bottom:4px;color:#faad14;">${translate('step3.chart_eval')}</div>
								${translate('step3.chart_utility')}${tooltipParamsObj.value[0]}%<br/>
								${translate('step3.chart_privacy')}${tooltipParamsObj.value[1]}%<br/>
								<span style="font-size: 11px; color: #8c8c8c;">${translate('step3.chart_distance')}${(optimalXCoordinateValue - penalizedXCoordinateValue).toFixed(1)}%</span>`;
					}

					return tooltipParamsObj.seriesName === translate('step3.chart_pareto_front') 
						? `${translate('step3.chart_pareto_limit')}<br/>${translate('step3.chart_util_short')} ${tooltipParamsObj.data[0]}% | ${translate('step3.chart_priv_short')} ${tooltipParamsObj.data[1]}%` : '';
				} 
			},
			grid: { top: '15%', left: '8%', right: '15%', bottom: '12%', containLabel: true },
			xAxis: { 
				type: 'value', min: 0, max: 100, name: translate('step3.chart_x_axis'), nameLocation: 'center', nameGap: 30, 
				nameTextStyle: { color: token.colorTextSecondary, fontWeight: 500 }, 
				axisLabel: { formatter: '{value} %', color: token.colorTextDescription }, 
				splitLine: { lineStyle: { color: token.colorSplit } }, axisLine: { lineStyle: { color: token.colorBorder } } 
			},
			yAxis: { 
				type: 'value', min: 0, max: 100, name: translate('step3.chart_y_axis'), nameLocation: 'center', nameGap: 40, 
				nameTextStyle: { color: token.colorTextSecondary, fontWeight: 500 }, 
				axisLabel: { formatter: '{value} %', color: token.colorTextDescription }, 
				splitLine: { lineStyle: { color: token.colorSplit } }, axisLine: { lineStyle: { color: token.colorBorder } } 
			},
			series: [
				{ 
					name: translate('step3.chart_pareto_front'), 
					type: 'line', 
					smooth: true, 
					data: paretoLineDataCoordinatesArray, 
					lineStyle: { color: isDarkModeActiveStatus ? '#5c6bc0' : '#3f51b5', width: 3 }, 
					showSymbol: false,
					areaStyle: {
						color: {
							type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
							colorStops: [
								{ offset: 0, color: isDarkModeActiveStatus ? 'rgba(92, 107, 192, 0.4)' : 'rgba(63, 81, 181, 0.4)' },
								{ offset: 1, color: isDarkModeActiveStatus ? 'rgba(92, 107, 192, 0.05)' : 'rgba(63, 81, 181, 0.05)' }
							]
						}
					}
				},
				{
					name: 'Extremes',
					type: 'scatter', 
					data: [],
					markPoint: {
						symbol: 'circle',
						data: [
							{ coord: [15, 95], name: translate('step3.extreme_privacy'), itemStyle: { color: '#722ed1' }, symbolSize: 8, label: { show: true, position: 'top', formatter: translate('step3.extreme_privacy'), color: token.colorTextDescription, fontSize: 11 } }, 
							{ coord: [100, 15], name: translate('step3.extreme_utility'), itemStyle: { color: '#13c2c2' }, symbolSize: 8, label: { show: true, position: 'right', offset: [6, 0], formatter: translate('step3.extreme_utility'), color: token.colorTextDescription, fontSize: 11 } }
						]
					}
				},
				{
					name: translate('step3.current_status'),
					type: 'effectScatter',
					coordinateSystem: 'cartesian2d',
					data: [
						{ 
							value: currentDataPointCoordinatesArray, 
							name: translate('step3.current_setting'),
							itemStyle: { color: '#faad14', shadowBlur: 10, shadowColor: 'rgba(250, 173, 20, 0.8)' }, 
							symbolSize: 18, 
							label: { 
								show: true, position: 'top', 
								formatter: `${translate('step3.current_setting')}\nU:${currentDataPointCoordinatesArray[0]}% P:${currentDataPointCoordinatesArray[1]}%`, 
								fontWeight: 'bold', color: '#faad14', 
								backgroundColor: isDarkModeActiveStatus ? '#141414' : '#fff', 
								padding: [4, 6], borderRadius: 4, borderWidth: 1, borderColor: token.colorBorder, lineHeight: 16 
							} 
						}
					],
					rippleEffect: { brushType: 'stroke', scale: 3 }
				}
			]
		};
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
			<Alert title={translate('step3.k_params_title')} description={translate('step3.k_params_desc')} type="info" showIcon />
			
			<Row gutter={24} align="stretch">
				
				{/* 左側參數控制區塊 */}
				<Col span={8}>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', paddingRight: '4px' }}>
						<Card title={<span style={{ fontWeight: 600 }}><LockOutlined /> {translate('step3.privacy_settings')}</span>} variant="borderless" style={{ background: token.colorBgContainer, boxShadow: isDarkModeActiveStatus ? 'none' : '0 2px 8px rgba(0,0,0,0.04)', flex: 1 }}>
							
							{/* k-anonymity 滑桿 */}
							<Row gutter={16} align="middle" style={{ marginBottom: '6px' }}>
								<Col span={8}><span style={{ color: token.colorText }}>k-anonymity (k)：</span></Col>
								<Col span={10}><Slider min={MIN_K_VALUE} max={MAX_K_VALUE} value={currentKValue} onChange={handleKValueChange} /></Col>
								<Col span={6}><InputNumber min={MIN_K_VALUE} max={MAX_K_VALUE} value={currentKValue} onChange={handleKValueChange} style={{ width: '100%' }} /></Col>
							</Row>
							
							{/* 運算範圍選擇 */}
							<div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: calculationModeType === 'custom' ? '8px' : '16px' }}>
								<span style={{ color: token.colorTextSecondary, fontSize: '12px', minWidth: '70px' }}>{translate('step3.calc_scope')}</span>
								<Select value={calculationModeType} onChange={(dropdownSelectedModeValue) => setCalculationModeType(dropdownSelectedModeValue as 'all' | 'custom')} size="small" style={{ flex: 1 }} options={[{ value: 'all', label: translate('step3.apply_all_qi') }, { value: 'custom', label: translate('step3.custom_qi_combo') }]} />
							</div>
							
							{/* 自訂威脅組合 */}
							{calculationModeType === 'custom' && (
								<div style={{ marginBottom: '16px', padding: '12px', background: isDarkModeActiveStatus ? '#141414' : '#fafafa', borderRadius: '8px', border: `1px solid ${token.colorBorder}` }}>
									{quasiIdentifierCombinationsList.map(
										(combinationItemArray, combinationRowIndexNumber) => 
										(
											<div key={combinationRowIndexNumber} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
												<Tag color="cyan" style={{ margin: 'auto 0', height: 'fit-content' }}>{translate('step3.combo_idx', { idx: combinationRowIndexNumber + 1 })}</Tag>

												{/* 修復 ts(7006) 錯誤：明確標記型別為 string */}
												<Select 
													mode="multiple" 
													allowClear 
													placeholder={translate('step3.select_field')} 
													style={{ flex: 1 }} 
													value={combinationItemArray} 
													onChange={(dropdownSelectedValuesArray) => updateCombination(combinationRowIndexNumber, dropdownSelectedValuesArray)} 
													options={
														quasiIdentifierColumnsArray.map(
															(quasiIdentifierColumnNameString: string) => 
															(
																{ 
																	label: quasiIdentifierColumnNameString, 
																	value: quasiIdentifierColumnNameString, 
																	disabled: quasiIdentifierCombinationsList.some((comboListItemArray, comboListIndexNumber) => comboListIndexNumber !== combinationRowIndexNumber && comboListItemArray.includes(quasiIdentifierColumnNameString)) 
																}
															)
														)
													} 
												/>

												<Button danger icon={<DeleteOutlined />} disabled={quasiIdentifierCombinationsList.length === 1} onClick={() => removeCombination(combinationRowIndexNumber)} />
											</div>
										)
									)}

									<Button type="dashed" block icon={<PlusOutlined />} disabled={quasiIdentifierCombinationsList.reduce((sumAccumulatorValue, combinationItemArray) => sumAccumulatorValue + combinationItemArray.length, 0) >= quasiIdentifierColumnsArray.length} onClick={addCombination}>{translate('step3.add_threat_combo')}</Button>
								</div>
							)}
							
							{/* l-diversity 滑桿 */}
							<Row gutter={16} align="middle" style={{ marginBottom: '16px' }}>
								<Col span={8}><span style={{ color: token.colorText }}>l-diversity (l)：</span></Col>
								<Col span={10}><Slider min={MIN_L_VALUE} max={MAX_L_VALUE} value={currentLValue} onChange={handleLValueChange} /></Col>
								<Col span={6}><InputNumber min={MIN_L_VALUE} max={MAX_L_VALUE} value={currentLValue} onChange={handleLValueChange} style={{ width: '100%' }} /></Col>
							</Row>
							
							{/* t-closeness 滑桿 */}
							<Row gutter={16} align="middle" style={{ marginBottom: '8px' }}>
								<Col span={8}><span style={{ color: token.colorText }}>t-closeness (t)：</span></Col>
								<Col span={10}><Slider min={MIN_T_VALUE} max={MAX_T_VALUE} step={MIN_T_VALUE} value={currentTValue} onChange={handleTValueChange} /></Col>
								<Col span={6}><InputNumber min={MIN_T_VALUE} max={MAX_T_VALUE} step={MIN_T_VALUE} value={currentTValue} onChange={handleTValueChange} style={{ width: '100%' }} /></Col>
							</Row>
							
							<Divider dashed style={{ margin: '16px 0' }} />

							{/* 抑制率策略 */}
							<div style={{ padding: '16px', background: isDarkModeActiveStatus ? '#141414' : '#fafafa', borderRadius: '8px', border: `1px solid ${token.colorBorder}` }}>
								<div style={{ fontWeight: 600, marginBottom: '16px', color: token.colorText }}><WarningOutlined style={{ color: token.colorWarning, marginRight: '6px' }} /> {translate('step3.suppression_strategy')}</div>
								
								<Row align="middle" style={{ marginBottom: '16px' }}>
									<Col span={7}><span style={{ color: token.colorTextSecondary, fontSize: '13px' }}>{translate('step3.suppress_method')}</span></Col>
									<Col span={17}><Select value={currentSuppressionMethodTypeStr} onChange={handleSuppressionMethodChange} size="small" style={{ width: '100%' }} options={[{ value: 'row', label: translate('step3.row_suppression') }, { value: 'cell', label: translate('step3.cell_suppression') }]} /></Col>
								</Row>

								<Row align="middle" style={{ marginBottom: '4px' }}>
									<Col span={7}><span style={{ color: token.colorTextSecondary, fontSize: '13px' }}>{translate('step3.suppress_limit')}</span></Col>
									<Col span={11}><Slider min={MIN_SUPPRESSION_PERCENT} max={MAX_SUPPRESSION_PERCENT} value={maxSuppressionPercentageValue} onChange={handleMaxSuppressionChange} style={{ margin: '0 8px 0 0' }} /></Col>
									<Col span={6}><InputNumber min={MIN_SUPPRESSION_PERCENT} max={MAX_SUPPRESSION_PERCENT} value={maxSuppressionPercentageValue} onChange={handleMaxSuppressionChange} style={{ width: '100%' }} size="small" addonAfter="%" /></Col>
								</Row>

								<Row align="middle">
									<Col span={7}><span style={{ color: token.colorTextSecondary, fontSize: '13px' }}>{translate('step3.exceed_behavior')}</span></Col>
									<Col span={17}>
										<Select 
											value={currentLimitExceededActionTypeStr} 
											onChange={handleLimitExceededActionChange} 
											size="small" 
											style={{ width: '100%' }} 
											options={
												[
													{ value: 'stop_and_error', label: translate('step3.stop_and_error') }, 
													{ value: 'relax_k', label: translate('step3.relax_k') }, 
													{ value: 'force_suppress', label: translate('step3.force_suppress') }
												]
											} 
										/>
									</Col>
								</Row>
							</div>
						</Card>
					</div>
				</Col>

				{/* 右側帕累托模擬圖表區塊 */}
				<Col span={16}>
					<Card title={translate('step3.solution_space')} variant="borderless" style={{ background: token.colorBgContainer, boxShadow: isDarkModeActiveStatus ? 'none' : '0 2px 8px rgba(0,0,0,0.04)', height: '100%' }}>
						<ReactECharts option={getKAnonymityChartOption()} style={{ height: '420px', width: '100%' }} theme={isDarkModeActiveStatus ? 'dark' : 'light'} />
					</Card>
				</Col>
			</Row>
		</div>
	);
}