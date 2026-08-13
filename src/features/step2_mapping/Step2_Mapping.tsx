/**
 * ============================================================================
 * 檔案名稱 (File): Step2_Mapping.tsx
 * 模組功能 (Description): 去識別化工作流第二步：資料預先處理與脫敏技術映射組件 (提供清洗策略對應、即時字串預覽，並依據隱私模式載入 K-Anonymity 或 DP 子組件)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則 (消除單字元變數、明確化參數與常數命名)
 * ============================================================================
 */

import React from 'react';
import { Card, Table, Select, Input, Typography, theme, Space, Alert } from 'antd';
import { ToolOutlined, SafetyOutlined, ArrowRightOutlined, LockOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import CryptoJS from 'crypto-js';

import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { useAuthStore } from '../../store/useAuthStore';

import KAnonymityMapping from './KAnonymityMapping';
import DifferentialPrivacyMapping from './DifferentialPrivacyMapping';
import TemplateManager from './TemplateManager';

const { Text } = Typography;

/**
 * 魔術數字與預設常數宣告
 * 規範對照: 符合規範 e) 避免使用不易理解之數字 (Magic Number)
 */
const DEFAULT_PREVIEW_SYMBOL = '-';
const HASH_PREVIEW_LENGTH = 16;

/**
 * 預處理表格對應紀錄資料結構
 * 規範對照: 符合規範 h) 資料結構宣告註記，欄位說明置於右方
 */
interface MappingRecord 
{
	key: string;         // 表格列唯一鍵值 (欄位名稱)
	name: string;        // 欄位名稱
	action: string;      // 預處理清洗動作類型
	param: string;       // 預處理動作設定參數
	sampleValue: string; // 預覽樣本數據數值
}

/**
 * 函數名稱: applyPreprocess
 * 函數功能: 依據選定之動作與參數，對單一儲存格字串資料執行預處理清洗 (如: 去除數字/空白、字串截取、正則汱除或密碼學雜湊 Hash)。
 * 
 * 輸入參數 (Input):
 *   - cellValueData (unknown): 原始資料儲存格數值
 *   - actionTypeStr (string): 預處理清洗動作類型 (如 'remove_digits', 'hash' 等)
 *   - actionParameterStr (string): 預處理動作設定參數 (如 Regex 或雜湊演算法種類)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - string: 經過預處理清洗後之字串結果
 * 呼叫關係 (Call Relations): 於即時預覽欄位呈現與內部資料轉換時被呼叫
 * 
 * 規範對照: 符合規範 a), c) 使用清晰明確之變數名稱
 */
const applyPreprocess = (cellValueData: unknown, actionTypeStr: string, actionParameterStr: string): string => 
{
	if (cellValueData == null || cellValueData === '') 
	{
		return DEFAULT_PREVIEW_SYMBOL;
	}

	let targetPreprocessString = String(cellValueData);

	if (actionTypeStr === 'none' || !actionTypeStr) 
	{
		return targetPreprocessString;
	}
	
	if (actionTypeStr === 'remove_digits') 
	{
		targetPreprocessString = targetPreprocessString.replace(/\d+/g, '');
	} 
	else if (actionTypeStr === 'remove_spaces') 
	{
		targetPreprocessString = targetPreprocessString.replace(/\s+/g, '');
	} 
	else if (actionTypeStr === 'keep_before' && actionParameterStr) 
	{
		const targetSubstringIndex = targetPreprocessString.indexOf(actionParameterStr);

		targetPreprocessString = targetSubstringIndex !== -1 ? targetPreprocessString.substring(0, targetSubstringIndex) : DEFAULT_PREVIEW_SYMBOL;
	} 
	else if (actionTypeStr === 'keep_until' && actionParameterStr) 
	{
		const targetSubstringIndex = targetPreprocessString.indexOf(actionParameterStr);

		targetPreprocessString = targetSubstringIndex !== -1 ? targetPreprocessString.substring(0, targetSubstringIndex + actionParameterStr.length) : DEFAULT_PREVIEW_SYMBOL;
	} 
	else if (actionTypeStr === 'regex_replace' && actionParameterStr) 
	{
		try 
		{
			const regexMatcherInstance = new RegExp(actionParameterStr, 'g');

			targetPreprocessString = targetPreprocessString.replace(regexMatcherInstance, '');
		} 
		catch 
		{ 
			/* ignore regex errors */ 
		}
	} 
	else if (actionTypeStr === 'hash') 
	{
		try 
		{
			let calculatedHashResult = '';

			const cleanedAlgorithmParamName = actionParameterStr?.toLowerCase().trim();
			
			if (cleanedAlgorithmParamName === 'md5') 
			{
				calculatedHashResult = CryptoJS.MD5(targetPreprocessString).toString();
			} 
			else if (cleanedAlgorithmParamName === 'sha512') 
			{
				calculatedHashResult = CryptoJS.SHA512(targetPreprocessString).toString();
			} 
			else 
			{
				// 預設使用業界標準之 SHA-256 雜湊
				calculatedHashResult = CryptoJS.SHA256(targetPreprocessString).toString();
			}
			
			// 為了 UI 預覽美觀，擷取前 16 碼並加上刪節號
			targetPreprocessString = calculatedHashResult.substring(0, HASH_PREVIEW_LENGTH) + '...';
		} 
		catch (hashingErrorExecution) 
		{
			console.error('Hashing execution error:', hashingErrorExecution);

			targetPreprocessString = 'Hash Error';
		}
	}
	
	return targetPreprocessString || DEFAULT_PREVIEW_SYMBOL;
};

/**
 * 函數名稱: Step2_Mapping
 * 函數功能: 渲染步驟二主頁面，提供第一階段「資料預先處理」表格設定，並依據模式切換第二階段之 K-Anonymity 或 Differential Privacy 映射子組件。
 * 
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): 
 *   - React.ReactElement: 步驟二 UI 視圖 JSX 結構
 * 呼叫關係 (Call Relations): 
 *   - 被主流程 Step 精靈組件載入渲染
 *   - 訂閱用 useAuthStore 判斷 Data Owner 編輯權限，用 useWorkspaceStore 讀寫全域預處理規則
 * 
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function Step2_Mapping(): React.ReactElement 
{
	const { token } = theme.useToken();
	
	// 深色主題狀態判定 (符合規範 g)
	const isDarkModeActive = token.colorBgContainer !== '#ffffff';

	const { t: translate } = useTranslation();

	// 從 AuthStore 取得當前使用者角色並判斷規則編輯權限 (符合規範 g, i)
	const currentUserSession = useAuthStore(
		(state) => state.user
	);

	const isUserAllowedToEditRulesStatus = currentUserSession?.role === 'data_owner'; // 僅 Data Owner 擁有規則修改權限

	// 從 WorkspaceStore 讀取數據與預處理規則 (符合規範 g, i)
	const currentPrivacyMode = useWorkspaceStore(
		(state) => state.privacyMode
	);

	const datasetColumnsList = useWorkspaceStore(
		(state) => state.columns
	);

	const previewDataRowsList = useWorkspaceStore(
		(state) => state.previewData
	);

	const preprocessingRulesMap = useWorkspaceStore(
		(state) => state.preprocessingRules
	) || {};

	const setPreprocessingRulesAction = useWorkspaceStore(
		(state) => state.setPreprocessingRules
	);

	/**
	 * 函數名稱: handleRuleChange
	 * 函數功能: 處理單一欄位之預處理清洗動作或參數變更事件，並即時更新至全域 WorkspaceStore。
	 * 
	 * 輸入參數 (Input):
	 *   - targetColumnNameStr (string): 欄位名稱
	 *   - targetRuleKey ('action' | 'param'): 欲修改之屬性鍵值
	 *   - newRuleValueData (string): 修改之新數值
	 * 輸出參數 (Output): 無
	 * 返回值 (Return): void
	 * 呼叫關係 (Call Relations): 綁定於預處理表格 Select 與 Input 之 onChange 事件
	 * 
	 * 規範對照: 符合規範 b) 函數開頭註記
	 */
	const handleRuleChange = (targetColumnNameStr: string, targetRuleKey: 'action' | 'param', newRuleValueData: string): void => 
	{
		if (!isUserAllowedToEditRulesStatus) 
		{
			return;
		}

		setPreprocessingRulesAction({
			...preprocessingRulesMap,
			[targetColumnNameStr]: {
				...(preprocessingRulesMap[targetColumnNameStr] || { action: 'none', param: '' }),
				[targetRuleKey]: newRuleValueData
			}
		});
	};

	// 必須填寫參數之預處理動作清單 (符合規範 g)
	const actionsRequiringParameterArray = ['keep_before', 'keep_until', 'regex_replace'];
	
	// 檢查並篩選出未填寫必要參數之錯誤欄位清單 (符合規範 g)
	const invalidParameterColumnsList = datasetColumnsList.filter(
		(columnNameString) => 
		{
			const currentColumnRuleItem = preprocessingRulesMap[columnNameString];

			return currentColumnRuleItem && actionsRequiringParameterArray.includes(currentColumnRuleItem.action) && (!currentColumnRuleItem.param || currentColumnRuleItem.param.trim() === '');
		}
	);

	// 轉換 Ant Design Table 呈現用之數據清單 (符合規範 g)
	const mappingTableDataList: MappingRecord[] = datasetColumnsList.map(
		(columnNameString) => 
		(
			{
				key: columnNameString,
				name: columnNameString,
				action: preprocessingRulesMap[columnNameString]?.action || 'none',
				param: preprocessingRulesMap[columnNameString]?.param || '',
				sampleValue: previewDataRowsList.length > 0 ? String(previewDataRowsList[0][columnNameString] || DEFAULT_PREVIEW_SYMBOL) : DEFAULT_PREVIEW_SYMBOL
			}
		)
	);

	// 第一階段預處理表格欄位定義 (符合規範 g, h)
	const preprocessTableColumnsConfig = [
		{
			title: translate('step2.col_name', '欄位名稱'),
			dataIndex: 'name', 
			width: '20%',
			render: (fieldNameTextValue: string) => <Text strong>{fieldNameTextValue}</Text>
		},
		{
			title: translate('step2.clean_strategy', 'Cleansing Strategy'),
			dataIndex: 'action', 
			width: '25%',
			render: (actionTypeValue: string, rowRecordItem: MappingRecord) => (
				<Select
					value={actionTypeValue}
					onChange={(selectedDropdownAction) => handleRuleChange(rowRecordItem.name, 'action', selectedDropdownAction)}
					disabled={!isUserAllowedToEditRulesStatus}
					style={{ width: '100%' }}
					options={
						[
							{ value: 'none', label: translate('step2.no_action', '不處理') },
							{ value: 'remove_digits', label: translate('step2.remove_digits', '移除數字') },
							{ value: 'remove_spaces', label: translate('step2.remove_spaces', '移除空白') },
							{ value: 'keep_before', label: translate('step2.keep_before', '保留特定字元前文字') },
							{ value: 'keep_until', label: translate('step2.keep_until', '保留至特定字元(含)') },
							{ value: 'regex_replace', label: translate('step2.regex_replace', '正則表達式汱除') },
							{ value: 'hash', label: translate('step2.hash', '雜湊 (Hash)') }
						]
					}
				/>
			)
		},
		{
			title: translate('step2.param_setting', 'Parameter Setting'),
			dataIndex: 'param', 
			width: '20%',
			render: (parameterTextValue: string, rowRecordItem: MappingRecord) => 
			{
				const isInputControlDisabled = !isUserAllowedToEditRulesStatus || ['none', 'remove_digits', 'remove_spaces'].includes(rowRecordItem.action);

				const hasRuleValidationErrorStatus = invalidParameterColumnsList.includes(rowRecordItem.name);
				
				return (
					<Input
						placeholder={rowRecordItem.action === 'hash' ? translate('step2.input_hash', '選填 (如: md5, sha512)') : (isInputControlDisabled ? DEFAULT_PREVIEW_SYMBOL : translate('step2.input_regex', '請輸入關鍵字或 Regex'))}
						value={parameterTextValue}
						onChange={(inputChangeEvent) => handleRuleChange(rowRecordItem.name, 'param', inputChangeEvent.target.value)}
						disabled={isInputControlDisabled}
						status={hasRuleValidationErrorStatus ? 'error' : undefined}
						style={{ width: '100%', backgroundColor: hasRuleValidationErrorStatus ? (isDarkModeActive ? '#2c1618' : '#fff2f0') : undefined }}
					/>
				);
			}
		},
		{
			title: translate('step2.live_preview', '即時預覽 (取首筆資料)'),
			key: 'preview', 
			width: '35%',
			render: (_: unknown, rowRecordItem: MappingRecord) => 
			{
				const originalSampleTextValue = rowRecordItem.sampleValue;

				const processedSampleTextValue = applyPreprocess(originalSampleTextValue, rowRecordItem.action, rowRecordItem.param);

				const isContentModifiedStatus = originalSampleTextValue !== processedSampleTextValue;

				return (
					<Space style={{ display: 'flex', flexWrap: 'wrap' }}>
						<Text type="secondary" delete={isContentModifiedStatus}>{originalSampleTextValue}</Text>
						{isContentModifiedStatus && <ArrowRightOutlined style={{ color: token.colorPrimary, fontSize: 12 }} />}
						{isContentModifiedStatus && <Text style={{ color: token.colorPrimary, fontWeight: 600 }}>{processedSampleTextValue}</Text>}
					</Space>
				);
			}
		}
	];

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
			
			{/* 唯讀模式警示 Banner */}
			{!isUserAllowedToEditRulesStatus && (
				<Alert type="info" showIcon icon={<LockOutlined />} message="唯讀保護模式 (Read-Only Mode)" description="當前角色無權限修改欄位屬性與預先處理規則。畫面設定已全數鎖定，僅供瀏覽與預覽。" />
			)}

			{/* 範本管理模組入口 */}
			<div style={{ display: 'flex', justifyContent: 'flex-end' }}>
				<TemplateManager />
			</div>

			{/* 第一階段：資料預先處理 */}
			<Card 
				title={<span style={{ fontWeight: 600 }}><ToolOutlined style={{ marginRight: 8, color: token.colorPrimary }} /> {translate('step2.stage1_title', '第一階段：資料預先處理 (選填)')}</span>}
				variant="borderless" 
				style={{ background: token.colorBgContainer, padding: 0 }}
				styles={{ body: { padding: '16px' } }}
			>
				<Table dataSource={mappingTableDataList} columns={preprocessTableColumnsConfig} pagination={false} size="small" bordered={false} rowKey="key" scroll={{ y: 250 }} style={{ background: isDarkModeActive ? '#141414' : '#fafafa', borderRadius: 8, border: `1px solid ${token.colorBorderSecondary}` }} />
			</Card>

			{/* 第二階段：隱私強化技術設定 */}
			<Card 
				title={<span style={{ fontWeight: 600 }}><SafetyOutlined style={{ marginRight: 8, color: '#52c41a' }} /> {currentPrivacyMode === 'k-anonymity' ? translate('step2.stage2_title_k', '第二階段：隱私強化技術設定 (K-匿名化)') : translate('step2.stage2_title_dp', '第二階段：隱私強化技術設定 (差分隱私)')}</span>}
				variant="borderless" 
				style={{ background: token.colorBgContainer }}
				styles={{ body: { padding: 0 } }} 
			>
				{currentPrivacyMode === 'k-anonymity' ? <KAnonymityMapping /> : <DifferentialPrivacyMapping />}
			</Card>

			{/* 表格樣式覆寫 */}
			<style>{`.ant-table-thead > tr > th { background: ${isDarkModeActive ? '#262626' : '#f0f2f5'} !important; }`}</style>
		</div>
	);
}