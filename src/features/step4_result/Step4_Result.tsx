/**
 * ============================================================================
 * 檔案名稱 (File): Step4_Result.tsx
 * 模組功能 (Description): 去識別化工作流第四步：結果展示、風險審計與憑證簽發組件 (整合真實後端 API 串接、全參數 Hash 監聽與 QI 泛化動態設定)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則
 * ============================================================================
 */

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { 
    Card, Row, Col, Table, Tag, Alert, Button, 
    Modal, Segmented, Space, Progress, Spin, Steps, theme, App as AntdApp
} from 'antd';
import {
    CheckCircleOutlined, CheckCircleFilled, DownloadOutlined,
    FileDoneOutlined, EyeOutlined, SafetyCertificateOutlined,
    ReloadOutlined, LoadingOutlined, LineChartOutlined, CloudUploadOutlined,
    WarningFilled, CloseCircleFilled
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import Papa from 'papaparse';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../store/useAuthStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { useAuditStore } from '../../store/useAuditStore';

// 引入 API 服務
import { runKAnonymity, runDifferentialPrivacy, runRiskKAnonymity, runRiskDp, runRiskCap, runReport, type KAnonymityQualityReport, type DpQualityReport, type AttackReport, type CapReport } from '../../api/apiService';

const SIMULATION_COMPLETION_DELAY_MS = 600;
const PDF_COMPILATION_DELAY_MS = 400;

interface Html2Pdf 
{
    set: (options: Record<string, unknown>) => Html2Pdf;
    from: (element: HTMLElement | null) => Html2Pdf;
    save: () => Promise<void>;
}

interface WindowWithHtml2Pdf extends Window 
{
    html2pdf: () => Html2Pdf;
}

interface SimulationResult 
{
    singling: { ori: number; ctrl: number; base: number; risk: number };
    linkability: { ori: number; ctrl: number; base: number; risk: number };
    inference: { ori: number; ctrl: number; base: number; risk: number };
    overallRiskPercent: string;
}

interface DpStoreField {
    enabled?: boolean;
    fieldName: string;
    fieldType?: string;
    epsilon?: number | string;
    delta?: number | string;
    upperBound?: number | string;
    lowerBound?: number | string;
}

type PipelinePhase = 'uploading' | 'processing' | 'auditing' | 'completed';

/**
 * 函數名稱: evaluateComplianceValidity
 * 函數功能: 依據後端回傳之品質／預算報告，判斷本次去識別化處理是否真正達到合規標準，
 *           而非不論結果一律顯示「已通過」。K-匿名化採後端回傳之 is_valid (涵蓋抑制率與 k/l/t 檢測)；
 *           差分隱私因預算報告本身無 pass/fail 欄位，改以消耗之 ε 是否超出使用者設定之預算上限判斷。
 *
 * 輸入參數 (Input):
 *   - privacyModeTypeStr (string | null | undefined): 當前隱私保護模式
 *   - reportData (KAnonymityQualityReport | DpQualityReport | null): 後端回傳之報告物件
 *   - budgetLimitEpsilonValue (number): 使用者設定之累積隱私預算門檻上限
 * 返回值 (Return): boolean，true 表示達到合規標準
 */
const evaluateComplianceValidity = (
    privacyModeTypeStr: string | null | undefined,
    reportData: KAnonymityQualityReport | DpQualityReport | null,
    budgetLimitEpsilonValue: number
): boolean => {
    if (!reportData) return true;

    if (privacyModeTypeStr === 'k-anonymity') {
        return (reportData as KAnonymityQualityReport).is_valid;
    }

    if (privacyModeTypeStr === 'differential-privacy') {
        return (reportData as DpQualityReport).consumed_epsilon <= budgetLimitEpsilonValue;
    }

    return true;
};

export default function Step4_Result(): React.ReactElement
{
    const { token } = theme.useToken();
    const isDarkModeActiveStatus = token.colorBgContainer !== '#ffffff';
    const { t: translate } = useTranslation();
    const { message: messageApi } = AntdApp.useApp();

    const currentUserSession = useAuthStore((state) => state.user);
    const addAuditLogAction = useAuditStore((state) => state.addAuditLog);

    const dataFile = useWorkspaceStore((state: unknown) => (state as { dataFile: File | null }).dataFile);
    const datasetColumnsListArray = useWorkspaceStore((state) => state.columns);
    const previewDataRowsListArray = useWorkspaceStore((state) => state.previewData);

    const currentPrivacyModeTypeStr = useWorkspaceStore((state) => state.privacyMode);
    const currentKValueNumber = useWorkspaceStore((state) => state.kValue);
    const currentMaxSuppressionNumber = useWorkspaceStore((state) => state.maxSuppression);
    const currentSuppressionMethodStr = useWorkspaceStore((state) => state.suppressionMethod);
    const currentLimitExceededActionStr = useWorkspaceStore((state) => state.limitExceededAction);
    const budgetLimitEpsilonValue = useWorkspaceStore((state) => state.budgetLimitEpsilon);

    const currentDpFieldsListArray = useWorkspaceStore((state) => state.dpFields);
    const columnPrivacyRolesMapDict = useWorkspaceStore((state) => state.columnRoles);
    
    const rawColumnTypesMapDict = useWorkspaceStore((state) => state.columnTypes);
    const currentColumnTypesMapDict = useMemo(() => rawColumnTypesMapDict || {}, [rawColumnTypesMapDict]);

    const currentPreprocessingRulesMapDict = useWorkspaceStore((state) => state.preprocessingRules);
    const currentDatasetFileNameString = useWorkspaceStore((state) => state.fileName);
    const simulatedQueryCountValue = useWorkspaceStore((state) => state.queryCount);

    const step4AnalysisCacheData = useWorkspaceStore((state) => state.step4Cache);
    const lastRunParametersHashString = useWorkspaceStore((state) => state.lastRunParamsHash);
    const setStep4CacheAction = useWorkspaceStore((state) => state.setStep4Cache);

    const rawKAnonymityFields = useWorkspaceStore((state: unknown) => (state as { kAnonymityFields?: Record<string, unknown>[] }).kAnonymityFields);
    const kAnonymityFieldsList = useMemo(() => rawKAnonymityFields || [], [rawKAnonymityFields]);

    const rawKAnonymityHierarchies = useWorkspaceStore((state: unknown) => (state as { kAnonymityHierarchies?: Record<string, unknown>[] }).kAnonymityHierarchies);
    const kAnonymityHierarchiesList = useMemo(() => rawKAnonymityHierarchies || [], [rawKAnonymityHierarchies]);

    const currentParametersHashString = useMemo(
        () => JSON.stringify({
            privacyMode: currentPrivacyModeTypeStr, 
            kValue: currentKValueNumber, 
            maxSuppression: currentMaxSuppressionNumber,
            suppressionMethod: currentSuppressionMethodStr,
            limitExceededAction: currentLimitExceededActionStr,
            queryCount: simulatedQueryCountValue, 
            dpFields: currentDpFieldsListArray, 
            columnRoles: columnPrivacyRolesMapDict, 
            columnTypes: currentColumnTypesMapDict,
            preprocessingRules: currentPreprocessingRulesMapDict,
            kAnonymityFields: kAnonymityFieldsList,
            kAnonymityHierarchies: kAnonymityHierarchiesList
        }), 
        [
            currentPrivacyModeTypeStr, currentKValueNumber, currentMaxSuppressionNumber,
            currentSuppressionMethodStr, currentLimitExceededActionStr, simulatedQueryCountValue, 
            currentDpFieldsListArray, columnPrivacyRolesMapDict, currentColumnTypesMapDict, currentPreprocessingRulesMapDict,
            kAnonymityFieldsList, kAnonymityHierarchiesList
        ]
    );

    const isAnalysisCacheValidStatus = useMemo(
        () => step4AnalysisCacheData !== null && lastRunParametersHashString === currentParametersHashString, 
        [step4AnalysisCacheData, lastRunParametersHashString, currentParametersHashString]
    );
    
    const [apiReport, setApiReport] = useState<KAnonymityQualityReport | DpQualityReport | null>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData?.apiReport ? (step4AnalysisCacheData.apiReport as KAnonymityQualityReport | DpQualityReport) : null
    );

    // 後端管線本次執行是否真正失敗（例如 422 抑制率超限），用來避免
    // 在執行失敗時仍顯示「運算完成」的成功／警告橫幅
    const [pipelineFailedMessage, setPipelineFailedMessage] = useState<string | null>(null);

    const [processedCsvBlob, setProcessedCsvBlob] = useState<Blob | null>(
        isAnalysisCacheValidStatus && step4AnalysisCacheData 
            ? ((step4AnalysisCacheData as unknown as Record<string, unknown>).processedCsvBlob as Blob | null) || null 
            : null
    );

    // 風險評估（三攻擊 + CAP + PDF 報告）真實 API 回傳結果
    const [attackReportData, setAttackReportData] = useState<AttackReport | null>(null);
    const [capReportData, setCapReportData] = useState<CapReport | null>(null);
    const [riskReportPdfBlob, setRiskReportPdfBlob] = useState<Blob | null>(null);

    const [realMaskedDataRows, setRealMaskedDataRows] = useState<Record<string, unknown>[]>([]);
    
    const [previewViewMode, setPreviewViewMode] = useState<'masked' | 'original'>('masked');
    const [isReportModalVisibleStatus, setIsReportModalVisibleStatus] = useState<boolean>(false);
    const [isExportingPdfStatus, setIsExportingPdfStatus] = useState<boolean>(false);
    
    const pdfReportContainerRef = useRef<HTMLDivElement>(null);
    const simulationLogsEndRef = useRef<HTMLDivElement>(null); 
    
    const [isPipelineCalculatingStatus, setIsPipelineCalculatingStatus] = useState<boolean>(!isAnalysisCacheValidStatus);
    const [currentPipelinePhaseType, setCurrentPipelinePhaseType] = useState<PipelinePhase>(isAnalysisCacheValidStatus ? 'completed' : 'uploading');
    const [calculationProgressValue, setCalculationProgressValue] = useState<number>(isAnalysisCacheValidStatus ? 100 : 0);
    const [systemSimulationLogsList, setSystemSimulationLogsList] = useState<string[]>([]);
    const [attackSimulationMetricsData, setAttackSimulationMetricsData] = useState<SimulationResult | null>(isAnalysisCacheValidStatus ? step4AnalysisCacheData!.metrics : null);
    const [auditMetadataObject, setAuditMetadataObject] = useState(
        () => ({
            certificateId: isAnalysisCacheValidStatus ? step4AnalysisCacheData!.certificateId : `PAC-${Date.now()}`,
            auditTime: isAnalysisCacheValidStatus ? step4AnalysisCacheData!.auditTime : new Date().toLocaleString()
        })
    );

    const actualProcessedColumnsList = useMemo(
        () => {
            if (datasetColumnsListArray && datasetColumnsListArray.length > 0) {
                return datasetColumnsListArray.map(col => col.replace(/^[\uFEFF\u200B]+/, '').trim());
            }
            if (kAnonymityFieldsList && kAnonymityFieldsList.length > 0) {
                return kAnonymityFieldsList.map((fieldItem: unknown) => (fieldItem as { name: string }).name).filter(Boolean).map(col => col.replace(/^[\uFEFF\u200B]+/, '').trim());
            }
            return [];
        }, 
        [datasetColumnsListArray, kAnonymityFieldsList]
    );

    const sampleRawDataRowsList = useMemo(
        () => previewDataRowsListArray && previewDataRowsListArray.length > 0 
            ? previewDataRowsListArray.slice(0, 10) 
            : [], 
        [previewDataRowsListArray]
    );

    useEffect(() => {
        let isMounted = true;

        if (processedCsvBlob) {
            processedCsvBlob.text().then(csvText => {
                Papa.parse(csvText, {
                    header: true,
                    skipEmptyLines: true,
                    preview: 10,
                    complete: (results) => {
                        if (isMounted) {
                            setRealMaskedDataRows(results.data as Record<string, unknown>[]);
                        }
                    },
                    error: (error: Error) => {
                        console.error('Error parsing processed CSV blob:', error);
                    }
                });
            }).catch(err => console.error('Error reading blob text:', err));
        }

        return () => {
            isMounted = false;
        };
    }, [processedCsvBlob]);

    const getCalculatedRole = useCallback(
        (targetColumnNameString: string) =>
        {
            const cleanColName = targetColumnNameString.replace(/^[\uFEFF\u200B]+/, '').trim();
            const lowerCaseColumnNameString = cleanColName.toLowerCase();

            // \u2605 \u512A\u5148\u6BD4\u5C0D kAnonymityFieldsList \u2014 \u6B64\u6E05\u55AE\u8207 runFullPipeline \u5BE6\u969B\u7D44\u88DD\u9001\u5F80\u5F8C\u7AEF config \u4E4B
            //   columnsMap \u70BA\u540C\u4E00\u8CC7\u6599\u4F86\u6E90\uFF0C\u907F\u514D\u8207 columnRoles (\u53EF\u80FD\u672A\u540C\u6B65\u66F4\u65B0) \u4E0D\u4E00\u81F4\uFF0C\u5C0E\u81F4\u8AA4\u5224\u70BA\u672A\u53BB\u8B58\u5225
            const matchedKAnonymityFieldItem = kAnonymityFieldsList.find((fieldItem: unknown) => {
                const fieldRecord = fieldItem as Record<string, unknown>;
                return fieldRecord && typeof fieldRecord.name === 'string' && fieldRecord.name.replace(/^[\uFEFF\u200B]+/, '').trim() === cleanColName;
            }) as Record<string, unknown> | undefined;

            const rawConfiguredRoleNameString = (
                (matchedKAnonymityFieldItem?.role as string) || columnPrivacyRolesMapDict[cleanColName] || ''
            ).toLowerCase();
            const targetDpFieldConfigItem = currentDpFieldsListArray?.find(fieldItemRecord => fieldItemRecord.fieldName === cleanColName);
            const matchedIdentifierMaskStrategyString = (matchedKAnonymityFieldItem?.maskStrategy as string) || '';

            if (rawConfiguredRoleNameString.includes('identifier') && !rawConfiguredRoleNameString.includes('quasi'))
                return { role: 'Identifier', tagColor: 'magenta', maskStrategy: matchedIdentifierMaskStrategyString };

            if (rawConfiguredRoleNameString.includes('quasi') || rawConfiguredRoleNameString === 'qi')
                return { role: 'Quasi-identifier', tagColor: 'orange', maskStrategy: matchedIdentifierMaskStrategyString };

            if (rawConfiguredRoleNameString.includes('sensitive'))
                return { role: 'Sensitive', tagColor: 'purple', maskStrategy: matchedIdentifierMaskStrategyString };

            const isExplicitIdentifierMatched = /(^|_)(id|card_id|sn|person_sn|nric|phone|email|name|ssn)($|_)/i.test(lowerCaseColumnNameString);

            if (isExplicitIdentifierMatched)
                return { role: 'Identifier', tagColor: 'magenta', maskStrategy: matchedIdentifierMaskStrategyString };

            if (currentPrivacyModeTypeStr === 'differential-privacy')
            {
                if (targetDpFieldConfigItem && targetDpFieldConfigItem.enabled)
                    return { role: 'DP Sensitive', tagColor: 'purple', maskStrategy: matchedIdentifierMaskStrategyString };
                return { role: 'Retained', tagColor: 'blue', maskStrategy: matchedIdentifierMaskStrategyString };
            }

            if (/(station|time|date|zip|age|gender|card_type|年齡|地區|職業|性別|地址|生日)/i.test(lowerCaseColumnNameString))
                return { role: 'Quasi-identifier', tagColor: 'orange', maskStrategy: matchedIdentifierMaskStrategyString };

            return { role: 'Non-sensitive', tagColor: 'blue', maskStrategy: matchedIdentifierMaskStrategyString };
        },
        [columnPrivacyRolesMapDict, currentDpFieldsListArray, currentPrivacyModeTypeStr, kAnonymityFieldsList]
    );

    // 實際去識別欄位數：K-匿名化計入 Identifier／Quasi-identifier，差分隱私計入已套用加噪 (DP Sensitive) 之欄位
    const deidentifiedColumnsCountValue = useMemo(
        () => actualProcessedColumnsList.filter((columnNameString) => {
            const { role: calculatedRoleNameString } = getCalculatedRole(columnNameString);
            if (currentPrivacyModeTypeStr === 'differential-privacy') {
                return calculatedRoleNameString === 'DP Sensitive';
            }
            return calculatedRoleNameString === 'Identifier' || calculatedRoleNameString === 'Quasi-identifier';
        }).length,
        [actualProcessedColumnsList, getCalculatedRole, currentPrivacyModeTypeStr]
    );

    const runFullPipeline = useCallback(
        async (isForceRunTriggered: boolean = false) => 
        {
            if (!isForceRunTriggered && isAnalysisCacheValidStatus) return;

            if (!dataFile) {
                messageApi.error(translate('step4.msg.no_file', '找不到原始資料集，請先回到 Step 1 上傳檔案！'));
                return;
            }

            setIsPipelineCalculatingStatus(true);
            setCalculationProgressValue(0);
            setCurrentPipelinePhaseType('uploading');
            setApiReport(null);
            setProcessedCsvBlob(null);
            setRealMaskedDataRows([]); 
            setPipelineFailedMessage(null);
            
            const currentExecutionDateTimeObj = new Date();
            const generatedNewAuditMetadataObj = {
                certificateId: `PAC-${currentExecutionDateTimeObj.getTime()}`,
                auditTime: currentExecutionDateTimeObj.toLocaleString(),
                auditTimestamp: currentExecutionDateTimeObj.getTime()
            };
            setAuditMetadataObject(generatedNewAuditMetadataObj);
            const formatCurrentTimeForLogString = () => new Date().toLocaleTimeString();

            setSystemSimulationLogsList([
                translate('step4.log.connect', '[{{time}}] 建立與後端 API 伺服器之連線...', { time: formatCurrentTimeForLogString() }),
                translate('step4.log.bind', '[{{time}}] 準備動態組裝設定檔與參數', { time: formatCurrentTimeForLogString() })
            ]);

            try {
                await new Promise(resolve => setTimeout(resolve, 800));
                setCalculationProgressValue(30);
                setCurrentPipelinePhaseType('processing');
                setSystemSimulationLogsList(prev => [...prev, translate('step4.log.generate_config', '[{{time}}] ⚙️ 產生 JSON 設定檔 (Config) 並請求 Docker 後端...', { time: formatCurrentTimeForLogString() })]);

                let configObject: Record<string, unknown> = {};
                let finalApiReportData: KAnonymityQualityReport | DpQualityReport | null = null; 
                let finalCsvBlobData: Blob | null = null; 

                if (currentPrivacyModeTypeStr === 'k-anonymity') {
                    const columnsMap: Record<string, { role: string; type: string; strategy?: string; }> = {};
                    const qiGeneralizationLevelsMap: Record<string, number> = {};
                    // 後端要求每欄位的類別階層以 { mapping: { 原始值: [原始值, 上一層, ...] } } 包裝
                    // （不是原始 row 陣列），格式依據 app/core/config.py 的 parse_categorical_mapping()
                    const generalizationMatricesMap: Record<string, { mapping: Record<string, string[]> }> = {};
                    const generalizationHierarchiesMap: Record<string, unknown> = {};

                    actualProcessedColumnsList.forEach((colName) => {
                        const cleanName = colName.replace(/^[\uFEFF\u200B]+/, '').trim();
                        
                        const matchedField = kAnonymityFieldsList.find(
                            (item: unknown) => {
                                const record = item as Record<string, unknown>;
                                return record && typeof record.name === 'string' && record.name.replace(/^[\uFEFF\u200B]+/, '').trim() === cleanName;
                            }
                        ) as Record<string, unknown> | undefined;

                        let backendRole = 'non_sensitive';
                        let colType = 'string';
                        let maskStrategy = undefined;

                        if (matchedField) {
                            const privacyRoleMappingDict: Record<string, string> = { 
                                'Identifier': 'identifier', 
                                'Quasi-identifier': 'quasi_identifier', 
                                'Sensitive': 'sensitive', 
                                'Non-sensitive': 'non_sensitive' 
                            };
                            backendRole = privacyRoleMappingDict[String(matchedField.role)] || 'non_sensitive';
                            colType = String(matchedField.type) || 'string';
                            
                            if (backendRole === 'identifier' && matchedField.maskStrategy && matchedField.maskStrategy !== 'none') {
                                maskStrategy = String(matchedField.maskStrategy);
                                // ★ 強制將 drop 轉換為 remove，防止舊快取污染
                                if (maskStrategy === 'drop') {
                                    maskStrategy = 'remove';
                                }
                            }
                            
                            if (backendRole === 'quasi_identifier') {
                                qiGeneralizationLevelsMap[cleanName] = typeof matchedField.genMaxLevel === 'number' ? Math.floor(matchedField.genMaxLevel) : 0;
                                
                                if (colType === 'numeric' && matchedField.genStrategy === 'binning') {
                                    generalizationHierarchiesMap[cleanName] = {
                                        bins: [
                                            { min: null, max: 30, label: "30歲以下" },
                                            { min: 30, max: 45, label: "30-44歲" },
                                            { min: 45, max: 65, label: "45-64歲" },
                                            { min: 65, max: null, label: "65歲以上" }
                                        ]
                                    };
                                }
                            }
                        } else {
                            const { role: uiRole } = getCalculatedRole(cleanName);
                            if (uiRole === 'Identifier') backendRole = 'identifier';
                            if (uiRole === 'Quasi-identifier') backendRole = 'quasi_identifier';
                            if (uiRole === 'Sensitive') backendRole = 'sensitive';
                        }

                        columnsMap[cleanName] = { 
                            role: backendRole, 
                            type: colType,
                            ...(maskStrategy ? { strategy: String(maskStrategy) } : {})
                        };
                    });

                    kAnonymityHierarchiesList.forEach((h: unknown) => {
                        const hierarchyRecord = h as Record<string, unknown>;
                        const fieldName = hierarchyRecord.fieldName as string;
                        const mappings = hierarchyRecord.mappings as unknown[][];

                        if (fieldName && Array.isArray(mappings) && mappings.length > 0) {
                            const validMappings = mappings.filter((row: unknown) => {
                                const rowArray = row as string[];
                                return Array.isArray(rowArray) && rowArray.length > 0 && rowArray[0] && typeof rowArray[0] === 'string' && rowArray[0].trim() !== '';
                            }) as string[][];

                            // 每個 row 是 [原始值, 上一層, 更上層, ...]（row[0] 即原始值本身），
                            // 轉成後端要的 { 原始值: 去除空白尾格後的階梯陣列 }，再包一層 mapping
                            const mappingObj: Record<string, string[]> = {};
                            validMappings.forEach((row) => {
                                const cleanedRow = row
                                    .map((cell) => (cell ?? '').trim())
                                    .filter((cell) => cell !== '');
                                if (cleanedRow.length > 0) {
                                    mappingObj[cleanedRow[0]] = cleanedRow;
                                }
                            });

                            if (Object.keys(mappingObj).length > 0) {
                                generalizationMatricesMap[fieldName] = { mapping: mappingObj };
                            }
                        }
                    });

                    // v1.2.0 後端要求「大包」格式：所有參數（含 k／suppression_limit_percent／
                    // limit_exceeded_action／suppression_method）都要寫在 k_anonymity 區塊內、
                    // enabled 設為 true；後端本身不接受另開表單欄位傳這些參數（會被忽略，
                    // 之前 422 的原因就是設定檔沒有 k_anonymity 這個外層區塊）。
                    // 格式依據：docs/manual_test/config_k_anonymity.json
                    configObject = {
                        k_anonymity: {
                            enabled: true,
                            k: currentKValueNumber,
                            suppression_limit_percent: currentMaxSuppressionNumber ?? 5,
                            limit_exceeded_action: (currentLimitExceededActionStr || 'stop_and_error') as 'stop_and_error' | 'allow_with_warning',
                            suppression_method: (currentSuppressionMethodStr === 'cell' ? 'cell_suppression' : 'row_suppression') as 'row_suppression' | 'cell_suppression',
                            columns: columnsMap,
                            ...(Object.keys(generalizationHierarchiesMap).length > 0 && { generalization_hierarchies: generalizationHierarchiesMap }),
                            ...(Object.keys(generalizationMatricesMap).length > 0 && { generalization_matrices: generalizationMatricesMap }),
                            ...(Object.keys(qiGeneralizationLevelsMap).length > 0 && { qi_generalization_levels: qiGeneralizationLevelsMap })
                        }
                    };
                } 
                else if (currentPrivacyModeTypeStr === 'differential-privacy') {
                    const columnBudgetsMap: Record<string, unknown> = {};
                    
                    currentDpFieldsListArray?.forEach((field: DpStoreField) => {
                        if (field.enabled) {
                            const isNumeric = field.fieldType === 'Numeric';
                            const originalColType = String(currentColumnTypesMapDict?.[field.fieldName] || '').toLowerCase();
                            const isDateTimeType = 
                                originalColType.includes('時間') || 
                                originalColType.includes('date') || 
                                originalColType.includes('time') || 
                                /(date|time|生日|日期)/i.test(field.fieldName);

                            let mappedBackendType = 'text';
                            if (isNumeric) {
                                mappedBackendType = isDateTimeType ? 'datetime' : 'continuous';
                            } else if (field.fieldType === 'Categorical') {
                                mappedBackendType = 'categorical';
                            }

                            // 欄位名稱為 v1.2.0 格式：epsilon_budget／delta_budget（非 v1.0.1 的 epsilon／delta）
                            const baseBudgetConfig: Record<string, unknown> = {
                                type: mappedBackendType,
                                epsilon_budget: Number(field.epsilon || 1.0),
                            };

                            if (isNumeric) {
                                baseBudgetConfig.delta_budget = Number(field.delta || 0.0);
                                if (field.upperBound !== undefined && field.lowerBound !== undefined) {
                                    baseBudgetConfig.sensitivity = Number(field.upperBound) - Number(field.lowerBound);
                                }
                            }

                            columnBudgetsMap[field.fieldName] = baseBudgetConfig;
                        }
                    });
                    
                    // v1.2.0 後端要求「大包」格式：column_budgets／accumulated_epsilon／
                    // accumulated_delta 都要寫在 differential_privacy 區塊內、enabled 設為 true。
                    // 格式依據：docs/manual_test/config_dp.json
                    configObject = {
                        differential_privacy: {
                            enabled: true,
                            column_budgets: columnBudgetsMap,
                            accumulated_epsilon: 0,
                            accumulated_delta: 0
                        }
                    };
                }

                console.log(`🔥 傳給後端 (${currentPrivacyModeTypeStr}) 的 JSON Config:`, configObject);

                const jsonString = JSON.stringify(configObject);
                const configBlob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
                const configFile = new File([configBlob], 'config.json', { type: 'application/json' });

                const originalFile = dataFile as File;
                const rawCsvText = await originalFile.text();
                const cleanedCsvText = rawCsvText.replace(/^[\uFEFF\u200B]+/, '');

                const safeDataFile = new File(
                    [cleanedCsvText], 
                    'input_dataset.csv', 
                    { type: 'text/csv;charset=utf-8' }
                );

                if (currentPrivacyModeTypeStr === 'k-anonymity') {
                    const apiOptions = {
                        k: currentKValueNumber,
                        suppression_limit_percent: currentMaxSuppressionNumber ?? 5,
                        suppression_method: (currentSuppressionMethodStr === 'cell' ? 'cell_suppression' : 'row_suppression') as 'row_suppression' | 'cell_suppression',
                        limit_exceeded_action: (currentLimitExceededActionStr || 'stop_and_error') as 'stop_and_error' | 'allow_with_warning'
                    };
					
					// 👇 加這行！讓它印在 Console 裡！
					console.log(`🚀 傳給後端 (k-anonymity) 的 Step 3 參數:`, apiOptions);

                    const response = await runKAnonymity(safeDataFile, configFile, apiOptions);
                    
                    if (!response.success) throw (response.error || new Error('API 請求未成功'));
                    
                    const finalReport = response.report || {
                        is_valid: true, k_passed: true, l_passed: true, t_passed: true, suppression_rate_percent: 0, suppression_unit: 'row' as const, message: '成功完成去識別化處理', recommendations: [], applied_defaults: []
                    };
                    setApiReport(finalReport);
                    finalApiReportData = finalReport; 
                    
                    const rawResponse = response as unknown as Record<string, unknown>;
                    if (rawResponse.blob) finalCsvBlobData = rawResponse.blob as Blob;
                    else if (rawResponse.data) finalCsvBlobData = new Blob([rawResponse.data as BlobPart], { type: 'text/csv;charset=utf-8;' });
                    else if (rawResponse.csv) finalCsvBlobData = new Blob([rawResponse.csv as BlobPart], { type: 'text/csv;charset=utf-8;' });
                    
                    setProcessedCsvBlob(finalCsvBlobData);

                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ✅ K-Anonymity API 處理成功！`]);
                } 
                else if (currentPrivacyModeTypeStr === 'differential-privacy') {
                    // ★ 規範對照: 依 Open-PETs API 3-1 節，逐欄 epsilon／delta 一律於 config 設定檔 (column_budgets) 指定，
                    //   表單參數僅用於跨批次累計 (accumulated_epsilon／accumulated_delta)。本工具目前無跨次執行之
                    //   持久化累計狀態，故以 0 作為每次獨立執行之基準值。
                    const totalEpsilonBudget = currentDpFieldsListArray?.reduce((acc: number, field: DpStoreField) => acc + (field.enabled ? Number(field.epsilon || 1.0) : 0), 0) || 1.0;

                    const dpApiOptions = {
                        accumulated_epsilon: 0,
                        accumulated_delta: 0
                    };

                    const response = await runDifferentialPrivacy(safeDataFile, configFile, dpApiOptions);

                    if (!response.success) throw (response.error || new Error('DP API 請求未成功'));

                    const defaultReport = {
                        consumed_epsilon: totalEpsilonBudget,
                        consumed_delta: 0,
                        accumulated_epsilon: totalEpsilonBudget,
                        accumulated_delta: 0,
                        message: '成功完成差分隱私處理',
                        per_column: []
                    };

                    const finalReport = response.report || defaultReport;

                    setApiReport(finalReport);
                    finalApiReportData = finalReport;

                    const rawResponse = response as unknown as Record<string, unknown>;
                    if (rawResponse.blob) finalCsvBlobData = rawResponse.blob as Blob;
                    else if (rawResponse.data) finalCsvBlobData = new Blob([rawResponse.data as BlobPart], { type: 'text/csv;charset=utf-8;' });
                    else if (rawResponse.csv) finalCsvBlobData = new Blob([rawResponse.csv as BlobPart], { type: 'text/csv;charset=utf-8;' });

                    setProcessedCsvBlob(finalCsvBlobData);

                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ✅ DP API 處理成功！噪聲已注入。`]);
                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] 📊 消耗隱私預算 (Epsilon): ${finalReport.consumed_epsilon}`]);
                }

                setCalculationProgressValue(65);
                setCurrentPipelinePhaseType('auditing');
                setSystemSimulationLogsList(prev => [...prev, translate('step4.log.start_risk', '[{{time}}] 🚀 脫敏完成，啟動真實風險評估（三大攻擊模擬）', { time: formatCurrentTimeForLogString() })]);

                // 風險評估官方範例參數（docs/manual_test/config_risk_*.json 及 report_request.json 的
                // risk_params 預設值），目前畫面未開放調整，一律採用官方預設
                const RISK_ATTACK_DEFAULT_PARAMS = {
                    n_iter: 50,
                    ctrl_ratio: 0.2,
                    seed: 42,
                    n_subset: 500,
                    n_repeats: 1,
                    overlap_ratio: 0.0
                };

                let attackReportResult: AttackReport | null = null;
                let capReportResult: CapReport | null = null;
                let finalRiskColumnsMap: Record<string, { role: 'quasi_identifier' | 'sensitive'; type: string }> = {};

                if (currentPrivacyModeTypeStr === 'k-anonymity') {
                    // K-匿名模式：欄位角色（identifier／quasi_identifier／sensitive／non_sensitive）
                    // 已在 Step2「屬性分類」寫入 columnRoles／kAnonymityFields，可直接採用單一組角色，
                    // 並要求「敏感欄位」剛好 1 個（後端 RiskConfig.validate_config() 的硬性限制）。
                    const riskColumnsMap: Record<string, { role: 'quasi_identifier' | 'sensitive'; type: string }> = {};
                    actualProcessedColumnsList.forEach((colName) => {
                        const cleanName = colName.replace(/^[\uFEFF\u200B]+/, '').trim();
                        const matchedField = kAnonymityFieldsList.find(
                            (item: unknown) => {
                                const record = item as Record<string, unknown>;
                                return record && typeof record.name === 'string' && record.name.replace(/^[\uFEFF\u200B]+/, '').trim() === cleanName;
                            }
                        ) as Record<string, unknown> | undefined;

                        let backendRole = 'non_sensitive';
                        let colType = 'string';

                        if (matchedField) {
                            const privacyRoleMappingDict: Record<string, string> = {
                                'Identifier': 'identifier',
                                'Quasi-identifier': 'quasi_identifier',
                                'Sensitive': 'sensitive',
                                'Non-sensitive': 'non_sensitive'
                            };
                            backendRole = privacyRoleMappingDict[String(matchedField.role)] || 'non_sensitive';
                            colType = String(matchedField.type) || 'string';
                        } else {
                            const { role: uiRole } = getCalculatedRole(cleanName);
                            if (uiRole === 'Identifier') backendRole = 'identifier';
                            if (uiRole === 'Quasi-identifier') backendRole = 'quasi_identifier';
                            if (uiRole === 'Sensitive') backendRole = 'sensitive';
                        }

                        if (backendRole === 'quasi_identifier' || backendRole === 'sensitive') {
                            riskColumnsMap[cleanName] = { role: backendRole as 'quasi_identifier' | 'sensitive', type: colType };
                        }
                    });

                    const sensitiveColumnCount = Object.values(riskColumnsMap).filter((c) => c.role === 'sensitive').length;
                    if (sensitiveColumnCount !== 1) {
                        throw new Error(`風險評估要求「敏感欄位」剛好 1 個，目前偵測到 ${sensitiveColumnCount} 個，請回到欄位設定調整角色標記後再重新運算。`);
                    }

                    finalRiskColumnsMap = riskColumnsMap;

                    const riskConfigObject = {
                        version: 'step4_risk_k_anonymity',
                        dataset: currentDatasetFileNameString || 'dataset',
                        risk_attacks: { enabled: true, columns: riskColumnsMap, ...RISK_ATTACK_DEFAULT_PARAMS },
                        k_anonymity: (configObject as Record<string, unknown>).k_anonymity
                    };
                    const riskConfigBlob = new Blob([JSON.stringify(riskConfigObject)], { type: 'application/json;charset=utf-8' });
                    const riskConfigFile = new File([riskConfigBlob], 'risk_config.json', { type: 'application/json' });

                    const riskResponse = await runRiskKAnonymity(safeDataFile, riskConfigFile);
                    if (!riskResponse.success || !riskResponse.report) throw (riskResponse.error || new Error('三攻擊風險評估（K-匿名）API 請求未成功'));
                    attackReportResult = riskResponse.report;
                } else if (currentPrivacyModeTypeStr === 'differential-privacy') {
                    // DP 模式沒有「剛好 1 個敏感欄位」的概念——欄位設定清單裡每個啟用欄位都同等
                    // 重要，不分型態。為了滿足後端 RiskConfig 仍要求「恰好 1 個 sensitive」的硬性
                    // 限制，改用「輪流」策略：每個啟用欄位輪流當一次 sensitive、其餘啟用欄位當
                    // quasi_identifier，各自呼叫一次風險評估 API，最終只取風險最高的一輪呈現。
                    const dpRoundRobinCandidateFieldNamesList = (currentDpFieldsListArray || [])
                        .filter((field: DpStoreField) => field.enabled)
                        .map((field: DpStoreField) => field.fieldName);

                    if (dpRoundRobinCandidateFieldNamesList.length === 0) {
                        throw new Error('風險評估要求至少 1 個已啟用的差分隱私欄位，請回到欄位設定啟用欄位後再重新運算。');
                    }

                    const resolveDpRiskColumnType = (fieldName: string): string => {
                        const targetField = (currentDpFieldsListArray || []).find((field: DpStoreField) => field.fieldName === fieldName);
                        const isNumeric = targetField?.fieldType === 'Numeric';
                        const originalColType = String(currentColumnTypesMapDict?.[fieldName] || '').toLowerCase();
                        const isDateTimeType =
                            originalColType.includes('時間') ||
                            originalColType.includes('date') ||
                            originalColType.includes('time') ||
                            /(date|time|生日|日期)/i.test(fieldName);
                        if (isNumeric) return isDateTimeType ? 'temporal' : 'numeric';
                        if (targetField?.fieldType === 'Categorical') return 'categorical';
                        return 'string';
                    };

                    let bestOverallScore = -1;
                    let bestAttackReport: AttackReport | null = null;
                    let bestColumnsMap: Record<string, { role: 'quasi_identifier' | 'sensitive'; type: string }> | null = null;

                    for (let roundIndex = 0; roundIndex < dpRoundRobinCandidateFieldNamesList.length; roundIndex++) {
                        const candidateSensitiveFieldName = dpRoundRobinCandidateFieldNamesList[roundIndex];
                        const roundColumnsMap: Record<string, { role: 'quasi_identifier' | 'sensitive'; type: string }> = {};
                        dpRoundRobinCandidateFieldNamesList.forEach((fieldName: string) => {
                            roundColumnsMap[fieldName] = {
                                role: fieldName === candidateSensitiveFieldName ? 'sensitive' : 'quasi_identifier',
                                type: resolveDpRiskColumnType(fieldName)
                            };
                        });

                        setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] 🔁 候選敏感欄位 ${roundIndex + 1}/${dpRoundRobinCandidateFieldNamesList.length}（${candidateSensitiveFieldName}）風險評估中...`]);

                        try {
                            const riskConfigObject = {
                                version: 'step4_risk_dp',
                                dataset: currentDatasetFileNameString || 'dataset',
                                risk_attacks: { enabled: true, columns: roundColumnsMap, ...RISK_ATTACK_DEFAULT_PARAMS },
                                differential_privacy: (configObject as Record<string, unknown>).differential_privacy
                            };
                            const riskConfigBlob = new Blob([JSON.stringify(riskConfigObject)], { type: 'application/json;charset=utf-8' });
                            const riskConfigFile = new File([riskConfigBlob], 'risk_config.json', { type: 'application/json' });

                            const riskResponse = await runRiskDp(safeDataFile, riskConfigFile);
                            if (!riskResponse.success || !riskResponse.report) throw (riskResponse.error || new Error(`候選欄位「${candidateSensitiveFieldName}」風險評估 API 請求未成功`));

                            const roundReport = riskResponse.report;
                            const roundOverallScore = Math.max(roundReport.singling_out_risk, roundReport.linkability_risk, roundReport.inference_risk);
                            if (roundOverallScore > bestOverallScore) {
                                bestOverallScore = roundOverallScore;
                                bestAttackReport = roundReport;
                                bestColumnsMap = roundColumnsMap;
                            }
                        } catch (roundErrorPayload) {
                            console.error(`候選欄位「${candidateSensitiveFieldName}」風險評估失敗:`, roundErrorPayload);
                            setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⚠️ 候選欄位「${candidateSensitiveFieldName}」風險評估失敗，已略過此輪`]);
                        }
                    }

                    if (!bestAttackReport || !bestColumnsMap) {
                        throw new Error('所有候選敏感欄位的風險評估皆失敗，請檢查欄位設定或稍後再重新運算。');
                    }

                    attackReportResult = bestAttackReport;
                    finalRiskColumnsMap = bestColumnsMap;
                }

                setAttackReportData(attackReportResult);
                if (attackReportResult) {
                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ✅ 三攻擊風險評估完成（指認性 ${(attackReportResult!.singling_out_risk * 100).toFixed(1)}%／連結性 ${(attackReportResult!.linkability_risk * 100).toFixed(1)}%／推斷性 ${(attackReportResult!.inference_risk * 100).toFixed(1)}%）`]);
                }

                if (finalCsvBlobData) {
                    try {
                        const processedFileForCap = new File([finalCsvBlobData], 'processed_dataset.csv', { type: 'text/csv;charset=utf-8' });
                        const capConfigObject = {
                            version: 'step4_risk_cap',
                            dataset: currentDatasetFileNameString || 'dataset',
                            risk_cap: { enabled: true, columns: finalRiskColumnsMap }
                        };
                        const capConfigBlob = new Blob([JSON.stringify(capConfigObject)], { type: 'application/json;charset=utf-8' });
                        const capConfigFile = new File([capConfigBlob], 'cap_config.json', { type: 'application/json' });

                        const capResponse = await runRiskCap(safeDataFile, processedFileForCap, capConfigFile);
                        if (!capResponse.success || !capResponse.report) throw (capResponse.error || new Error('CAP 前後對比 API 請求未成功'));
                        capReportResult = capResponse.report;
                        setCapReportData(capReportResult);
                        setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ✅ CAP 前後對比完成（處理前 ${(capReportResult!.cap_before * 100).toFixed(1)}% → 處理後 ${(capReportResult!.cap_after * 100).toFixed(1)}%）`]);
                    } catch (capErrorPayload) {
                        console.error('CAP 前後對比失敗:', capErrorPayload);
                        setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⚠️ CAP 前後對比失敗，已略過（不影響風險評估結果）`]);
                    }
                } else {
                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⚠️ 未取得脫敏後資料集，略過 CAP 前後對比`]);
                }

                try {
                    const reportResponse = await runReport({
                        task_id: auditMetadataObject.certificateId,
                        attack_report: attackReportResult,
                        cap_report: capReportResult
                    });
                    if (!reportResponse.success || !reportResponse.data) throw (reportResponse.error || new Error('風險報告 PDF 產出 API 請求未成功'));
                    setRiskReportPdfBlob(reportResponse.data);
                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ✅ 風險報告 PDF 已產生，可於下方下載`]);
                } catch (reportErrorPayload) {
                    console.error('風險報告 PDF 產出失敗:', reportErrorPayload);
                    setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ⚠️ 風險報告 PDF 產出失敗，已略過（不影響風險評估結果）`]);
                }

                setCalculationProgressValue(100);
                setCurrentPipelinePhaseType('completed');

                const finalSinglingRiskValue = attackReportResult?.singling_out_risk ?? 0;
                const finalLinkabilityRiskValue = attackReportResult?.linkability_risk ?? 0;
                const finalInferenceRiskValue = attackReportResult?.inference_risk ?? 0;
                const calculatedOverallMaxRiskScoreValue = Math.max(finalSinglingRiskValue, finalLinkabilityRiskValue, finalInferenceRiskValue);

                const generatedSimulationMetricsObject: SimulationResult = {
                    singling: { ori: finalSinglingRiskValue, ctrl: 0, base: 0, risk: finalSinglingRiskValue },
                    linkability: { ori: finalLinkabilityRiskValue, ctrl: 0, base: 0, risk: finalLinkabilityRiskValue },
                    inference: { ori: finalInferenceRiskValue, ctrl: 0, base: 0, risk: finalInferenceRiskValue },
                    overallRiskPercent: (calculatedOverallMaxRiskScoreValue * 100).toFixed(1)
                };

                setAttackSimulationMetricsData(generatedSimulationMetricsObject);

                // ★ 依後端實際回傳之報告判斷是否真正達到合規標準，而非不論結果一律標示為「已通過」
                const pipelineComplianceValidStatus = evaluateComplianceValidity(currentPrivacyModeTypeStr, finalApiReportData, budgetLimitEpsilonValue);

                setStep4CacheAction(
                    {
                        metrics: generatedSimulationMetricsObject,
                        certificateId: generatedNewAuditMetadataObj.certificateId,
                        auditTime: generatedNewAuditMetadataObj.auditTime,
                        apiReport: finalApiReportData,
                        processedCsvBlob: finalCsvBlobData
                    } as unknown as NonNullable<typeof step4AnalysisCacheData>, 
                    currentParametersHashString
                );

                const columnRoleSnapshotDict = actualProcessedColumnsList.reduce((accumulatorDict, columnNameString) => {
                    accumulatorDict[columnNameString] = getCalculatedRole(columnNameString).role;
                    return accumulatorDict;
                }, {} as Record<string, string>);

                const identifierMaskStrategySnapshotDict = actualProcessedColumnsList.reduce((accumulatorDict, columnNameString) => {
                    const { maskStrategy: resolvedMaskStrategyString } = getCalculatedRole(columnNameString);
                    if (resolvedMaskStrategyString) accumulatorDict[columnNameString] = resolvedMaskStrategyString;
                    return accumulatorDict;
                }, {} as Record<string, string>);

                const dpEnabledFieldNamesSnapshotList = (currentDpFieldsListArray || [])
                    .filter((field: DpStoreField) => field.enabled)
                    .map((field: DpStoreField) => field.fieldName);

                addAuditLogAction({
                    certificateId: generatedNewAuditMetadataObj.certificateId,
                    fileName: currentDatasetFileNameString || 'dataset.csv',
                    privacyMode: currentPrivacyModeTypeStr || 'k-anonymity',
                    operator: currentUserSession?.name || 'Admin.Test',
                    operatorRole: currentUserSession?.role || 'admin',
                    auditTime: generatedNewAuditMetadataObj.auditTime,
                    auditTimestamp: generatedNewAuditMetadataObj.auditTimestamp,
                    parameters: currentPrivacyModeTypeStr === 'k-anonymity' ? `K = ${currentKValueNumber}` : `發布次數 M = ${simulatedQueryCountValue}`,
                    singlingRisk: `${(finalSinglingRiskValue * 100).toFixed(1)}%`,
                    linkabilityRisk: `${(finalLinkabilityRiskValue * 100).toFixed(1)}%`,
                    inferenceRisk: `${(finalInferenceRiskValue * 100).toFixed(1)}%`,
                    overallRisk: `${generatedSimulationMetricsObject.overallRiskPercent}%`,
                    status: pipelineComplianceValidStatus ? 'passed' : 'failed',
                    columnsSnapshot: actualProcessedColumnsList,
                    columnRoleSnapshot: columnRoleSnapshotDict,
                    identifierMaskStrategySnapshot: identifierMaskStrategySnapshotDict,
                    dpEnabledFieldNamesSnapshot: dpEnabledFieldNamesSnapshotList
                });

                setSystemSimulationLogsList(prev => [...prev, translate('step4.log.finished', '[{{time}}] 🎉 後端管線運算完畢，合規憑證生成完成！', { time: formatCurrentTimeForLogString() })]);

            } catch (error: unknown) {
                let errorMessage = error instanceof Error ? error.message : '請確認 Docker 服務是否正常啟動';
                
                const anyError = error as Record<string, unknown>;
                const responseObj = anyError.response as Record<string, unknown> | undefined;
                const responseData = responseObj?.data as Record<string, unknown> | undefined;
                
                if (responseData?.detail) {
                    const detail = responseData.detail;
                    if (Array.isArray(detail)) {
                        errorMessage = '參數驗證失敗: ' + detail.map((err: Record<string, unknown>) => {
                            const loc = Array.isArray(err.loc) ? err.loc.join('.') : '';
                            return `[${loc}] ${err.msg}`;
                        }).join(' | ');
                    } else if (typeof detail === 'string') {
                        errorMessage = `API 錯誤: ${detail}`;
                    }
                } else if (responseData?.message) {
                    errorMessage = String(responseData.message);
                }

                console.error("Pipeline 執行失敗:", error, responseData);
                setSystemSimulationLogsList(prev => [...prev, `[${formatCurrentTimeForLogString()}] ❌ 處理失敗: ${errorMessage}`]);
                messageApi.error(translate('step4.msg.api_failed', '後端 API 執行失敗，請檢查 Log 訊息'));
                setPipelineFailedMessage(errorMessage);
            } finally {
                setTimeout(() => setIsPipelineCalculatingStatus(false), SIMULATION_COMPLETION_DELAY_MS);
            }

        }, 
        [actualProcessedColumnsList, addAuditLogAction, budgetLimitEpsilonValue, currentDatasetFileNameString, currentKValueNumber, currentLimitExceededActionStr, currentMaxSuppressionNumber, currentParametersHashString, currentPrivacyModeTypeStr, currentSuppressionMethodStr, currentUserSession, dataFile, getCalculatedRole, isAnalysisCacheValidStatus, kAnonymityFieldsList, messageApi, setStep4CacheAction, simulatedQueryCountValue, translate, currentDpFieldsListArray, currentColumnTypesMapDict, kAnonymityHierarchiesList]
    );

    useEffect(() => { if (!isAnalysisCacheValidStatus) { const tId = setTimeout(() => runFullPipeline(false), 0); return () => clearTimeout(tId); } }, [isAnalysisCacheValidStatus, runFullPipeline]);
    useEffect(() => { if (simulationLogsEndRef.current) simulationLogsEndRef.current.scrollIntoView({ behavior: 'smooth' }); }, [systemSimulationLogsList]);

    const kReport = currentPrivacyModeTypeStr === 'k-anonymity' ? (apiReport as KAnonymityQualityReport) : null;
    const dpReport = currentPrivacyModeTypeStr === 'differential-privacy' ? (apiReport as DpQualityReport) : null;
    const isComplianceValidStatus = evaluateComplianceValidity(currentPrivacyModeTypeStr, apiReport, budgetLimitEpsilonValue);

    const getAttackChartOption = () => 
    {
        if (!attackSimulationMetricsData) return {};
        return {
            backgroundColor: 'transparent',
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            legend: {
                data: [translate('step4.chart.s_risk', '攻擊成功率（真實後端評估）')],
                textStyle: { color: token.colorTextSecondary }, top: '0%'
            },
            grid: { top: '18%', left: '3%', right: '4%', bottom: '3%', containLabel: true },
            xAxis: {
                type: 'category',
                data: [translate('step4.chart.singling', '指認性攻擊 (Singling Out)'), translate('step4.chart.linkability', '連結性攻擊 (Linkability)'), translate('step4.chart.inference', '推斷性攻擊 (Inference)')],
                axisLabel: { color: token.colorTextSecondary }
            },
            yAxis: {
                type: 'value', max: 1.0,
                axisLabel: { formatter: (numericAxisValue: number) => `${(numericAxisValue * 100).toFixed(0)}%`, color: token.colorTextDescription },
                splitLine: { lineStyle: { color: token.colorSplit } }
            },
            series: [
                { name: translate('step4.chart.s_risk', '攻擊成功率（真實後端評估）'), type: 'bar', data: [attackSimulationMetricsData.singling.risk, attackSimulationMetricsData.linkability.risk, attackSimulationMetricsData.inference.risk], itemStyle: { color: '#ff4d4f', borderRadius: [4, 4, 0, 0] } }
            ]
        };
    };

    const handleOpenReportModal = () => setIsReportModalVisibleStatus(true);

    const handleDownloadCSV = () => 
    {
        if (processedCsvBlob) 
        {
            const blobDownloadUrlString = URL.createObjectURL(processedCsvBlob);
            const downloadAnchorHtmlElement = document.createElement('a');
            downloadAnchorHtmlElement.href = blobDownloadUrlString;
            downloadAnchorHtmlElement.download = `deidentified_dataset_${Date.now()}.csv`;
            document.body.appendChild(downloadAnchorHtmlElement);
            downloadAnchorHtmlElement.click();
            document.body.removeChild(downloadAnchorHtmlElement);
            URL.revokeObjectURL(blobDownloadUrlString);
            messageApi.success(translate('step4.msg.download_success', '已成功匯出全量脫敏 CSV 數據！'));
        } else {
            messageApi.error(translate('step4.msg.download_failed', '無法取得脫敏檔案，請重新運算。'));
        }
    };

    const handleDownloadRiskReportPdf = () =>
    {
        if (riskReportPdfBlob)
        {
            const blobDownloadUrlString = URL.createObjectURL(riskReportPdfBlob);
            const downloadAnchorHtmlElement = document.createElement('a');
            downloadAnchorHtmlElement.href = blobDownloadUrlString;
            downloadAnchorHtmlElement.download = `risk_report_${auditMetadataObject.certificateId}.pdf`;
            document.body.appendChild(downloadAnchorHtmlElement);
            downloadAnchorHtmlElement.click();
            document.body.removeChild(downloadAnchorHtmlElement);
            URL.revokeObjectURL(blobDownloadUrlString);
            messageApi.success(translate('step4.msg.risk_pdf_download_success', '已成功下載風險評估 PDF 報告！'));
        } else {
            messageApi.error(translate('step4.msg.risk_pdf_download_failed', '無法取得風險評估 PDF 報告，請重新運算。'));
        }
    };

    const handleDownloadPDF = async () => 
    {
        const targetPdfPrintHtmlElement = document.getElementById('printable-audit-report');
        if (!targetPdfPrintHtmlElement) return;
        const hideGlobalLoadingMessageFunction = messageApi.loading(translate('step4.msg.pdf_compiling', '正在編譯高畫質 PDF，請稍候...'), 0);
        setIsExportingPdfStatus(true);
        await new Promise((resolveDelayPromise) => setTimeout(resolveDelayPromise, PDF_COMPILATION_DELAY_MS));

        const html2pdfScriptElement = document.createElement('script');
        html2pdfScriptElement.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
        html2pdfScriptElement.onload = () => 
        {
            const pdfGenerationConfigurationOptions = {
                margin:       [10, 10, 10, 10],
                filename:     `Privacy_Audit_Certificate_${auditMetadataObject.certificateId}.pdf`,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollY: 0, scrollX: 0 },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak:    { mode: ['avoid-all', 'css', 'legacy'], avoid: ['tr', '.pdf-page-break'] }
            };
            (window as unknown as WindowWithHtml2Pdf).html2pdf().set(pdfGenerationConfigurationOptions).from(targetPdfPrintHtmlElement).save().then(
                () => { hideGlobalLoadingMessageFunction(); messageApi.success(translate('step4.msg.pdf_success', '合規審計憑證 PDF 已成功下載！')); }
            ).catch(
                (pdfExecutionErrorPayload: unknown) => { hideGlobalLoadingMessageFunction(); messageApi.error(translate('step4.msg.pdf_failed', 'PDF 下載失敗')); console.error(pdfExecutionErrorPayload); }
            ).finally(() => setIsExportingPdfStatus(false));
        };
        html2pdfScriptElement.onerror = () => { hideGlobalLoadingMessageFunction(); messageApi.error(translate('step4.msg.pdf_no_lib', '無法載入 PDF 轉檔套件，請檢查網路連線。')); setIsExportingPdfStatus(false); };
        document.body.appendChild(html2pdfScriptElement);
    };

    const currentUserRoleTypeNameString = currentUserSession?.role || 'admin';

    return (
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {isPipelineCalculatingStatus ? (
                    <Alert
                        title={<span style={{ fontWeight: 600 }}>{translate('step4.alert.title_running', '正在執行去識別化矩陣演算與風險')}</span>}
                        description={translate('step4.alert.desc_running', '請稍候，系統正在進行運算，完成後將顯示報告。')}
                        type="info"
                        showIcon={false}
                        style={{ flex: 1, marginRight: '24px' }}
                    />
                ) : (
                    <Alert
                        title={
                            <Space>
                                {pipelineFailedMessage
                                    ? <CloseCircleFilled style={{ color: '#ff4d4f' }} />
                                    : isComplianceValidStatus
                                        ? <CheckCircleFilled style={{ color: '#52c41a' }} />
                                        : <WarningFilled style={{ color: '#faad14' }} />}
                                <span style={{ fontWeight: 600 }}>
                                    {pipelineFailedMessage
                                        ? translate('step4.alert.title_error', '後端運算失敗，未產出結果')
                                        : isComplianceValidStatus
                                            ? translate('step4.alert.title', '去識別化矩陣演算與風險審計完成')
                                            : translate('step4.alert.title_failed', '去識別化矩陣演算完成，但未達合規標準')}
                                </span>
                            </Space>
                        }
                        description={pipelineFailedMessage
                            ? pipelineFailedMessage
                            : isComplianceValidStatus
                                ? translate('step4.alert.desc', '系統已完成蒙地卡羅攻擊模擬評估，請檢視三大去識別化防禦指標並下載合規報告。')
                                : translate('step4.alert.desc_failed', '後端報告顯示本次設定未通過品質檢測 (如抑制率超限、k／l／t 檢測未過，或差分隱私消耗預算超出門檻)，請調整參數後重新運算。')}
                        type={pipelineFailedMessage ? 'error' : (isComplianceValidStatus ? 'success' : 'warning')}
                        showIcon={false}
                        style={{ flex: 1, marginRight: '24px' }}
                    />
                )}

                <Space size="middle">
                    <Button icon={<ReloadOutlined spin={isPipelineCalculatingStatus} />} onClick={() => runFullPipeline(true)} disabled={isPipelineCalculatingStatus} size="large">
                        {translate('step4.btn.recalculate', '重新發起後端運算')}
                    </Button>
                    <Button type="default" icon={<FileDoneOutlined />} disabled={isPipelineCalculatingStatus || !!pipelineFailedMessage} onClick={handleOpenReportModal} size="large">
                        {translate('step4.btn.view_report', '檢視與匯出憑證')}
                    </Button>
                    <Button type="primary" icon={<DownloadOutlined />} disabled={isPipelineCalculatingStatus || !!pipelineFailedMessage} onClick={handleDownloadCSV} size="large" style={{ background: '#4F46E5', borderColor: '#4F46E5' }}>
                        {translate('step4.btn.download_csv', '下載脫敏 CSV')}
                    </Button>
                </Space>
            </div>

            {isPipelineCalculatingStatus ? (
                <Card variant="borderless" style={{ background: token.colorBgContainer }}>
                    <div style={{ padding: '32px 16px', background: isDarkModeActiveStatus ? '#141414' : '#f8fafc', borderRadius: '12px' }}>
                        <Row justify="center" style={{ marginBottom: '32px' }}>
                            <Col xs={24} md={20} lg={16}>
                                <Steps
                                    current={currentPipelinePhaseType === 'uploading' ? 0 : currentPipelinePhaseType === 'processing' ? 1 : currentPipelinePhaseType === 'auditing' ? 2 : 3}
                                    items={[
                                        { title: translate('step4.steps.upload.title', '切片上傳'), content: 'Chunk Upload', icon: <CloudUploadOutlined /> },
                                        { title: translate('step4.steps.process.title', '後端脫敏'), content: 'Data Processing', icon: <LoadingOutlined /> },
                                        { title: translate('step4.steps.audit.title', '風險審計'), content: 'Risk Auditing', icon: <SafetyCertificateOutlined /> },
                                        { title: translate('step4.steps.complete.title', '完成簽發'), content: 'Completed', icon: <CheckCircleOutlined /> },
                                    ]}
                                />
                            </Col>
                        </Row>

                        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                            <Spin indicator={<LoadingOutlined style={{ fontSize: 48, color: token.colorPrimary }} spin />} />
                            <h3 style={{ marginTop: '16px', color: token.colorText }}>
                                {currentPipelinePhaseType === 'uploading' && translate('step4.loading.uploading', '正在將大數據切片 (Chunk) 傳輸至後端伺服器...')}
                                {currentPipelinePhaseType === 'processing' && translate('step4.loading.processing', '後端正在執行去識別化矩陣與加噪演算...')}
                                {currentPipelinePhaseType === 'auditing' && translate('step4.loading.auditing', '正在執行蒙地卡羅攻擊模擬與可用性評估...')}
                                {currentPipelinePhaseType === 'completed' && translate('step4.loading.completed', '後端演算完畢，正在生成最終合規報告...')}
                            </h3>
                            <Progress percent={calculationProgressValue} status="active" style={{ maxWidth: '600px', margin: '16px auto' }} strokeColor={token.colorPrimary} />
                        </div>
                        
                        <div style={{ maxWidth: '800px', margin: '0 auto', background: isDarkModeActiveStatus ? '#000000' : '#1e1e1e', color: '#00ff66', fontFamily: 'monospace', padding: '16px', borderRadius: '8px', textAlign: 'left', fontSize: '13px', height: '180px', overflowY: 'auto', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)' }}>
                            {systemSimulationLogsList.map((logItemString, logItemIndexNumber) => <div key={logItemIndexNumber} style={{ marginBottom: '4px' }}>{logItemString}</div>)}
                            <div ref={simulationLogsEndRef} />
                        </div>
                    </div>
                </Card>
            ) : (
                attackSimulationMetricsData && (
                    <Row gutter={24} style={{ display: 'flex', alignItems: 'stretch' }}>
                        <Col span={16} style={{ display: 'flex' }}>
                            <Card 
                                title={<span><SafetyCertificateOutlined style={{ marginRight: 8, color: token.colorPrimary }} />{translate('step4.risk.title', '安全性評估 (Privacy Risks)')}</span>}
                                variant="borderless" style={{ background: token.colorBgContainer, width: '100%', display: 'flex', flexDirection: 'column' }} styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column' } }}
                            >
                                <div style={{ background: isDarkModeActiveStatus ? '#141414' : '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '20px', border: `1px solid ${token.colorBorderSecondary}` }}>
                                    <Row align="middle" justify="space-between">
                                        <Col>
                                            <div style={{ fontSize: '12px', color: token.colorTextDescription, marginBottom: '4px' }}>
                                                {translate('step4.risk.overall_desc', '連續發布 M={{m}} 次之綜合殘餘風險', { m: simulatedQueryCountValue })}
                                            </div>
                                            <span style={{ fontSize: '24px', fontWeight: 'bold', color: parseFloat(attackSimulationMetricsData.overallRiskPercent) < 20 ? '#52c41a' : '#faad14' }}>
                                                {attackSimulationMetricsData.overallRiskPercent}%
                                            </span>
                                        </Col>
                                        <Col>
                                            <Tag color={isComplianceValidStatus ? 'success' : 'error'} style={{ padding: '4px 12px', borderRadius: '4px', margin: 0, fontWeight: 'bold' }}>
                                                {isComplianceValidStatus
                                                    ? <><CheckCircleOutlined style={{ marginRight: 4 }} /> {translate('step4.risk.passed', '防禦驗證透過')}</>
                                                    : <><WarningFilled style={{ marginRight: 4 }} /> {translate('step4.risk.failed', '未達合規標準')}</>}
                                            </Tag>
                                        </Col>
                                    </Row>
                                </div>
                                <ReactECharts option={getAttackChartOption()} style={{ height: '260px', marginBottom: '16px' }} theme={isDarkModeActiveStatus ? 'dark' : 'light'} />
                                <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                                    <Tag color="red" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>{translate('step4.risk.singling', '指認風險:')} {(attackSimulationMetricsData.singling.risk * 100).toFixed(1)}%</Tag>
                                    <Tag color="orange" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>{translate('step4.risk.linkability', '連結風險:')} {(attackSimulationMetricsData.linkability.risk * 100).toFixed(1)}%</Tag>
                                    <Tag color="cyan" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>{translate('step4.risk.inference', '推斷風險:')} {(attackSimulationMetricsData.inference.risk * 100).toFixed(1)}%</Tag>
                                </div>
                                {capReportData && (
                                    <div style={{ marginTop: '12px', fontSize: '12px', color: token.colorTextDescription }}>
                                        {translate('step4.risk.cap_label', 'CAP 前後對比：')} {(capReportData.cap_before * 100).toFixed(1)}% → {(capReportData.cap_after * 100).toFixed(1)}%
                                    </div>
                                )}
                                {attackReportData?.message && (
                                    <div style={{ marginTop: '4px', fontSize: '12px', color: token.colorTextDescription }}>
                                        {attackReportData.message}
                                    </div>
                                )}
                                <div style={{ marginTop: '12px' }}>
                                    <Button size="small" icon={<DownloadOutlined />} disabled={!riskReportPdfBlob} onClick={handleDownloadRiskReportPdf}>
                                        {translate('step4.risk.download_pdf', '下載風險評估 PDF 報告')}
                                    </Button>
                                </div>
                            </Card>
                        </Col>
                        <Col span={8} style={{ display: 'flex' }}>
                            <Card 
                                title={<span><LineChartOutlined style={{ marginRight: 8, color: '#1677ff' }} />{translate('step4.utility.title', '資料效用與失真度評估')}</span>}
                                variant="borderless" style={{ background: token.colorBgContainer, width: '100%', display: 'flex', flexDirection: 'column' }} styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column' } }}
                            >
                                <div style={{ background: isDarkModeActiveStatus ? '#141414' : '#f8fafc', padding: '24px 16px', borderRadius: '8px', border: `1px solid ${token.colorBorderSecondary}`, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', alignItems: 'center' }}>
                                    <div style={{ textAlign: 'center', width: '100%', paddingBottom: '24px', borderBottom: `1px dashed ${token.colorBorderSecondary}` }}>
                                        <div style={{ fontSize: '14px', color: token.colorTextDescription, marginBottom: '16px' }}>
                                            {currentPrivacyModeTypeStr === 'k-anonymity' ? translate('step4.utility.suppression', '資料記錄抑制率') : '總消耗隱私預算 (Epsilon)'}
                                        </div>
                                        <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#1677ff', marginBottom: '16px', fontFamily: 'monospace', lineHeight: 1 }}>
                                            {currentPrivacyModeTypeStr === 'k-anonymity'
                                                ? <>{kReport ? kReport.suppression_rate_percent : 0} <span style={{ fontSize: '20px' }}>%</span></>
                                                : <>{dpReport ? dpReport.consumed_epsilon : 0} <span style={{ fontSize: '20px' }}>ε</span></>
                                            }
                                        </div>
                                        {currentPrivacyModeTypeStr === 'k-anonymity' && (
                                            <div style={{ fontSize: '12px', color: token.colorTextDescription, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ textAlign: 'center', width: '100%', paddingTop: '24px' }}>
                                        <div style={{ fontSize: '14px', color: token.colorTextDescription, marginBottom: '16px' }}>{translate('step4.utility.total_cols', '實際去識別數 / 總欄位數')}</div>
                                        <div style={{ fontSize: '36px', fontWeight: 'bold', color: token.colorText, fontFamily: 'monospace', lineHeight: 1 }}>
                                            {deidentifiedColumnsCountValue} <span style={{ fontSize: '20px', color: token.colorTextSecondary }}>/ {actualProcessedColumnsList.length}</span>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        </Col>
                    </Row>
                )
            )}

            <Card 
                title={
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span><EyeOutlined style={{ marginRight: 8, color: '#13c2c2' }} />{translate('step4.preview.title', '脫敏結果預覽對照 (First 10 Rows)')}</span>
                        <Segmented options={[{ label: currentPrivacyModeTypeStr === 'k-anonymity' ? translate('step4.preview.masked.k_anon', 'K-匿名化後資料') : translate('step4.preview.masked.dp', '差分隱私加噪後資料'), value: 'masked' }, { label: translate('step4.preview.raw', '原始明文數據 (Raw)'), value: 'original' }]} value={previewViewMode} onChange={(selectedViewModeVal) => setPreviewViewMode(selectedViewModeVal as 'masked' | 'original')} />
                    </div>
                }
                variant="borderless" style={{ background: token.colorBgContainer }}
            >
                <Table 
                    dataSource={previewViewMode === 'masked' ? (realMaskedDataRows.length > 0 ? realMaskedDataRows : []) : sampleRawDataRowsList}
                    columns={actualProcessedColumnsList.map((columnNameString) => {
                        const { role: configuredRoleNameString, tagColor: mappedTagColorString } = getCalculatedRole(columnNameString);
                        const localizedRoleI18nKeyString = `step4.role.${configuredRoleNameString.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')}`;
                        return {
                            title: (<div><div>{columnNameString}</div><Tag color={mappedTagColorString} style={{ fontSize: '10px', margin: 0 }}>{translate(localizedRoleI18nKeyString, configuredRoleNameString)}</Tag></div>),
                            dataIndex: columnNameString, key: columnNameString,
                        };
                    })}
                    pagination={{ pageSize: 10 }} size="small" rowKey={(rowRecordItemObject) => JSON.stringify(rowRecordItemObject)} scroll={{ x: 'max-content' }}
                />
            </Card>

            <Modal
                title={translate('step4.modal.title', '合規審計報告 (Privacy Audit Certificate)')}
                open={isReportModalVisibleStatus} onCancel={() => setIsReportModalVisibleStatus(false)} width={800} styles={{ body: { maxHeight: '72vh', overflowY: 'auto', paddingRight: '6px' } }}
                footer={[
                    <Button key="close" onClick={() => setIsReportModalVisibleStatus(false)}>{translate('step4.modal.close', '關閉')}</Button>,
                    <Button key="download" type="primary" icon={<DownloadOutlined />} loading={isExportingPdfStatus} onClick={handleDownloadPDF} style={{ background: '#4F46E5' }}>{translate('step4.modal.export_pdf', '匯出 PDF 憑證')}</Button>
                ]}
            >
                {attackSimulationMetricsData && (
                    <div id="printable-audit-report" ref={pdfReportContainerRef} style={{ padding: isExportingPdfStatus ? '0px' : '24px', color: '#000000', backgroundColor: '#ffffff', borderRadius: '4px', fontFamily: 'sans-serif' }}>
                        <div className="pdf-page-break" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${token.colorPrimary}`, paddingBottom: '12px', marginBottom: '24px', pageBreakInside: 'avoid' }}>
                            <div>
                                <h2 style={{ margin: 0, color: token.colorPrimary, fontSize: '20px' }}>{translate('step4.report.header', '數據隱私合規與技術審計憑證')}</h2>
                                <span style={{ fontSize: '12px', color: '#555555' }}>{translate('step4.report.cert_id', '憑證編號:')} {auditMetadataObject.certificateId}</span>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <span style={{
                                    display: 'inline-block',
                                    backgroundColor: isComplianceValidStatus ? '#f6ffed' : '#fff2e8',
                                    border: isComplianceValidStatus ? '1px solid #b7eb8f' : '1px solid #ffbb96',
                                    color: isComplianceValidStatus ? '#389e0d' : '#d4380d',
                                    padding: '6px 16px', borderRadius: '4px', fontSize: '14px', fontWeight: 'bold', lineHeight: '20px', whiteSpace: 'nowrap'
                                }}>
                                    <span style={{ marginRight: '6px', fontSize: '15px' }}>{isComplianceValidStatus ? '✓' : '⚠'}</span>
                                    {isComplianceValidStatus ? translate('step4.report.passed', '透過合規標準') : translate('step4.report.failed', '未達合規標準')}
                                </span>
                            </div>
                        </div>

                        <div className="pdf-page-break" style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '24px', border: `1px solid #d9d9d9`, pageBreakInside: 'avoid' }}>
                            <h4 style={{ marginTop: 0, color: '#000000', marginBottom: '8px' }}>{translate('step4.report.info_title', '專案與審計權限資訊')}</h4>
                            <Row gutter={[16, 8]} style={{ fontSize: '13px', color: '#555555' }}>
                                <Col span={12}><b style={{ color: '#000000' }}>{translate('step4.report.file_name', '原始檔案名稱：')}</b> {currentDatasetFileNameString || 'dataset.csv'}</Col>
                                <Col span={12}><b style={{ color: '#000000' }}>{translate('step4.report.mode', '保護模式：')}</b> {currentPrivacyModeTypeStr === 'k-anonymity' ? 'K-Anonymity ' : 'Differential Privacy '}</Col>
                                <Col span={12}><b style={{ color: '#000000' }}>{translate('step4.report.auditor', '審計核可人：')}</b> {currentUserSession?.name || 'Admin.Test'} ({currentUserRoleTypeNameString.toUpperCase()})</Col>
                                <Col span={12}><b style={{ color: '#000000' }}>{translate('step4.report.queries', '連續查詢次數：')}</b> {simulatedQueryCountValue} </Col>
                            </Row>
                        </div>

                        <div className="pdf-page-break" style={{ pageBreakInside: 'avoid', marginBottom: '32px', clear: 'both' }}>
                            <Row gutter={16}>
                                <Col span={12}>
                                    <div style={{ background: '#fff1f0', padding: '16px', borderRadius: '8px', border: `1px solid #ffa39e`, height: '100%' }}>
                                        <h4 style={{ marginTop: 0, color: '#cf1322', marginBottom: '8px' }}>{translate('step4.report.risk_title', '隱私安全風險評估')}</h4>
                                        <div style={{ fontSize: '13px', color: '#555555', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><b style={{ color: '#000000' }}>{translate('step4.report.overall_risk', '綜合殘餘風險:')}</b> <span style={{ color: '#cf1322', fontWeight: 'bold' }}>{attackSimulationMetricsData.overallRiskPercent}%</span></div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{translate('step4.report.singling_risk', '指認性風險 (Singling Out):')}</span> <span>{(attackSimulationMetricsData.singling.risk * 100).toFixed(1)}%</span></div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{translate('step4.report.linkability_risk', '連結性風險 (Linkability):')}</span> <span>{(attackSimulationMetricsData.linkability.risk * 100).toFixed(1)}%</span></div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{translate('step4.report.inference_risk', '推斷性風險 (Inference):')}</span> <span>{(attackSimulationMetricsData.inference.risk * 100).toFixed(1)}%</span></div>
                                        </div>
                                    </div>
                                </Col>
                                <Col span={12}>
                                    <div style={{ background: '#e6ffec', padding: '16px', borderRadius: '8px', border: `1px solid #87e8de`, height: '100%' }}>
                                        <h4 style={{ marginTop: 0, color: '#08979c', marginBottom: '8px' }}>{translate('step4.report.utility_title', '資料效用與失真度評估')}</h4>
                                        <div style={{ fontSize: '13px', color: '#555555', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <b style={{ color: '#000000' }}>{currentPrivacyModeTypeStr === 'k-anonymity' ? translate('step4.report.suppression', '資料記錄抑制率:') : translate('step4.report.total_epsilon', '總消耗隱私預算 (Epsilon):')}</b> 
                                                <span style={{ color: '#08979c', fontWeight: 'bold' }}>{currentPrivacyModeTypeStr === 'k-anonymity' ? `${kReport ? kReport.suppression_rate_percent : 0}%` : `${dpReport ? dpReport.consumed_epsilon : 0} ε`}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <b style={{ color: '#000000' }}>{translate('step4.report.total_cols', '實際去識別數 / 總欄位數:')}</b> <span style={{ color: '#08979c', fontWeight: 'bold' }}>{deidentifiedColumnsCountValue} / {actualProcessedColumnsList.length}</span>
                                            </div>
                                        </div>
                                    </div>
                                </Col>
                            </Row>
                        </div>

                        <h4 className="pdf-page-break" style={{ color: '#000000', marginTop: '16px', marginBottom: '12px', pageBreakInside: 'avoid', clear: 'both' }}>{translate('step4.report.table_title', '欄位處置與技術對照表')}</h4>
                        <div style={{ maxHeight: isExportingPdfStatus ? 'none' : '240px', overflowY: isExportingPdfStatus ? 'visible' : 'auto', border: '1px solid #d9d9d9', borderRadius: '4px', marginBottom: '24px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', color: '#000000', backgroundColor: '#ffffff', tableLayout: 'fixed' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#f1f5f9', position: isExportingPdfStatus ? 'static' : 'sticky', top: 0, zIndex: 1, pageBreakInside: 'avoid' }}>
                                        <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '40%' }}>{translate('step4.report.col_name', '欄位名稱')}</th>
                                        <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{translate('step4.report.col_role', '隱私角色')}</th>
                                        <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 10px', color: '#000000', textAlign: 'left', background: '#f1f5f9', width: '30%' }}>{translate('step4.report.col_tech', '套用去識別化技術')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {actualProcessedColumnsList.map((columnNameString) => {
                                        const { role: configuredRoleNameString, maskStrategy: configuredMaskStrategyString } = getCalculatedRole(columnNameString);
                                        const targetDpFieldConfigItemObj = currentDpFieldsListArray?.find(fieldItemRecord => fieldItemRecord.fieldName === columnNameString && fieldItemRecord.enabled);
                                        let resolvedStrategyDescriptionText = translate('step4.report.tech_keep_original', '保留原文');

                                        if (configuredRoleNameString === 'Identifier') {
                                            resolvedStrategyDescriptionText = configuredMaskStrategyString === 'remove'
                                                ? translate('step4.report.tech_removed', '直接移除')
                                                : translate('step4.report.tech_full_masking', '完全遮蔽');
                                        }
                                        else if (configuredRoleNameString === 'Quasi-identifier' && currentPrivacyModeTypeStr === 'k-anonymity') resolvedStrategyDescriptionText = translate('step4.report.tech_generalization', '區間/時間泛化');
                                        else if (currentPrivacyModeTypeStr === 'differential-privacy' && targetDpFieldConfigItemObj) resolvedStrategyDescriptionText = translate('step4.report.tech_dp', '差分隱私加噪');

                                        const localizedRoleI18nKeyString = `step4.role.${configuredRoleNameString.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')}`;

                                        return (
                                            <tr key={columnNameString} style={{ backgroundColor: '#ffffff', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                                                <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#000000', wordBreak: 'break-word' }}><b>{columnNameString}</b></td>
                                                <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{translate(localizedRoleI18nKeyString, configuredRoleNameString)}</td>
                                                <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 10px', color: '#555555', wordBreak: 'break-word' }}>{resolvedStrategyDescriptionText}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div className="pdf-page-break" style={{ textAlign: 'right', marginTop: '24px', borderTop: `1px dashed #d9d9d9`, paddingTop: '12px', fontSize: '12px', color: '#888888', pageBreakInside: 'avoid' }}>
                            {translate('step4.report.signature', '系統數位簽章：PRIVACY-APP-AUDIT-ENGINE-V2.0-PASSED')}
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}