/**
 * ============================================================================
 * 檔案名稱 (File): Step4_Result.tsx
 * 模組功能 (Description): 去識別化工作流第四步：結果展示、風險審計與憑證簽發組件 (整合真實後端 API 串接、全參數 Hash 監聽與 QI 泛化動態設定)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則
 * ============================================================================
 */

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import {
    Card, Row, Col, Table, Tag, Alert, Button,
    Modal, Segmented, Space, Progress, Spin, Steps, theme, App as AntdApp, Tooltip, Select, Checkbox, InputNumber
} from 'antd';
import {
    CheckCircleOutlined, CheckCircleFilled, DownloadOutlined,
    FileDoneOutlined, EyeOutlined, SafetyCertificateOutlined,
    ReloadOutlined, LoadingOutlined, LineChartOutlined, CloudUploadOutlined,
    WarningFilled, CloseCircleFilled, QuestionCircleOutlined
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { RISK_ATTACK_DEFAULT_PARAMS } from '../../utils/riskAssessment';
import type { DpStoreField } from '../../utils/pipelineConfig';
import type { KAnonymityQualityReport, DpQualityReport } from '../../api/apiService';

import { usePipelineRunner } from './usePipelineRunner';
import BackendReportDetails from './BackendReportDetails';
import AuditIntegrityPanel from '../../components/AuditIntegrityPanel';
import { useAuditStore } from '../../store/useAuditStore';

// ★ 2026-10-02：使用者要求暫不顯示「後端處理報告明細」（內容偏技術，一般使用者看了反而更混淆），
//   元件與單元測試保留，日後要恢復顯示把此旗標改回 true 即可。說明見專案文件「修改建議整理」。
const SHOW_BACKEND_REPORT_DETAILS = false;
import { evaluateComplianceValidity } from './pipeline/pipelineResults';
import { BACKEND_ERROR_CODE_CATEGORY_MAP, DEBUG_ERRORS_LOCAL_STORAGE_KEY, buildFriendlyErrorDisplayNode, DEBUG_PANEL_ERROR_CODE_OPTIONS } from './backendErrorCatalog';

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




export default function Step4_Result(): React.ReactElement
{
    const { token } = theme.useToken();
    const isDarkModeActiveStatus = token.colorBgContainer !== '#ffffff';
    const { t: translate } = useTranslation();
    const { message: messageApi } = AntdApp.useApp();


    const datasetColumnsListArray = useWorkspaceStore((state) => state.columns);
    const previewDataRowsListArray = useWorkspaceStore((state) => state.previewData);

    const currentPrivacyModeTypeStr = useWorkspaceStore((state) => state.privacyMode);
    const currentKValueNumber = useWorkspaceStore((state) => state.kValue);
    const currentLValueNumber = useWorkspaceStore((state) => state.lValue);
    const currentTValueNumber = useWorkspaceStore((state) => state.tValue);
    // ★ 使用者反映：純 K-匿名模式不一定需要 l-多樣性／t-緊密度檢測，若未於 Step3 開啟對應開關，
    //   組裝設定檔時不應送出 l／t 欄位——依交付文件之後端行為，設定檔未提供 l/t 即不執行該項檢測。
    const isEnableLDiversityStatus = useWorkspaceStore((state) => state.enableLDiversity);
    const isEnableTClosenessStatus = useWorkspaceStore((state) => state.enableTCloseness);
    const currentMaxSuppressionNumber = useWorkspaceStore((state) => state.maxSuppression);
    const currentSuppressionMethodStr = useWorkspaceStore((state) => state.suppressionMethod);
    // ★ 使用者反映（2026-09-23）：cell_fill（值抑制填法 star／missing）僅在抑制方式為「值抑制」
    //   時才有作用，先前前端從未讀取／送出這個值，後端只能默默套用內建預設 (star)。這裡讀取 Step3
    //   新增的選單狀態，並在下方組裝 K-匿名 apiOptions／configObject 時，僅於「值抑制」模式才送出。
    const currentCellFillMethodStr = useWorkspaceStore((state) => state.cellFillMethod);
    const currentLimitExceededActionStr = useWorkspaceStore((state) => state.limitExceededAction);
    const budgetLimitEpsilonValue = useWorkspaceStore((state) => state.budgetLimitEpsilon);
    const globalTargetDeltaValue = useWorkspaceStore((state) => state.targetDelta);
    // ★ 使用者反映：config_dp.json 之 accumulated_epsilon／accumulated_delta 為「跨批次累計」值，
    //   先前每次執行皆固定送出 0，等同從未真正累計。此處讀取上次執行後留存之累計值作為本次執行前基準，
    //   執行成功後再依本次消耗更新（見下方 dpAccumulatedEpsilon／dpAccumulatedDelta 更新邏輯）。
    const dpAccumulatedEpsilonValue = useWorkspaceStore((state) => state.dpAccumulatedEpsilon);
    const dpAccumulatedDeltaValue = useWorkspaceStore((state) => state.dpAccumulatedDelta);

    const currentDpFieldsListArray = useWorkspaceStore((state) => state.dpFields);
    const columnPrivacyRolesMapDict = useWorkspaceStore((state) => state.columnRoles);
    

    const currentDatasetFileNameString = useWorkspaceStore((state) => state.fileName);


    const rawKAnonymityFields = useWorkspaceStore((state: unknown) => (state as { kAnonymityFields?: Record<string, unknown>[] }).kAnonymityFields);
    const kAnonymityFieldsList = useMemo(() => rawKAnonymityFields || [], [rawKAnonymityFields]);

    const rawKAnonymityHierarchies = useWorkspaceStore((state: unknown) => (state as { kAnonymityHierarchies?: Record<string, unknown>[] }).kAnonymityHierarchies);
    const kAnonymityHierarchiesList = useMemo(() => rawKAnonymityHierarchies || [], [rawKAnonymityHierarchies]);


    
    // 畫面專用 state（錯誤卡片測試面板、預覽檢視切換、報告視窗、PDF 匯出）
    // ★ 新增：錯誤卡片測試面板下拉選單目前選擇的錯誤碼，預設選第一個。
    const [debugSelectedErrorCodeStr, setDebugSelectedErrorCodeStr] = useState<string>(DEBUG_PANEL_ERROR_CODE_OPTIONS[0].code);
    const [previewViewMode, setPreviewViewMode] = useState<'masked' | 'original'>('masked');
    const [isReportModalVisibleStatus, setIsReportModalVisibleStatus] = useState<boolean>(false);
    const [isExportingPdfStatus, setIsExportingPdfStatus] = useState<boolean>(false);

    const pdfReportContainerRef = useRef<HTMLDivElement>(null);
    const simulationLogsEndRef = useRef<HTMLDivElement>(null);


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
            // ★ 修正：與 cleanColName 同樣先去除 BOM／前後空白再比對，避免欄位名稱帶有
            //   UTF-8 BOM（常見於 Excel 匯出之 CSV 第一欄）時，永遠比對不到對應的 DP 欄位設定。
            const stripLeadingBomAndZeroWidthSpace = (rawTextValue: string): string => {
                let resultTextValue = rawTextValue;
                while (resultTextValue.length > 0 && (resultTextValue.charCodeAt(0) === 0xFEFF || resultTextValue.charCodeAt(0) === 0x200B)) {
                    resultTextValue = resultTextValue.slice(1);
                }
                return resultTextValue.trim();
            };
            const targetDpFieldConfigItem = currentDpFieldsListArray?.find(
                fieldItemRecord => stripLeadingBomAndZeroWidthSpace(fieldItemRecord.fieldName) === cleanColName
            );
            const matchedIdentifierMaskStrategyString = (matchedKAnonymityFieldItem?.maskStrategy as string) || '';

            // ★ 使用者反映（2026-09-30）：差分隱私模式的結果預覽標籤一直顯示「敏感欄位／間接識別」，而非
            //   差分隱私的「加噪／保留」。原因是 DP 的 Step2 會把已啟用欄位寫入 columnRoles 為 sensitive
            //   （數值型）／quasi_identifier（類別型），下方依序比對角色時提早回傳，永遠走不到 DP 分支；
            //   合規報告也因此把沒啟用、實際保留原值的姓名等欄位標成「直接識別／完全遮蔽」。差分隱私模式
            //   只依「Step2 是否啟用該欄位」判斷（與實際送給後端加噪的 column_budgets 條件一致）：
            //   啟用 → 加噪；未啟用 → 保留（未處理，輸出檔內為原始值，以金色標籤提醒）。
            if (currentPrivacyModeTypeStr === 'differential-privacy')
            {
                if (targetDpFieldConfigItem && targetDpFieldConfigItem.enabled)
                    return { role: 'DP Sensitive', tagColor: 'purple', maskStrategy: matchedIdentifierMaskStrategyString };
                return { role: 'Retained', tagColor: 'gold', maskStrategy: matchedIdentifierMaskStrategyString };
            }

            if (rawConfiguredRoleNameString.includes('identifier') && !rawConfiguredRoleNameString.includes('quasi'))
                return { role: 'Identifier', tagColor: 'magenta', maskStrategy: matchedIdentifierMaskStrategyString };

            if (rawConfiguredRoleNameString.includes('quasi') || rawConfiguredRoleNameString === 'qi')
                return { role: 'Quasi-identifier', tagColor: 'orange', maskStrategy: matchedIdentifierMaskStrategyString };

            // ★ 修正：「非敏感」(non-sensitive) 字串本身也包含 "sensitive" 子字串，先前用
            //   .includes('sensitive') 判斷會把使用者明明選的是「非敏感」欄位誤判成「敏感」，
            //   導致 K-匿名模式報告顯示錯誤角色標籤；差分隱私模式下更嚴重——只要該欄位名稱
            //   曾在 K-匿名步驟被設定過角色（哪怕是切換模式前的舊資料），就會在這裡被攔截，
            //   永遠不會走到下面差分隱私專屬的判斷邏輯，造成「實際去識別數」在 DP 模式恆為 0。
            //   比照上面 quasi-identifier／identifier 的排除寫法，加上 !includes('non') 即可修正。
            if (rawConfiguredRoleNameString.includes('sensitive') && !rawConfiguredRoleNameString.includes('non'))
                return { role: 'Sensitive', tagColor: 'purple', maskStrategy: matchedIdentifierMaskStrategyString };

            const isExplicitIdentifierMatched = /(^|_)(id|card_id|sn|person_sn|nric|phone|email|name|ssn)($|_)/i.test(lowerCaseColumnNameString);

            if (isExplicitIdentifierMatched)
                return { role: 'Identifier', tagColor: 'magenta', maskStrategy: matchedIdentifierMaskStrategyString };

            if (/(station|time|date|zip|age|gender|card_type|年齡|地區|職業|性別|地址|生日)/i.test(lowerCaseColumnNameString))
                return { role: 'Quasi-identifier', tagColor: 'orange', maskStrategy: matchedIdentifierMaskStrategyString };

            return { role: 'Non-sensitive', tagColor: 'blue', maskStrategy: matchedIdentifierMaskStrategyString };
        },
        [columnPrivacyRolesMapDict, currentDpFieldsListArray, currentPrivacyModeTypeStr, kAnonymityFieldsList]
    );

    // ★ 使用者反映（2026-09-22）：「實際去識別數 / 總欄位數」計算錯誤，例如應為 6 卻顯示 7。
    //   根本原因：先前的計算方式只要欄位「角色」被設為 Identifier／Quasi-identifier 就計入，
    //   但角色只是使用者在 Step2 的「分類」，不代表後端真的會對該欄位套用任何遮蔽／泛化——
    //   例如：
    //     - Identifier 欄位的「遮蔽策略」欄位預設值是 'none'（新增欄位時的預設，見
    //       KAnonymityMapping.tsx addField 之 maskStrategy: 'none'），使用者若忘記另外選一個
    //       實際的遮蔽方式，這欄實際上完全不會被送到後端做任何處理（比對 runFullPipeline 組
    //       config 時的判斷：`matchedField.maskStrategy && matchedField.maskStrategy !== 'none'`
    //       才會寫入 strategy），畫面卻仍把它算進「已去識別」。
    //     - 類別型（categorical）Quasi-identifier 選擇「依分類樹泛化」(genStrategy==='tree')
    //       時，若使用者尚未在 Step2「泛化階層對照」分頁實際填寫該欄位的階層對照表，後端收不到
    //       generalization_matrices 對應項目，同樣不會產生任何泛化效果。
    //   下面 isColumnActuallyDeidentifiedFn 比照 runFullPipeline 實際組 K-匿名化 config 時的
    //   判斷條件（見下方 runFullPipeline 之 columnsMap／generalizationHierarchiesMap／
    //   generalizationMatricesMap 組裝邏輯），只有「真的會被送到後端做遮蔽或泛化」的欄位才計入，
    //   確保這裡顯示的數字與實際送出的設定檔一致。
    const isColumnActuallyDeidentifiedFn = useCallback(
        (columnNameString: string): boolean => {
            const cleanColName = columnNameString.replace(/^[\uFEFF\u200B]+/, '').trim();
            const matchedField = kAnonymityFieldsList.find((fieldItem: unknown) => {
                const fieldRecord = fieldItem as Record<string, unknown>;
                return fieldRecord && typeof fieldRecord.name === 'string' && fieldRecord.name.replace(/^[\uFEFF\u200B]+/, '').trim() === cleanColName;
            }) as Record<string, unknown> | undefined;

            const { role: calculatedRoleNameString } = getCalculatedRole(columnNameString);

            if (calculatedRoleNameString === 'Identifier') {
                // 對齊 runFullPipeline：唯有實際選了非 'none' 的遮蔽策略，後端才會真的處理該欄位。
                const maskStrategyValue = matchedField?.maskStrategy as string | undefined;
                return !!(maskStrategyValue && maskStrategyValue !== 'none');
            }

            if (calculatedRoleNameString === 'Quasi-identifier') {
                if (!matchedField) return false;
                const colType = String(matchedField.type) || 'string';
                const genStrategyValue = matchedField.genStrategy as string | undefined;

                if (colType === 'numeric') {
                    if (genStrategyValue === 'custom_bins') {
                        const rawCustomBinsList = matchedField.customBins as unknown[] | undefined;
                        return Array.isArray(rawCustomBinsList) && rawCustomBinsList.length > 0;
                    }
                    if (genStrategyValue === 'rounding') {
                        const roundingUnitValue = typeof matchedField.genParam === 'number' ? matchedField.genParam : Number(matchedField.genParam);
                        return Number.isFinite(roundingUnitValue) && roundingUnitValue > 0;
                    }
                    return false;
                }

                if (colType === 'temporal') {
                    if (genStrategyValue === 'time_rounding') return true;
                    if (genStrategyValue === 'time_range') {
                        const rawTimeRangeBinsList = matchedField.customBins as unknown[] | undefined;
                        return Array.isArray(rawTimeRangeBinsList) && rawTimeRangeBinsList.length > 0;
                    }
                    return false;
                }

                if (colType === 'string') {
                    return genStrategyValue === 'prefix' || genStrategyValue === 'length';
                }

                if (colType === 'categorical') {
                    if (genStrategyValue !== 'tree') return false;
                    return kAnonymityHierarchiesList.some((h: unknown) => {
                        const hierarchyRecord = h as Record<string, unknown>;
                        const hFieldNameCleaned = (hierarchyRecord.fieldName as string || '').replace(/^[\uFEFF\u200B]+/, '').trim();
                        if (hFieldNameCleaned !== cleanColName) return false;
                        const mappings = hierarchyRecord.mappings as unknown[][];
                        if (!Array.isArray(mappings)) return false;
                        return mappings.some((row: unknown) => {
                            const rowArray = row as string[];
                            return Array.isArray(rowArray) && rowArray.length > 0 && rowArray[0] && typeof rowArray[0] === 'string' && rowArray[0].trim() !== '';
                        });
                    });
                }

                return false;
            }

            return false;
        },
        [kAnonymityFieldsList, kAnonymityHierarchiesList, getCalculatedRole]
    );

    // 實際去識別欄位數：K-匿名化計入「確實會被送到後端套用遮蔽或泛化」之 Identifier／
    // Quasi-identifier 欄位，差分隱私計入已套用加噪 (DP Sensitive) 之欄位。
    const deidentifiedColumnsCountValue = useMemo(
        () => actualProcessedColumnsList.filter((columnNameString) => {
            if (currentPrivacyModeTypeStr === 'differential-privacy') {
                // ★ 使用者反映（2026-09-29）：DP 模式「實際去識別數」恆為 0。先前靠 getCalculatedRole
                //   回傳 'DP Sensitive' 判斷，但 DP 的 Step2 會把已啟用欄位寫入 columnRoles 為
                //   sensitive（數值型）／quasi_identifier（類別型），getCalculatedRole 依序先比對到
                //   Sensitive／Quasi-identifier 就提早回傳，永遠走不到 DP 專屬分支。改為直接以實際送給
                //   後端加噪的依據——DP 欄位清單中「已啟用」的欄位——計數，與 runFullPipeline 組
                //   column_budgets 的條件（field.enabled）一致。
                const cleanColName = columnNameString.replace(/^[\uFEFF\u200B]+/, '').trim();
                return (currentDpFieldsListArray || []).some((field: DpStoreField) =>
                    field.enabled && String(field.fieldName || '').replace(/^[\uFEFF\u200B]+/, '').trim() === cleanColName
                );
            }
            return isColumnActuallyDeidentifiedFn(columnNameString);
        }).length,
        [actualProcessedColumnsList, currentDpFieldsListArray, currentPrivacyModeTypeStr, isColumnActuallyDeidentifiedFn]
    );

    // ★ 使用者需求（2026-10-01）：在「實際去識別數 / 總欄位數」卡片列出未計入的欄位與原因，
    //   讓使用者知道是哪些欄位維持原樣輸出、該回 Step2 調整哪裡。判斷條件與上方
    //   deidentifiedColumnsCountValue 完全一致（同樣以 isColumnActuallyDeidentifiedFn／DP 啟用狀態為準）。
    const nonDeidentifiedColumnsDetailList = useMemo(
        (): { columnName: string; reason: string }[] => actualProcessedColumnsList.flatMap((columnNameString) => {
            if (currentPrivacyModeTypeStr === 'differential-privacy') {
                const cleanColName = columnNameString.replace(/^[\uFEFF\u200B]+/, '').trim();
                const isDpEnabled = (currentDpFieldsListArray || []).some((field: DpStoreField) =>
                    field.enabled && String(field.fieldName || '').replace(/^[\uFEFF\u200B]+/, '').trim() === cleanColName
                );
                return isDpEnabled ? [] : [{ columnName: columnNameString, reason: translate('step4.utility.reason_dp_disabled', '未啟用差分隱私') }];
            }
            if (isColumnActuallyDeidentifiedFn(columnNameString)) return [];
            const { role } = getCalculatedRole(columnNameString);
            let reason: string;
            if (role === 'Identifier') reason = translate('step4.utility.reason_no_mask', '識別符未選擇遮蔽策略（為「不處理」）');
            else if (role === 'Quasi-identifier') reason = translate('step4.utility.reason_qi_incomplete', '準識別符泛化參數未設定完整');
            else if (role === 'Sensitive') reason = translate('step4.utility.reason_sensitive', '敏感欄位，K-匿名不改動其值');
            else reason = translate('step4.utility.reason_non_sensitive', '非敏感欄位，保留原值');
            return [{ columnName: columnNameString, reason }];
        }),
        [actualProcessedColumnsList, currentDpFieldsListArray, currentPrivacyModeTypeStr, isColumnActuallyDeidentifiedFn, getCalculatedRole, translate]
    );

    // 去識別化／風險評估的執行流程與結果 state 見 usePipelineRunner.ts
    const {
        apiReport,
        processedCsvBlob,
        realMaskedDataRows,
        previewParseDiagnosticText,
        attackReportData,
        capReportData,
        datasetRowStatsData,
        attackSimulationMetricsData,
        auditMetadataObject,
        highCardinalitySensitiveWarningInfo,
        forceRunHighCardinalitySensitiveFieldsStatus,
        setForceRunHighCardinalitySensitiveFieldsStatus,
        setSensitiveBinWidthOverridesMap,
        sensitiveBinWidthOverridesMap,
        pipelineFailedMessage,
        setPipelineFailedMessage,
        isPipelineCalculatingStatus,
        currentPipelinePhaseType,
        calculationProgressValue,
        systemSimulationLogsList,
        uploadProgressText,
        isPipelineCanceledStatus,
        runFullPipeline,
        handleCancelPipeline
    } = usePipelineRunner({ actualProcessedColumnsList, getCalculatedRole });
    // ★ 2026-10-02：本次憑證的防篡改指紋與數位簽章（簽發時寫入稽核紀錄，見 usePipelineRunner）
    const currentAuditLogEntry = useAuditStore((state) => state.auditLogs.find((logItem) => logItem.certificateId === auditMetadataObject.certificateId));

    // ★ 修正：使用者對照瀏覽器開發者工具的實際後端回應後發現，「脫敏結果預覽對照」在
    //   「K-匿名化後資料／差分隱私加噪後資料」檢視下，表格欄位（姓名、身分證號、生日等
    //   Identifier 角色欄位）與後端實際回傳的 CSV 完全對不上——後端對 Identifier 欄位是直接
    //   「整欄移除」而非留空，但先前這裡的欄位清單一律用 actualProcessedColumnsList（即
    //   Step1 上傳時的「原始資料集全部欄位」），導致畫面上多顯示出 3 個後端根本沒回傳、
    //   徹頭徹尾是空白的假欄位，容易誤以為是資料遺失或程式出錯。正確做法：「遮罩後」檢視應
    //   改以實際解析到的 realMaskedDataRows（即後端回傳的 processedCsvBlob 解析結果）之
    //   欄位鍵值為準，畫面上有幾欄就是後端真的回傳幾欄；「原始明文資料」檢視則維持顯示
    //   Step1 上傳時的全部原始欄位（該檢視本來就應完整呈現原始資料，兩者用途不同、不可
    //   混用同一份欄位清單）。
    const maskedPreviewColumnNamesList = useMemo(
        () => realMaskedDataRows.length > 0 ? Object.keys(realMaskedDataRows[0]) : actualProcessedColumnsList,
        [realMaskedDataRows, actualProcessedColumnsList]
    );

    // ★ 2026-10-02 修正：預覽表格原本以 rowKey = JSON.stringify(整列) 當 key，K-匿名／泛化後常有多列內容
    //   完全相同（例如同一等價類），產生重複 key；React 依 key 比對時會把舊列殘留在畫面上，
    //   「去識別化後 ↔ 原始明文」來回切換後列數越疊越多、兩種檢視的列混在一起。
    //   改為依「檢視模式 + 列序」產生唯一 key（另以 Table key 強制切換時重新掛載）。
    //   __previewRowKey 不在 columns 內，不會顯示成欄位。
    const PREVIEW_ROW_KEY_FIELD = '__previewRowKey';
    const previewTableDataRowsList = useMemo(
        () => (previewViewMode === 'masked' ? realMaskedDataRows : sampleRawDataRowsList)
            .map((rowRecordItem, rowIndexNumber) => ({ ...rowRecordItem, [PREVIEW_ROW_KEY_FIELD]: `${previewViewMode}-${rowIndexNumber}` })),
        [previewViewMode, realMaskedDataRows, sampleRawDataRowsList]
    );



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
                { name: translate('step4.chart.s_risk', '攻擊成功率'), type: 'bar', data: [attackSimulationMetricsData.singling.risk, attackSimulationMetricsData.linkability.risk, attackSimulationMetricsData.inference.risk], itemStyle: { color: '#ff4d4f', borderRadius: [4, 4, 0, 0] } }
            ]
        };
    };

    // ★ 使用者反映（2026-09-23）：合規審計報告改版後新增「隱私強化處理配置」段落，其中三攻擊／CAP
    //   的固定參數（迭代次數／控制組比例／亂數種子／連結性子集大小／重複實驗輪數／跨輪重疊比例）
    //   目前畫面尚未開放使用者調整，一律採用官方範例預設值——與 runFullPipeline 內部
    //   RISK_ATTACK_DEFAULT_PARAMS（實際送給後端 /api/v1/risk/* 的值）完全相同。那個常數宣告在
    //   runFullPipeline 這個 useCallback 內部，屬於該函式的區域變數，這裡的報告 Modal 讀不到，
    //   故另外宣告這份「僅供顯示」的複本；未來若調整 runFullPipeline 內的預設值，記得這裡也要
    //   同步更新，否則報告顯示的參數會跟實際送給後端的不一致。
    const RISK_ATTACK_REPORT_DISPLAY_PARAMS = RISK_ATTACK_DEFAULT_PARAMS;

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

    // ★ 新增：錯誤卡片測試面板只在網址加上 ?debugErrors=1 (重新整理過一次) 時才會出現，
    //   一般使用者不會看到、也不會誤觸；用來檢查 26 個後端錯誤碼各自的前端卡片顯示是否
    //   正確、好懂，不必真的想辦法讓後端在那些不容易操作觸發的情境下失敗。
    //   ★ 修正：判斷依據改成 localStorage (由 App.tsx 在頁面載入當下寫入)，而不是直接看
    //   目前網址參數——因為切換到第四步的過程中，App.tsx 的路由邏輯一定會把網址參數改寫成
    //   只剩 ?step=4，若還是看網址參數，使用者根本不可能帶著 debugErrors=1 走到這一頁。
    let isErrorDebugPanelVisibleStatus = false;
    try {
        isErrorDebugPanelVisibleStatus = window.localStorage.getItem(DEBUG_ERRORS_LOCAL_STORAGE_KEY) === '1';
    } catch (localStorageReadErrorPayload) {
        console.warn('讀取除錯旗標失敗，錯誤卡片測試面板維持隱藏:', localStorageReadErrorPayload);
    }

    const handleDisableDebugPanelClick = (): void => {
        try {
            window.localStorage.removeItem(DEBUG_ERRORS_LOCAL_STORAGE_KEY);
        } catch (localStorageRemoveErrorPayload) {
            console.warn('清除除錯旗標失敗:', localStorageRemoveErrorPayload);
        }
        setPipelineFailedMessage(null);
        window.location.reload();
    };

    const handleShowDebugErrorCardClick = (): void => {
        const selectedOption = DEBUG_PANEL_ERROR_CODE_OPTIONS.find((optionItem) => optionItem.code === debugSelectedErrorCodeStr);
        if (!selectedOption) return;
        const displayStatus = BACKEND_ERROR_CODE_CATEGORY_MAP[selectedOption.code]?.status;
        setPipelineFailedMessage(buildFriendlyErrorDisplayNode({
            responseErrorCode: selectedOption.code,
            responseHttpStatus: displayStatus,
            backendRawMessageText: selectedOption.sampleMessage,
            responseRecommendationsList: selectedOption.sampleRecommendations ?? []
        }));
    };

    return (
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {isErrorDebugPanelVisibleStatus && (
                <div
                    style={{
                        position: 'fixed', bottom: 16, right: 16, zIndex: 1000, width: 340,
                        background: '#fff', border: '1px solid #d9d9d9', borderRadius: 8,
                        padding: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                    }}
                >
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>
                        🧪 錯誤卡片測試面板（僅供內部測試）
                    </div>
                    <Select
                        value={debugSelectedErrorCodeStr}
                        onChange={setDebugSelectedErrorCodeStr}
                        style={{ width: '100%', marginBottom: 8 }}
                        showSearch
                        options={DEBUG_PANEL_ERROR_CODE_OPTIONS.map((optionItem) => ({ value: optionItem.code, label: optionItem.code }))}
                    />
                    <Space wrap>
                        <Button size="small" type="primary" onClick={handleShowDebugErrorCardClick}>顯示這個錯誤卡片</Button>
                        <Button size="small" onClick={() => setPipelineFailedMessage(null)}>清除（恢復正常畫面）</Button>
                        <Button size="small" danger onClick={handleDisableDebugPanelClick}>關閉測試模式</Button>
                    </Space>
                </div>
            )}
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
                                        ? (isPipelineCanceledStatus
                                            ? translate('step4.alert.title_canceled', '已取消運算，未產出結果')
                                            : translate('step4.alert.title_error', '後端運算失敗，未產出結果'))
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
                                : (
                                    <div>
                                        {/* ★ 使用者反映：先前把後端 message／recommendations 原文整段列出，
                                            對非技術背景的使用者來說文字量過大、看不出重點。改為只保留一行
                                            「哪裡沒過」＋一行「怎麼改」的極簡提示，不顯示後端原始長篇文字。 */}
                                        {currentPrivacyModeTypeStr === 'k-anonymity' && kReport && (() => {
                                            const isSuppressionExceededStatus = kReport.suppression_rate_percent > (currentMaxSuppressionNumber ?? 5);
                                            // ★ 未啟用 l-多樣性／t-緊密度檢測時，即使報告內 l_passed／t_passed 剛好是
                                            // false（例如後端對「未檢測」的預設值不是 true），畫面上也不歸咎於 l／t，
                                            // 避免使用者誤以為自己沒關掉的 l/t 造成失敗。
                                            const failedCheckNamesList = [
                                                kReport.k_passed === false ? 'k' : null,
                                                (isEnableLDiversityStatus && kReport.l_passed === false) ? 'l-多樣性' : null,
                                                (isEnableTClosenessStatus && kReport.t_passed === false) ? 't-緊密度' : null,
                                                isSuppressionExceededStatus ? '抑制率' : null
                                            ].filter((item): item is string => item !== null);
                                            const failedCheckSummaryText = failedCheckNamesList.length > 0
                                                ? failedCheckNamesList.join('、')
                                                : translate('step4.alert.failed_detail_suppression', '抑制率');

                                            // ★ 使用者反映：改為依失敗項目挑選後端建議文字後，內容仍偏技術（等價類／
                                            // l-diversity／t-closeness／QI 等專有名詞＋長句），沒有相關背景的使用者
                                            // 仍難以判斷「具體該調整哪個數字」。改為：針對每個實際未通過的項目，各自
                                            // 產生一句帶入目前實際設定值與違規數量的白話說明，加上條列式、方向正確的
                                            // 具體調整選項（例如 l 值該調低到多少、t 值該調高到多少），技術名詞僅以
                                            // 「?」提示註解、不影響略讀即可操作。
                                            // ★ 方向性務必區分：l-diversity 的 l 越大越嚴格，要放寬須「調低」；
                                            // t-closeness 的 t 是「容許的分佈距離上限」，t 越小越嚴格，要放寬須
                                            // 「調高」——兩者方向相反，不可用同一句話帶過，否則會誤導使用者。
                                            // 違規分組數量（l_fail_count／t_fail_count）目前僅存在於後端 recommendations
                                            // 的自然語言描述中，未拆成獨立欄位，故以固定格式的正規表示式擷取數字；
                                            // 擷取不到時該部分文字自然省略，不影響其餘白話說明與選項的呈現。
                                            const backendRecommendationTextList = Array.isArray(kReport.recommendations)
                                                ? (kReport.recommendations as unknown[]).filter((item): item is string => typeof item === 'string')
                                                : [];
                                            const parseFirstIntegerMatch = (patternRegex: RegExp): number | null => {
                                                for (const recommendationText of backendRecommendationTextList) {
                                                    const matchResult = recommendationText.match(patternRegex);
                                                    if (matchResult) {
                                                        const parsedNumberValue = Number(matchResult[1]);
                                                        if (Number.isFinite(parsedNumberValue)) {
                                                            return parsedNumberValue;
                                                        }
                                                    }
                                                }
                                                return null;
                                            };

                                            type FailureGuidanceSectionType = { key: string; headlineNode: ReactNode; optionTextList: string[] };
                                            const failureGuidanceSectionsList: FailureGuidanceSectionType[] = [];

                                            const isLFailedStatus = failedCheckNamesList.includes('l-多樣性');
                                            const isTFailedStatus = failedCheckNamesList.includes('t-緊密度');
                                            if (isLFailedStatus || isTFailedStatus) {
                                                const lFailGroupCount = parseFirstIntegerMatch(/l-diversity 不足的等價類 (\d+) 個/);
                                                const tFailGroupCount = parseFirstIntegerMatch(/t-closeness 超標的等價類 (\d+) 個/);
                                                const failGroupDescriptionPartsList = [
                                                    (isLFailedStatus && lFailGroupCount !== null)
                                                        ? `l-多樣性不足的分組有 ${lFailGroupCount} 組（目前門檻 l = ${currentLValueNumber}）`
                                                        : null,
                                                    (isTFailedStatus && tFailGroupCount !== null)
                                                        ? `t-緊密度超標的分組有 ${tFailGroupCount} 組（目前門檻 t = ${currentTValueNumber}）`
                                                        : null
                                                ].filter((item): item is string => item !== null);

                                                const suggestedLValueNumber = Math.max(1, currentLValueNumber - 1);
                                                const suggestedTValueNumber = Math.min(1, Math.round((currentTValueNumber + 0.05) * 100) / 100);
                                                const ltOptionTextList: string[] = [];
                                                if (isLFailedStatus) {
                                                    ltOptionTextList.push(translate(
                                                        'step4.alert.lt_option_lower_l',
                                                        `回到 Step3，把 l 值從 ${currentLValueNumber} 調低到 ${suggestedLValueNumber}（數字越小，多樣性要求越寬鬆）`
                                                    ));
                                                }
                                                if (isTFailedStatus) {
                                                    ltOptionTextList.push(translate(
                                                        'step4.alert.lt_option_raise_t',
                                                        `回到 Step3，把 t 值從 ${currentTValueNumber} 調高到 ${suggestedTValueNumber}（t 是容許的分佈距離上限，數字越大，門檻越寬鬆）`
                                                    ));
                                                }
                                                ltOptionTextList.push(translate('step4.alert.lt_option_raise_level', '回到 Step2，提高「間接識別碼」欄位的泛化層級，讓分組人數變多，敏感資料種類自然更多樣'));
                                                ltOptionTextList.push(translate('step4.alert.lt_option_suppress_minority', '將資料中極少數的特殊族群或極端值移除／合併後再重新運算'));

                                                failureGuidanceSectionsList.push({
                                                    key: 'lt',
                                                    headlineNode: (
                                                        <>
                                                            {translate('step4.alert.lt_plain_issue_prefix', '系統依照目前的分組結果檢查後發現，')}
                                                            {failGroupDescriptionPartsList.length > 0
                                                                ? failGroupDescriptionPartsList.join('、')
                                                                : translate('step4.alert.lt_plain_issue_fallback', '部分分組的敏感資料多樣性不足')}
                                                            {translate('step4.alert.lt_plain_issue_suffix', '，尚未達到您設定的隱私要求。')}
                                                            <Tooltip title={translate('step4.alert.equivalence_class_tooltip', '「分組」是指依照間接識別碼欄位（如年齡、地區）模糊化後，被歸為同一群、彼此無法被區分的一批資料，專業上稱為「等價類」。')}>
                                                                <QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} />
                                                            </Tooltip>
                                                        </>
                                                    ),
                                                    optionTextList: ltOptionTextList
                                                });
                                            }

                                            if (failedCheckNamesList.includes('k')) {
                                                const suggestedKValueNumber = Math.max(2, currentKValueNumber - 1);
                                                failureGuidanceSectionsList.push({
                                                    key: 'k',
                                                    headlineNode: (
                                                        <>{translate('step4.alert.k_plain_issue', `部分分組的人數不足您設定的 k = ${currentKValueNumber} 人，代表這些分組裡的人仍可能被單獨辨識出來。`)}</>
                                                    ),
                                                    optionTextList: [
                                                        translate('step4.alert.k_option_raise_level', '回到 Step2，提高「間接識別碼」欄位的泛化層級，讓每個分組的人數變多'),
                                                        translate('step4.alert.k_option_lower_k', `回到 Step3，把 k 值從 ${currentKValueNumber} 調低到 ${suggestedKValueNumber}（數字越小，要求越寬鬆）`)
                                                    ]
                                                });
                                            }

                                            if (isSuppressionExceededStatus) {
                                                const currentSuppressionCapNumber = currentMaxSuppressionNumber ?? 5;
                                                const suggestedSuppressionCapNumber = Math.min(100, Math.ceil(kReport.suppression_rate_percent) + 1);
                                                failureGuidanceSectionsList.push({
                                                    key: 'suppression',
                                                    headlineNode: (
                                                        <>{translate('step4.alert.suppression_plain_issue', `目前有 ${kReport.suppression_rate_percent.toFixed(3)}% 的資料筆數太特殊、必須被刪除或打上「*」才符合隱私要求，已超過您設定的上限 ${currentSuppressionCapNumber}%。`)}</>
                                                    ),
                                                    optionTextList: [
                                                        translate('step4.alert.suppression_option_raise_cap', `回到 Step3，把「抑制上限」從 ${currentSuppressionCapNumber}% 調高到 ${suggestedSuppressionCapNumber}% 以上`),
                                                        translate('step4.alert.suppression_option_raise_level', '回到 Step2，提高「間接識別碼」欄位的泛化層級，減少需要被刪除／遮蔽的筆數')
                                                    ]
                                                });
                                            }

                                            return (
                                                <>
                                                    <div>{translate('step4.alert.failed_detail', '未通過項目')}：{failedCheckSummaryText}（{translate('step4.alert.suppression_rate', '抑制率')} {kReport.suppression_rate_percent.toFixed(3)}%）</div>
                                                    {failureGuidanceSectionsList.length > 0
                                                        ? failureGuidanceSectionsList.map((sectionItem) => (
                                                            <div key={sectionItem.key} style={{ marginTop: 8 }}>
                                                                <div>{sectionItem.headlineNode}</div>
                                                                <div style={{ marginTop: 2 }}>{translate('step4.alert.options_label', '可以試試以下任一做法：')}</div>
                                                                <ol style={{ margin: '2px 0 0 20px', padding: 0 }}>
                                                                    {sectionItem.optionTextList.map((optionTextValue, optionIndexValue) => (
                                                                        <li key={optionIndexValue} style={{ marginTop: 2 }}>{optionTextValue}</li>
                                                                    ))}
                                                                </ol>
                                                            </div>
                                                        ))
                                                        : (
                                                            <div style={{ marginTop: 4 }}>{translate('step4.alert.suggest_label', '建議')}：{translate('step4.alert.suggest_k_detail', '提高間接識別碼欄位的泛化層級，或調整抑制上限後重新運算。')}</div>
                                                        )}
                                                </>
                                            );
                                        })()}
                                        {currentPrivacyModeTypeStr === 'differential-privacy' && dpReport && (
                                            <>
                                                <div>{translate('step4.alert.epsilon_detail', '消耗預算')}：{dpReport.consumed_epsilon} ε（{translate('step4.alert.epsilon_limit', '門檻')} {budgetLimitEpsilonValue} ε）</div>
                                                <div style={{ marginTop: 4 }}>{translate('step4.alert.suggest_label', '建議')}：{translate('step4.alert.suggest_dp_detail', '提高預算上限，或減少啟用差分隱私的欄位數後重新運算。')}</div>
                                            </>
                                        )}
                                    </div>
                                )}
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
                            {uploadProgressText && (
                                <div style={{ fontSize: '13px', color: token.colorTextSecondary, marginBottom: '12px' }}>{uploadProgressText}</div>
                            )}
                            <Button danger onClick={handleCancelPipeline}>
                                {translate('step4.btn.cancel_pipeline', '取消運算')}
                            </Button>
                        </div>
                        
                        <div style={{ maxWidth: '800px', margin: '0 auto', background: isDarkModeActiveStatus ? '#000000' : '#1e1e1e', color: '#00ff66', fontFamily: 'monospace', padding: '16px', borderRadius: '8px', textAlign: 'left', fontSize: '13px', height: '180px', overflowY: 'auto', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)' }}>
                            {systemSimulationLogsList.map((logItemString, logItemIndexNumber) => <div key={logItemIndexNumber} style={{ marginBottom: '4px' }}>{logItemString}</div>)}
                            <div ref={simulationLogsEndRef} />
                        </div>
                    </div>
                </Card>
            ) : (
                // ★ 修正：先前「安全性評估／效用評估」Row 與下方「脫敏結果預覽對照」Card 是
                // 兩個各自獨立輸出的區塊——Row 有正確依 isPipelineCalculatingStatus 隱藏，但
                // 預覽 Card 卻沒有一起被包進來，永遠顯示在畫面上。使用者反映：差分隱私處理時
                // 往下滑動頁面，會看到這張已經有欄位、有資料列（或至少有資料表框架）的預覽卡片，
                // 容易誤以為運算已經完成。修正方式：把兩者合併成同一個「統一輸出」區塊。
                // ★ 使用者反映（2026-09-22）：K-匿名「敏感欄位 = 0」時三攻擊整段跳過，
                //   attackSimulationMetricsData 會維持 null（見上方 setAttackSimulationMetricsData
                //   的說明），但這裡先前把整個統一輸出區塊（含去識別化結果預覽、效用評估）都用
                //   attackSimulationMetricsData 是否有值來控制顯示，導致「敏感欄位=0」時連已經
                //   算好的去識別化資料預覽都一起被藏起來，使用者誤以為沒有跑完。改用
                //   datasetRowStatsData 作為「這一輪是否已經成功跑完」的判斷依據——它是在
                //   runFullPipeline 中，不論三攻擊/CAP 是否被跳過，只要整個流程走到最後都會被
                //   設值（見 setDatasetRowStatsData），且發生錯誤時不會被設值，比
                //   attackSimulationMetricsData 更準確地反映「這輪有沒有真的跑完」，而不會被
                //   風險評估本身有沒有執行過影響。下方「安全性評估」卡片內部另外針對
                //   attackSimulationMetricsData 是否存在做了未評估的提示（見下方），不受影響。
                datasetRowStatsData && (
                    <>
                    <Row gutter={24} style={{ display: 'flex', alignItems: 'stretch' }}>
                        <Col span={16} style={{ display: 'flex' }}>
                            <Card 
                                title={<span><SafetyCertificateOutlined style={{ marginRight: 8, color: token.colorPrimary }} />{translate('step4.risk.title', '安全性評估 (Privacy Risks)')}</span>}
                                variant="borderless" style={{ background: token.colorBgContainer, width: '100%', display: 'flex', flexDirection: 'column' }} styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column' } }}
                            >
                                <div style={{ background: isDarkModeActiveStatus ? '#141414' : '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '20px', border: `1px solid ${token.colorBorderSecondary}` }}>
                                    <div style={{ fontSize: '12px', color: token.colorTextDescription, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <span>{translate('step4.risk.cap_label', 'CAP 前後對比')}</span>
                                        {/* ★ 使用者反映：CAP 有數字、下方風險卻是 0% 曾被誤認為顯示異常，原補充說明
                                            寫成一大段太複雜，改為精簡一句：CAP 未扣基準，跟下方風險算法不同。 */}
                                        <Tooltip title={translate('step4.risk.cap_tooltip', '若間接識別碼幾乎每筆都不同（例如連續數值加噪後仍為唯一值），前後可能都接近 100%，這是此指標的先天限制，不代表去識別化沒有效果。（此數字未扣除隨機猜測基準，跟下方風險算法不同，兩者可能不一致）')}>
                                            <QuestionCircleOutlined style={{ color: token.colorTextDescription, cursor: 'help' }} />
                                        </Tooltip>
                                    </div>
                                    {capReportData && !(capReportData.cap_before < 0 || capReportData.cap_after < 0) ? (
                                        <>
                                            <span style={{ fontSize: '24px', fontWeight: 'bold', color: capReportData.cap_after <= capReportData.cap_before ? '#52c41a' : '#faad14' }}>
                                                {(capReportData.cap_before * 100).toFixed(1)}% → {(capReportData.cap_after * 100).toFixed(1)}%
                                            </span>
                                            {capReportData.cap_before > 0 && (
                                                <div style={{ marginTop: '4px', fontSize: '12px', color: token.colorTextDescription }}>
                                                    {translate('step4.risk.cap_diff_label', 'CAP 對比差異（現在/原本）：')} {((capReportData.cap_after / capReportData.cap_before) * 100).toFixed(1)}%
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <span style={{ fontSize: '16px', fontWeight: 'bold', color: token.colorTextDescription }}>
                                                {capReportData?.message?.startsWith('CAP 前後對比請求失敗')
                                                    ? translate('step4.risk.cap_request_failed', '未評估（CAP 請求失敗，原因見下方）')
                                                    : translate('step4.risk.cap_not_evaluated', '未評估（間接識別碼或敏感欄位設定不足，或限定條件篩選後無資料）')}
                                            </span>
                                            {/* ★ 新增：後端 CapReport 本身即附帶 message 欄位說明未評估原因（例如
                                                「限定族群篩選後樣本數為 0」或「敏感欄位設定不符」），過去這裡只顯示
                                                上方寫死的猜測文字、完全沒有把後端真正的原因印出來，使用者（與我們自己）
                                                都無從分辨這次「未評估」到底是欄位角色設定的問題，還是新加的 subgroup
                                                條件把資料篩選到剩 0 筆所致。故在此把後端原始 message 一併顯示。 */}
                                            {capReportData?.message && (
                                                <div style={{ marginTop: '4px', fontSize: '12px', color: token.colorTextDescription }}>
                                                    {translate('step4.risk.cap_backend_message_prefix', '後端回應原因：')}{capReportData.message}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                                <ReactECharts option={getAttackChartOption()} style={{ height: '260px', marginBottom: '16px' }} theme={isDarkModeActiveStatus ? 'dark' : 'light'} />
                                {/* ★ 使用者反映（2026-09-22）：這三個風險標籤先前假設外層一定有
                                    attackSimulationMetricsData 才會被渲染，直接讀取其欄位；但外層的判斷
                                    依據已改成 datasetRowStatsData（見上方說明），K-匿名「敏感欄位=0」時
                                    attackSimulationMetricsData 會是 null、這裡卻仍會被渲染，若不判斷會
                                    直接噴錯（Cannot read properties of null）。改為有資料才顯示三個標籤，
                                    沒有資料時顯示「未評估」提示，說明原因，而不是讓整張卡片消失或噴錯。 */}
                                {attackSimulationMetricsData ? (
                                    <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                                        {/* ★ 提示文字修正：初版說明文字含英文專有名詞、括號附註與完整範例句，
                                            使用者反映字太多、非相關背景知識人員無法一眼看懂，改為單句、去除英文
                                            名詞與例子，只保留「攻擊者能做到什麼」的白話結論。 */}
                                        {/* ★ 使用者反映：加了原始成功率／基準的完整說明句後太長太複雜，改為只在提示
                                            文字最後補一個精簡的「（原始 X%／基準 Y%）」括號，不寫整句解釋。 */}
                                        <Tag color="red" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>
                                            {translate('step4.risk.singling', '指認風險:')} {(attackSimulationMetricsData.singling.risk * 100).toFixed(1)}%
                                            <Tooltip title={`${translate('step4.risk.singling_tooltip', '攻擊者能否從資料中，找出只對應到某一個人的獨特一筆記錄。')} (原始 ${(attackSimulationMetricsData.singling.ori * 100).toFixed(1)}% / 基準 ${(attackSimulationMetricsData.singling.base * 100).toFixed(2)}%)`}>
                                                <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'help' }} />
                                            </Tooltip>
                                        </Tag>
                                        <Tag color="orange" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>
                                            {translate('step4.risk.linkability', '連結風險:')} {(attackSimulationMetricsData.linkability.risk * 100).toFixed(1)}%
                                            <Tooltip title={`${translate('step4.risk.linkability_tooltip', '攻擊者能否把同一個人分散在不同資料裡的紀錄兜在一起。')} (原始 ${(attackSimulationMetricsData.linkability.ori * 100).toFixed(1)}% / 基準 ${(attackSimulationMetricsData.linkability.base * 100).toFixed(2)}%)`}>
                                                <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'help' }} />
                                            </Tooltip>
                                        </Tag>
                                        <Tag color="cyan" style={{ flex: 1, textAlign: 'center', padding: '6px' }}>
                                            {translate('step4.risk.inference', '推斷風險:')} {(attackSimulationMetricsData.inference.risk * 100).toFixed(1)}%
                                            <Tooltip title={`${translate('step4.risk.inference_tooltip', '攻擊者能否用其他欄位的資訊，猜出這個人的敏感資料（例如疾病）。')} (原始 ${(attackSimulationMetricsData.inference.ori * 100).toFixed(1)}% / 基準 ${(attackSimulationMetricsData.inference.base * 100).toFixed(2)}%)`}>
                                                <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'help' }} />
                                            </Tooltip>
                                        </Tag>
                                    </div>
                                ) : (
                                    <div style={{ marginTop: 'auto', padding: '8px', textAlign: 'center', color: token.colorTextDescription, fontSize: '13px' }}>
                                        {translate('step4.risk.attacks_not_evaluated', '未評估（尚未設定「敏感欄位」，本次已略過三攻擊風險評估；不影響去識別化結果本身）')}
                                    </div>
                                )}
                                {/* ★ 使用者反映（2026-09-22）：K-匿名多重敏感欄位跑 CAP／三攻擊時，若某敏感欄位
                                    的值幾乎每筆都不同（唯一值佔比過高），後端底層 sklearn 分類器會讓服務容器當掉
                                    （詳見上方 highCardinalitySensitiveWarningInfo 狀態宣告處的完整說明）。這裡顯示
                                    本次執行偵測到的高風險欄位清單，並提供「仍要強制執行」勾選框——預設不勾選時
                                    這些欄位已被自動略過（不影響去識別化結果本身），使用者明確知情風險後可自行
                                    勾選強制送出，勾選後需按下方「重新運算」才會真的重新呼叫 API。 */}
                                {highCardinalitySensitiveWarningInfo.length > 0 && (() => {
                                    // 舊版快照沒有 handling 欄位，依當時的勾選狀態推回「強制」或「略過」。
                                    const resolveHandling = (item: typeof highCardinalitySensitiveWarningInfo[number]) =>
                                        item.handling || (forceRunHighCardinalitySensitiveFieldsStatus ? 'forced' : 'skipped');
                                    const binnedItemsList = highCardinalitySensitiveWarningInfo.filter((item) => resolveHandling(item) === 'binned');
                                    const skippedItemsList = highCardinalitySensitiveWarningInfo.filter((item) => resolveHandling(item) === 'skipped');
                                    const forcedItemsList = highCardinalitySensitiveWarningInfo.filter((item) => resolveHandling(item) === 'forced');
                                    const describeColumnsText = (itemsList: typeof highCardinalitySensitiveWarningInfo) =>
                                        itemsList.map((item) => `「${item.columnName}」(唯一值佔比 ${item.uniqueRatioPercent}%)`).join('、');
                                    // 級距可調的欄位：本次已分級距的，加上「數值型但級距太細仍被略過」的（有 binWidth）。
                                    const adjustableItemsList = highCardinalitySensitiveWarningInfo.filter((item) => item.binWidth !== undefined && resolveHandling(item) !== 'forced');
                                    const isOnlyBinnedStatus = skippedItemsList.length === 0 && forcedItemsList.length === 0;
                                    return (
                                        <Alert
                                            type={isOnlyBinnedStatus ? 'info' : 'warning'}
                                            showIcon
                                            style={{ marginTop: '12px' }}
                                            message={isOnlyBinnedStatus
                                                ? translate('step4.risk.sensitive_binned_title', '連續數值敏感欄位已自動分級距')
                                                : translate('step4.risk.high_cardinality_warning_title', '偵測到高風險敏感欄位')}
                                            description={
                                                <div>
                                                    <div style={{ marginBottom: 6 }}>
                                                        {translate('step4.risk.high_cardinality_reason', '推斷性攻擊以準識別欄位預測敏感欄位的值，並以「預測值與真實值完全相等」判定攻擊成功，因此敏感欄位需為可列舉的類別。值幾乎每筆都不同的欄位（如薪資）無法得到有意義的結果，運算量也會暴增。')}
                                                    </div>
                                                    {binnedItemsList.length > 0 && (
                                                        <div>
                                                            {translate('step4.risk.sensitive_binned_desc', '{{columns}} 已依級距轉換後再執行三攻擊／CAP（僅用於風險評估，去識別化結果本身不受影響）。', { columns: binnedItemsList.map((item) => `「${item.columnName}」每 ${item.binWidth!.toLocaleString()} 一級（共 ${item.binCount} 級）`).join('、') })}
                                                        </div>
                                                    )}
                                                    {skippedItemsList.length > 0 && (
                                                        <div>
                                                            {translate('step4.risk.high_cardinality_warning_desc', '{{columns}} 已略過三攻擊／CAP（不影響去識別化結果本身）。數值欄位可調大下方級距寬度；文字欄位請先自行歸併為類別後重新上傳。', { columns: describeColumnsText(skippedItemsList) })}
                                                        </div>
                                                    )}
                                                    {forcedItemsList.length > 0 && (
                                                        <div>
                                                            {translate('step4.risk.high_cardinality_forced_desc', '{{columns}} 已依設定以原始值強制執行三攻擊／CAP，結果不具評估意義，且可能執行失敗。', { columns: describeColumnsText(forcedItemsList) })}
                                                        </div>
                                                    )}
                                                    {adjustableItemsList.length > 0 && !forceRunHighCardinalitySensitiveFieldsStatus && (
                                                        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                                                            {adjustableItemsList.map((item) => (
                                                                <Space key={item.columnName} size={4}>
                                                                    <span>{translate('step4.risk.bin_width_label', '「{{column}}」級距寬度', { column: item.columnName })}</span>
                                                                    <InputNumber
                                                                        min={0}
                                                                        size="small"
                                                                        style={{ width: 120 }}
                                                                        value={sensitiveBinWidthOverridesMap[item.columnName] ?? item.binWidth}
                                                                        onChange={(nextValue) => setSensitiveBinWidthOverridesMap((prev) => {
                                                                            const nextMap = { ...prev };
                                                                            if (typeof nextValue === 'number' && nextValue > 0) nextMap[item.columnName] = nextValue;
                                                                            else delete nextMap[item.columnName];
                                                                            return nextMap;
                                                                        })}
                                                                    />
                                                                </Space>
                                                            ))}
                                                            <span style={{ color: token.colorTextDescription, fontSize: 12 }}>
                                                                {translate('step4.risk.bin_width_hint', '調整後請按「重新運算」；清空則恢復自動級距')}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {(skippedItemsList.length > 0 || forcedItemsList.length > 0) && (
                                                        <Checkbox
                                                            checked={forceRunHighCardinalitySensitiveFieldsStatus}
                                                            onChange={(e) => setForceRunHighCardinalitySensitiveFieldsStatus(e.target.checked)}
                                                            style={{ marginTop: 6 }}
                                                        >
                                                            {translate('step4.risk.high_cardinality_force_run_checkbox', '我了解風險，仍以原始值（不分級距）強制對這些欄位執行三攻擊／CAP（勾選後請按「重新運算」，若導致後端無回應請取消勾選）')}
                                                        </Checkbox>
                                                    )}
                                                </div>
                                            }
                                        />
                                    );
                                })()}
                                {datasetRowStatsData && (
                                    <div style={{ marginTop: '12px', fontSize: '12px', color: token.colorTextDescription }}>
                                        {translate(
                                            'step4.risk.row_stats_detail',
                                            '資料筆數：輸入 {{input}} 筆、刪除 {{deleted}} 筆、輸出 {{output}} 筆',
                                            {
                                                input: datasetRowStatsData.input.toLocaleString(),
                                                deleted: datasetRowStatsData.deleted.toLocaleString(),
                                                output: datasetRowStatsData.output.toLocaleString()
                                            }
                                        )}
                                    </div>
                                )}
                                {/* ★ 使用者反映（2026-09-22）：attackReportData 與 attackSimulationMetricsData
                                    永遠同步（見上方 setAttackReportData／setAttackSimulationMetricsData 都是同一個
                                    attackReportResult 驅動），但這是兩個獨立的 state，TypeScript 無法從
                                    attackReportData?.message 的真假推斷出 attackSimulationMetricsData 也非
                                    null，故這裡另外加一次 attackSimulationMetricsData 判斷式，單純為了讓型別
                                    檢查通過，實際執行邏輯不變（兩者本來就同時為 null 或同時有值）。 */}
                                {attackReportData?.message && attackSimulationMetricsData && (() => {
                                    // Backend message head is fixed-format with internal method notes and 2-decimal raw fractions,
                                    // which mismatches the 1-decimal percentage precision used by the tags above and reads as a contradiction.
                                    // Rebuild just the head with matching percentage precision and no internal method notes; keep any trailing note as-is.
                                    const headPattern = /^三攻擊風險評估完成(?:（[^）]*）)?。指認性風險:\s*[\d.]+,\s*連結性風險:\s*[\d.]+,\s*推斷性風險:\s*[\d.]+。/;
                                    const rebuiltHead = `${translate('step4.risk.summary_prefix', '三攻擊風險評估完成。')}${translate('step4.risk.singling', '指認風險:')} ${(attackSimulationMetricsData.singling.risk * 100).toFixed(1)}%, ${translate('step4.risk.linkability', '連結風險:')} ${(attackSimulationMetricsData.linkability.risk * 100).toFixed(1)}%, ${translate('step4.risk.inference', '推斷風險:')} ${(attackSimulationMetricsData.inference.risk * 100).toFixed(1)}%。`;
                                    const displayMessage = headPattern.test(attackReportData.message)
                                        ? attackReportData.message.replace(headPattern, rebuiltHead)
                                        : attackReportData.message;
                                    return (
                                        <div style={{ marginTop: '4px', fontSize: '12px', color: token.colorTextDescription }}>
                                            {displayMessage}
                                        </div>
                                    );
                                })()}
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
                                            {currentPrivacyModeTypeStr === 'k-anonymity'
                                                ? (
                                                    <>
                                                        {translate('step4.utility.suppression', '資料紀錄抑制率')}
                                                        {/* ★ 使用者反映：畫面上只有數字，沒有任何說明，非技術背景的使用者看不懂
                                                            這代表什麼、數字愈高愈好還是愈低愈好。補上「?」提示，並依實際採用的
                                                            抑制方式（列抑制／值抑制）給出對應的白話說明，避免固定寫死「整列」
                                                            但實際上是值抑制（打 *）的情形，造成說明與實際結果不符。 */}
                                                        <Tooltip title={
                                                            (currentSuppressionMethodStr === 'cell' || currentSuppressionMethodStr === 'cell_suppression')
                                                                ? translate('step4.utility.suppression_tooltip_cell', '為了讓每個分組都符合您設定的隱私要求（例如 k 值），系統必須遮蔽（打上「*」）的資料格數，佔全部資料格數的比例。比例愈高，代表被遮蔽、看不到原始內容的資料愈多。')
                                                                : translate('step4.utility.suppression_tooltip_row', '為了讓每個分組都符合您設定的隱私要求（例如 k 值），系統必須整列刪除的資料筆數，佔全部資料筆數的比例。比例愈高，代表被刪除、無法保留下來的資料愈多。')
                                                        }>
                                                            <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'help' }} />
                                                        </Tooltip>
                                                    </>
                                                )
                                                : '總消耗隱私預算 (Epsilon)'}
                                        </div>
                                        <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#1677ff', marginBottom: '16px', fontFamily: 'monospace', lineHeight: 1 }}>
                                            {currentPrivacyModeTypeStr === 'k-anonymity'
                                                // ★ 修正: 後端回傳的抑制率為完整浮點數（如 0.10749143651555759），
                                                //   直接顯示位數過多，改為四捨五入至小數點後 2 位。
                                                // ★ 使用者反映（2026-09-29）：兩位小數會把 7.629% 顯示成 7.63%，與上限 7.63% 看起來
                                                //   相同而誤以為「剛好卡線卻通過」。改顯示到三位，並於下方附上被抑制數／總數。
                                                ? <>{(kReport ? kReport.suppression_rate_percent : 0).toFixed(3)} <span style={{ fontSize: '20px' }}>%</span></>
                                                : <>{dpReport ? dpReport.consumed_epsilon : 0} <span style={{ fontSize: '20px' }}>ε</span></>
                                            }
                                        </div>
                                        {currentPrivacyModeTypeStr === 'k-anonymity' && kReport && (() => {
                                            const isCellUnitStatus = kReport.suppression_unit === 'cell';
                                            // 後端有回傳分子／分母時優先使用；列抑制時可退回前端實際數出的刪除／輸入筆數
                                            const suppressedCountValue = kReport.suppressed_count ?? (!isCellUnitStatus ? datasetRowStatsData?.deleted : undefined);
                                            const totalCountValue = kReport.suppression_total_count ?? (!isCellUnitStatus ? datasetRowStatsData?.input : undefined);
                                            if (suppressedCountValue === undefined || totalCountValue === undefined) return null;
                                            return (
                                                <div style={{ marginTop: '-8px', marginBottom: '12px', fontSize: '12px', color: token.colorTextDescription }}>
                                                    {translate('step4.utility.suppression_count_detail', '（{{suppressed}} / {{total}} {{unit}}，上限 {{limit}}%）', {
                                                        suppressed: suppressedCountValue.toLocaleString(),
                                                        total: totalCountValue.toLocaleString(),
                                                        unit: isCellUnitStatus ? '格' : '筆',
                                                        limit: currentMaxSuppressionNumber ?? 5
                                                    })}
                                                </div>
                                            );
                                        })()}
                                        {currentPrivacyModeTypeStr === 'k-anonymity' && (
                                            <div style={{ fontSize: '12px', color: token.colorTextDescription, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ textAlign: 'center', width: '100%', paddingTop: '24px' }}>
                                        <div style={{ fontSize: '14px', color: token.colorTextDescription, marginBottom: '16px' }}>
                                            {translate('step4.utility.total_cols', '實際去識別數 / 總欄位數')}
                                            <Tooltip title={currentPrivacyModeTypeStr === 'differential-privacy'
                                                ? translate('step4.utility.total_cols_tooltip_dp', '只計入已啟用差分隱私（實際會被加噪）的欄位。')
                                                : translate('step4.utility.total_cols_tooltip_k', '只計入實際會被遮蔽或泛化的欄位：識別符需選擇遮蔽策略（非「不處理」）；準識別符需設定完整的泛化參數（如區間、進位單位或分類樹對照表）。敏感與非敏感欄位不會被 K-匿名改動，因此不計入。')}>
                                                <QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} />
                                            </Tooltip>
                                        </div>
                                        <div style={{ fontSize: '36px', fontWeight: 'bold', color: token.colorText, fontFamily: 'monospace', lineHeight: 1 }}>
                                            {deidentifiedColumnsCountValue} <span style={{ fontSize: '20px', color: token.colorTextSecondary }}>/ {actualProcessedColumnsList.length}</span>
                                        </div>
                                        {nonDeidentifiedColumnsDetailList.length > 0 && (
                                            <Tooltip
                                                placement="bottom"
                                                title={(
                                                    <div>
                                                        {nonDeidentifiedColumnsDetailList.map((item) => (
                                                            <div key={item.columnName}>• <b>{item.columnName}</b>：{item.reason}</div>
                                                        ))}
                                                    </div>
                                                )}
                                            >
                                                <div style={{ marginTop: '12px', fontSize: '12px', color: token.colorWarningText, cursor: 'help' }}>
                                                    {translate('step4.utility.non_deidentified_hint', '{{count}} 個欄位未計入（維持原值輸出），滑鼠移過查看', { count: nonDeidentifiedColumnsDetailList.length })}
                                                </div>
                                            </Tooltip>
                                        )}
                                    </div>
                                </div>
                            </Card>
                        </Col>
                    </Row>

                    <Card
                        title={
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span><EyeOutlined style={{ marginRight: 8, color: '#13c2c2' }} />{translate('step4.preview.title', '脫敏結果預覽對照 (First 10 Rows)')}</span>
                                <Segmented options={[{ label: currentPrivacyModeTypeStr === 'k-anonymity' ? translate('step4.preview.masked.k_anon', 'K-匿名化後資料') : translate('step4.preview.masked.dp', '差分隱私加噪後資料'), value: 'masked' }, { label: translate('step4.preview.raw', '原始明文數據 (Raw)'), value: 'original' }]} value={previewViewMode} onChange={(selectedViewModeVal) => setPreviewViewMode(selectedViewModeVal as 'masked' | 'original')} />
                            </div>
                        }
                        variant="borderless" style={{ background: token.colorBgContainer, marginTop: '24px' }}
                    >
                        {/* ★ 新增：使用者反映對照原始資料時，看到年齡／bmi 等欄位變成「*」，不清楚
                            原因，還以為是對照錯誤。已對照後端原始碼確認 (app/engines/anonymization/
                            strategies/generalize.py 的 apply_numeric_bins／categorical_mapping_generalize)：
                            「*」代表這一格的原始值沒有落在 Step2「泛化階層對照」設定的任何一段區間／
                            分類裡，系統為了避免外洩「沒被泛化到」的原始值，才整格改顯示「*」完全遮蔽，
                            並非程式出錯。Step2 雖然已經說明過，但使用者容易在跑到 Step4 時忘記，故在
                            這裡（實際看到「*」的當下）就地補充一次提醒。僅 K-匿名模式、且目前畫面上
                            確實有出現「*」時才顯示，避免無關時多一條用不到的提示。 */}
                        {currentPrivacyModeTypeStr === 'k-anonymity' && previewViewMode === 'masked'
                            && realMaskedDataRows.some((rowRecordItem) => Object.values(rowRecordItem).some((cellValue) => cellValue === '*')) && (
                            <Alert
                                type="info"
                                showIcon
                                style={{ marginBottom: '12px', textAlign: 'left' }}
                                message={translate('step4.preview.wildcard_hint_title', '欄位顯示「*」是什麼意思？')}
                                description={translate(
                                    'step4.preview.wildcard_hint_desc',
                                    '「*」不是錯誤，代表這筆資料的原始值沒有被您在 Step2「泛化階層對照」設定的分類或區間涵蓋到，系統為了避免外洩沒被泛化到的原始值，直接整格改顯示「*」。如果想保留這些資料的可用性，請回到 Step2，把這個值也加進對照設定中。'
                                )}
                            />
                        )}
                        {previewViewMode === 'masked' && previewParseDiagnosticText && (
                            <Alert
                                type="warning"
                                showIcon
                                style={{ marginBottom: '12px', textAlign: 'left' }}
                                message={translate('step4.preview.parse_diagnostic_title', '預覽表格暫時無法顯示資料')}
                                description={
                                    <>
                                        <div>{translate('step4.preview.parse_diagnostic_desc', '後端已成功回傳去識別化後的檔案（上方分數皆以此檔案計算得出），但畫面在解析內容以顯示預覽表格時發生問題，這是顯示層的問題，不代表去識別化處理本身失敗或輸出檔案有誤。請將以下除錯資訊截圖回報：')}</div>
                                        <div style={{ marginTop: '8px', fontSize: '12px', fontFamily: 'monospace', wordBreak: 'break-all', color: token.colorTextDescription }}>{previewParseDiagnosticText}</div>
                                    </>
                                }
                            />
                        )}
                        <Table
                            key={`preview-table-${previewViewMode}`}
                            dataSource={previewTableDataRowsList}
                            columns={(previewViewMode === 'masked' ? maskedPreviewColumnNamesList : actualProcessedColumnsList).map((columnNameString) => {
                                const { role: configuredRoleNameString, tagColor: mappedTagColorString } = getCalculatedRole(columnNameString);
                                const localizedRoleI18nKeyString = `step4.role.${configuredRoleNameString.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')}`;
                                // ★ 2026-09-29：此欄位若在本次風險評估中被自動分級距（僅套用在送三攻擊／CAP 的資料副本），
                                //   在標籤旁加提示，避免使用者看到預覽仍是原始值而誤以為分級距沒生效或輸出也被分級距。
                                const cleanPreviewColumnName = columnNameString.replace(/^[\uFEFF\u200B]+/, '').trim();
                                const binnedInfoForColumn = highCardinalitySensitiveWarningInfo.find(
                                    (item) => item.handling === 'binned' && item.binWidth !== undefined && item.columnName === cleanPreviewColumnName
                                );
                                return {
                                    title: (<div><div>{columnNameString}</div><Tag color={mappedTagColorString} style={{ fontSize: '10px', margin: 0 }}>{translate(localizedRoleI18nKeyString, configuredRoleNameString)}</Tag>{binnedInfoForColumn && (
                                        <Tooltip title={translate('step4.preview.binned_column_tooltip', '風險評估時以每 {{width}} 分級距（共 {{count}} 級）；去識別化輸出保留原始值', { width: binnedInfoForColumn.binWidth!.toLocaleString(), count: binnedInfoForColumn.binCount })}>
                                            <QuestionCircleOutlined style={{ marginLeft: 4, fontSize: '11px', cursor: 'help', color: token.colorTextDescription }} />
                                        </Tooltip>
                                    )}</div>),
                                    dataIndex: columnNameString, key: columnNameString,
                                };
                            })}
                            // ★ 使用者確認維持預覽 10 筆即可：資料來源（realMaskedDataRows／
                            // sampleRawDataRowsList）本身都已經只有最多 10 筆，分頁永遠只會有
                            // 1 頁，右下角的分頁按鈕形同虛設、只是多餘的雜訊，故關閉分頁功能。
                            pagination={false} size="small" rowKey={PREVIEW_ROW_KEY_FIELD} scroll={{ x: 'max-content' }}
                        />
                    </Card>

                    {/* ★ 2026-10-01：後端報告中先前未呈現的項目（雜湊演算法／加鹽／系統預設值；DP 逐欄預算明細），預設收合
                        ★ 2026-10-02：暫不顯示，見 SHOW_BACKEND_REPORT_DETAILS */}
                    {SHOW_BACKEND_REPORT_DETAILS && <BackendReportDetails kReport={kReport} dpReport={dpReport} />}
                    </>
                )
            )}

            <Modal
                title={translate('step4.modal.title', '隱私合規與風險評估報告')}
                open={isReportModalVisibleStatus} onCancel={() => setIsReportModalVisibleStatus(false)} width={800} styles={{ body: { maxHeight: '72vh', overflowY: 'auto', paddingRight: '6px' } }}
                footer={[
                    <Button key="close" onClick={() => setIsReportModalVisibleStatus(false)}>{translate('step4.modal.close', '關閉')}</Button>,
                    <Button key="download" type="primary" icon={<DownloadOutlined />} loading={isExportingPdfStatus} onClick={handleDownloadPDF} style={{ background: '#4F46E5' }}>{translate('step4.modal.export_pdf', '匯出 PDF 憑證')}</Button>
                ]}
            >
                {/* ★ 使用者反映（2026-09-22）：與上方主畫面同理，這裡先前也用
                    attackSimulationMetricsData 是否有值來決定整份合規報告 Modal 開起來是否有
                    內容，K-匿名「敏感欄位=0」時會整份報告都是空的。改用 datasetRowStatsData
                    判斷「這一輪是否真的跑完」，報告內「隱私安全風險評估」那個象限另外處理
                    attackSimulationMetricsData 是否存在（見下方），其餘象限（檔案資訊、效用
                    評估、欄位處置對照表）不受風險評估是否執行影響，應正常顯示。

                    ★ 使用者反映（2026-09-23）：這份「合規審計報告」跟「官方風險評估報告」
                    （後端 /api/v1/report 簽發）風格版面不一致、內容各自獨立，使用者覺得太
                    複雜。這裡整份改版比照官方報告的樸素風格（深色品牌列、置中大標題、
                    一二三四五六編號段落、樸素邊框表格、無彩色卡片），並把官方報告獨有的
                    「隱私強化處理配置」段落（去識別技術參數＋三攻擊固定參數）一併合併進來，
                    讓使用者只需要看這一份、視覺風格與官方報告一致的完整報告——原本合規報告
                    才有的專案資訊、資料效用評估、欄位對照表、數位簽章則完整保留，不因改版而
                    遺失內容。 */}
                {datasetRowStatsData && (() => {
                    const sectionHeadingStyle: CSSProperties = { color: '#000000', fontSize: '15px', fontWeight: 600, marginTop: '24px', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid #d9d9d9' };
                    const keyValueRowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#333333', padding: '3px 0' };

                    // 一、專案與檢測權限資訊
                    // ★ 使用者反映（2026-09-23）：拿掉「檢測核可人」這一列，此段落只保留檔案名稱與保護模式。
                    const projectInfoRowsList: { label: string; value: string }[] = [
                        { label: translate('step4.report.file_name', '原始檔案名稱：'), value: currentDatasetFileNameString || 'dataset.csv' },
                        { label: translate('step4.report.mode', '保護模式：'), value: currentPrivacyModeTypeStr === 'k-anonymity' ? translate('step4.report.k_anonymity_value', 'K-匿名化') : translate('step4.report.dp_value', '差分隱私化') }
                    ];

                    // 二、隱私強化處理配置：比照官方風險評估報告（後端 /api/v1/report）同一段落的
                    // 顯示內容——去識別方法參數取自本次實際送給後端的同一組畫面狀態；三攻擊固定
                    // 參數取自上方 RISK_ATTACK_REPORT_DISPLAY_PARAMS（與 runFullPipeline 內實際送出
                    // 的 RISK_ATTACK_DEFAULT_PARAMS 同步維護，見該常數宣告處說明）。
                    const deidConfigRowsList: { label: string; value: string }[] = currentPrivacyModeTypeStr === 'k-anonymity'
                        ? [
                            { label: translate('step4.report.deid_technique', '去識別技術'), value: translate('step4.report.k_anonymity_value', 'K-匿名化') },
                            { label: translate('step4.report.k_value_label', 'k 值'), value: String(currentKValueNumber) },
                            { label: translate('step4.report.suppress_limit_label', '抑制上限（%）'), value: String(currentMaxSuppressionNumber ?? 5) },
                            { label: translate('step4.report.exceed_behavior_label', '超限行為'), value: (currentLimitExceededActionStr || 'stop_and_error') === 'stop_and_error' ? translate('step3.stop_and_error', '停止並報錯') : translate('step3.force_suppress', '強制抑制(降效用)') },
                            { label: translate('step4.report.suppress_method_label', '抑制方式'), value: (currentSuppressionMethodStr === 'cell' || currentSuppressionMethodStr === 'cell_suppression') ? translate('step3.cell_suppression', '值抑制 ') : translate('step3.row_suppression', '列抑制 ') },
                            ...((currentSuppressionMethodStr === 'cell' || currentSuppressionMethodStr === 'cell_suppression')
                                ? [{ label: translate('step4.report.cell_fill_label', '值抑制填法'), value: currentCellFillMethodStr === 'missing' ? translate('step3.cell_fill_missing', '缺失值 (missing)') : translate('step3.cell_fill_star', '星號遮蔽 (star)') }]
                                : [])
                        ]
                        : [
                            { label: translate('step4.report.deid_technique', '去識別技術'), value: translate('step4.report.dp_value', '差分隱私化') },
                            { label: translate('step4.report.accumulated_epsilon_label', '已累計 ε'), value: String(dpAccumulatedEpsilonValue ?? 0) },
                            { label: translate('step4.report.accumulated_delta_label', '已累計 δ'), value: String(dpAccumulatedDeltaValue ?? 0) },
                            { label: translate('step4.report.default_delta_label', '預設 δ'), value: String(globalTargetDeltaValue ?? 0.0001) }
                        ];
                    const riskAttackParamRowsList: { label: string; value: string }[] = [
                        { label: translate('step4.report.iter_count_label', '指認性迭代次數'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.n_iter) },
                        { label: translate('step4.report.ctrl_ratio_label', '控制組比例'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.ctrl_ratio) },
                        { label: translate('step4.report.seed_label', '亂數種子'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.seed) },
                        { label: translate('step4.report.subset_size_label', '連結性子集大小'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.n_subset) },
                        { label: translate('step4.report.repeat_rounds_label', '重複實驗輪數'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.n_repeats) },
                        { label: translate('step4.report.overlap_ratio_label', '跨輪重疊比例'), value: String(RISK_ATTACK_REPORT_DISPLAY_PARAMS.overlap_ratio) }
                    ];
                    const privacyConfigRowsList = [...deidConfigRowsList, ...riskAttackParamRowsList];

                    const renderKeyValueTable = (rowsList: { label: string; value: string }[], headerLeftText: string, headerRightText: string) => (
                        <div style={{ border: '1px solid #d9d9d9', borderRadius: '4px', marginBottom: '20px', overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', color: '#000000', backgroundColor: '#ffffff' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#f1f5f9' }}>
                                        <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 12px', textAlign: 'left', width: '40%', fontSize: '13px' }}>{headerLeftText}</th>
                                        <th style={{ borderBottom: '2px solid #d9d9d9', padding: '8px 12px', textAlign: 'left', fontSize: '13px' }}>{headerRightText}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rowsList.map((rowItem, rowIndexNumber) => (
                                        <tr key={rowIndexNumber}>
                                            <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 12px', fontSize: '13px', color: '#333333', wordBreak: 'break-word' }}>{rowItem.label}</td>
                                            <td style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 12px', fontSize: '13px', color: '#333333', wordBreak: 'break-word' }}>{rowItem.value}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    );

                    return (
                        <div id="printable-audit-report" ref={pdfReportContainerRef} style={{ color: '#000000', backgroundColor: '#ffffff', borderRadius: '4px', fontFamily: 'sans-serif', overflow: 'hidden' }}>
                            {/* 頂部深色品牌列，固定樣式不受畫面明／暗主題影響（比照官方風險評估報告 PDF 的
                                固定風格），才不會印出來的稽核文件因為使用者當下切成深色模式而變色。 */}
                            <div className="pdf-page-break" style={{ background: '#1f2937', color: '#ffffff', padding: '14px 24px', fontSize: '12px', pageBreakInside: 'avoid' }}>
                                {translate('step4.report.brand_bar', '通用去識別化與隱私保護系統 - 安全驗證與合規稽核報告')}
                            </div>

                            <div style={{ padding: isExportingPdfStatus ? '24px' : '24px' }}>
                                <div className="pdf-page-break" style={{ textAlign: 'center', marginBottom: '8px', pageBreakInside: 'avoid' }}>
                                    <h2 style={{ margin: '12px 0 4px', color: '#000000', fontSize: '21px' }}>{translate('step4.report.header', '隱私合規與風險評估報告')}</h2>
                                    <div style={{ fontSize: '12px', color: '#555555' }}>
                                        {translate('step4.report.cert_id', '報告編號:')} {auditMetadataObject.certificateId} ｜ {translate('step4.report.audit_time', '產出時間:')} {auditMetadataObject.auditTime}
                                    </div>
                                </div>

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, marginTop: '20px', pageBreakInside: 'avoid' }}>一、 {translate('step4.report.info_title', '專案與檢測權限資訊')}</h4>
                                {renderKeyValueTable(projectInfoRowsList, translate('step4.report.config_item_header', '設定項目'), translate('step4.report.config_detail_header', '配置細節'))}

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>二、 {translate('step4.report.privacy_config_title', '隱私強化處理配置')}</h4>
                                {renderKeyValueTable(privacyConfigRowsList, translate('step4.report.config_item_header', '設定項目'), translate('step4.report.config_detail_header', '配置細節'))}

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>三、 {translate('step4.report.risk_title', '再識別風險量測結果')}</h4>
                                <div className="pdf-page-break" style={{ marginBottom: '20px', pageBreakInside: 'avoid' }}>
                                    {attackSimulationMetricsData ? (
                                        <>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.singling_risk', '指認性攻擊成功率 (Singling Out)：')}</span><span>{(attackSimulationMetricsData.singling.risk * 100).toFixed(2)}%</span></div>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.linkability_risk', '連結性攻擊成功率 (Linkability)：')}</span><span>{(attackSimulationMetricsData.linkability.risk * 100).toFixed(2)}%</span></div>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.inference_risk', '推斷性攻擊成功率 (Inference)：')}</span><span>{(attackSimulationMetricsData.inference.risk * 100).toFixed(2)}%</span></div>
                                        </>
                                    ) : (
                                        // ★ 使用者反映（2026-09-22）：K-匿名「敏感欄位=0」時三攻擊被略過，這裡改顯示
                                        //   說明文字，而非讀取 null 的 attackSimulationMetricsData 噴錯或整份報告消失。
                                        <div style={{ fontSize: '13px', color: '#555555', padding: '3px 0' }}>
                                            {translate('step4.report.risk_not_evaluated', '未評估（尚未設定「敏感欄位」，本次已略過三攻擊與 CAP 風險評估）')}
                                        </div>
                                    )}
                                    {/* ★ 使用者反映（2026-09-23）：CAP 前後對比獨立於 attackSimulationMetricsData
                                        是否有值（CAP 與三攻擊分開執行、分開判斷「是否已略過」），只依
                                        capReportData 本身判斷要顯示數字還是「未評估」原因；標籤文字比照官方
                                        風險評估報告的「處理前／處理後歸因機率」措辭，維持風格一致。 */}
                                    {capReportData && !(capReportData.cap_before < 0 || capReportData.cap_after < 0) ? (
                                        <>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.cap_before_label', '處理前歸因機率 (CAP Before)：')}</span><span>{(capReportData.cap_before * 100).toFixed(2)}%</span></div>
                                            <div style={keyValueRowStyle}><span>{translate('step4.report.cap_after_label', '處理後歸因機率 (CAP After)：')}</span><span>{(capReportData.cap_after * 100).toFixed(2)}%</span></div>
                                        </>
                                    ) : (
                                        <div style={{ fontSize: '13px', color: '#555555', padding: '3px 0' }}>
                                            {translate('step4.report.cap_not_evaluated', '未評估（間接識別碼或敏感欄位設定不足，或限定條件篩選後無資料）')}
                                            {capReportData?.message && (
                                                <div style={{ marginTop: '4px', fontSize: '12px' }}>
                                                    {translate('step4.report.cap_backend_message_prefix', '後端回應原因：')}{capReportData.message}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>四、 {translate('step4.report.utility_title', '資料效用與失真度評估')}</h4>
                                <div className="pdf-page-break" style={{ marginBottom: '20px', pageBreakInside: 'avoid' }}>
                                    <div style={keyValueRowStyle}>
                                        <span>{currentPrivacyModeTypeStr === 'k-anonymity' ? translate('step4.report.suppression', '資料紀錄抑制率：') : translate('step4.report.total_epsilon', '總消耗隱私預算 (Epsilon)：')}</span>
                                        <span>{currentPrivacyModeTypeStr === 'k-anonymity' ? `${(kReport ? kReport.suppression_rate_percent : 0).toFixed(3)}%` : `${dpReport ? dpReport.consumed_epsilon : 0} ε`}</span>
                                    </div>
                                    <div style={keyValueRowStyle}>
                                        <span>{translate('step4.report.total_cols', '實際去識別數 / 總欄位數：')}</span><span>{deidentifiedColumnsCountValue} / {actualProcessedColumnsList.length}</span>
                                    </div>
                                    {datasetRowStatsData && (
                                        <div style={keyValueRowStyle}>
                                            <span>{translate('step4.report.row_stats', '資料筆數（輸入/刪除/輸出）：')}</span>
                                            <span>{datasetRowStatsData.input.toLocaleString()} / {datasetRowStatsData.deleted.toLocaleString()} / {datasetRowStatsData.output.toLocaleString()}</span>
                                        </div>
                                    )}
                                </div>

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>五、 {translate('step4.report.table_title', '欄位處置與技術對照表')}</h4>
                                <div style={{ maxHeight: isExportingPdfStatus ? 'none' : '240px', overflowY: isExportingPdfStatus ? 'visible' : 'auto', border: '1px solid #d9d9d9', borderRadius: '4px', marginBottom: '20px' }}>
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

                                <h4 className="pdf-page-break" style={{ ...sectionHeadingStyle, pageBreakInside: 'avoid' }}>六、 {translate('step4.report.measurement_note_title', '量測說明')}</h4>
                                <div className="pdf-page-break" style={{ fontSize: '12px', color: '#555555', marginBottom: '20px', pageBreakInside: 'avoid' }}>
                                    {attackSimulationMetricsData ? (
                                        <div style={{ marginBottom: '4px' }}>
                                            {translate('step4.report.measurement_note_attack', '三攻擊風險評估完成。指認性風險: {{singling}}, 連結性風險: {{linkability}}, 推斷性風險: {{inference}}。', {
                                                singling: attackSimulationMetricsData.singling.risk.toFixed(2),
                                                linkability: attackSimulationMetricsData.linkability.risk.toFixed(2),
                                                inference: attackSimulationMetricsData.inference.risk.toFixed(2)
                                            })}
                                        </div>
                                    ) : (
                                        <div>{translate('step4.report.measurement_note_not_evaluated', '尚未設定「敏感欄位」，本次已略過三攻擊與 CAP 風險評估，故無量測結果可供說明。')}</div>
                                    )}
                                    {capReportData && !(capReportData.cap_before < 0 || capReportData.cap_after < 0) && (
                                        <div>
                                            {translate('step4.report.measurement_note_cap', 'CAP 前後對比完成。處理前: {{before}}, 處理後: {{after}}。', {
                                                before: capReportData.cap_before.toFixed(2),
                                                after: capReportData.cap_after.toFixed(2)
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* ★ 2026-10-02：原為寫死的假簽章字串，改為真實防篡改指紋與數位簽章（見 components/AuditIntegrityPanel） */}
                                <AuditIntegrityPanel
                                    entry={currentAuditLogEntry}
                                    className="pdf-page-break"
                                    style={{ textAlign: 'left', marginTop: '16px', borderTop: `1px dashed #d9d9d9`, paddingTop: '12px', fontSize: '12px', color: '#888888', pageBreakInside: 'avoid', lineHeight: 1.7 }}
                                />
                            </div>
                        </div>
                    );
                })()}
            </Modal>
        </div>
    );
}