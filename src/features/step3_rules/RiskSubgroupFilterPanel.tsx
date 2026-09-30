/**
 * ============================================================================
 * 檔案名稱 (File): RiskSubgroupFilterPanel.tsx
 * 模組功能 (Description): 風險評估「對象族群限定條件 (subgroup)」設定面板 (選填，限定三攻擊／CAP 風險評估只針對特定子群體資料進行，而非整份資料集)
 * 專案名稱 (Project): Privacy Protection Toolkit
 * 規範對照: 符合開發規範 a) ~ e) 識別字命名原則
 *
 * ★ 新增背景：後端 /risk/k-anonymity、/risk/dp、/risk/cap 三個端點的設定檔皆支援選填的
 * subgroup 欄位（見交付文件《設定檔結構與參數說明.pdf》4-3 節），可將風險評估範圍限定在
 * 特定子群體（如「只評估年齡 30~40 歲、且居住於臺北市／新北市」的資料），而非固定評估全體。
 * 但原本前端在組三個風險評估 API 的設定檔時，完全沒有串接這個欄位、畫面上也沒有對應的
 * 輸入介面——此為前後端整合缺口，非設計上刻意不開放。此組件補上對應的設定 UI，寫入
 * WorkspaceStore 之 riskSubgroupFilters，並由 Step4_Result.tsx 讀取、轉換為後端要求的
 * JSON 格式後，一併放入三個風險評估設定檔的 subgroup 欄位。
 *
 * 後端格式（同一份文件 4-3 節原文）：
 *   "subgroup": {
 *     "年齡": {"min": 30, "max": 40},
 *     "地區": ["臺北市", "新北市"]
 *   }
 * 數值與日期以 min／max 表示閉區間（首尾皆含，亦可只給一側）；類別以陣列列舉，符合清單內
 * 任一值者入選；多欄並列時取交集 (AND)。未設定 (本組件內清單為空) 時後端評估全體。
 *
 * ★ 新增 (使用者實測回報)：類別型欄位原本開放自由手動輸入，使用者實測時憑印象輸入了資料集
 * 中根本不存在的值（例如打「北區／南區」，但資料集實際存的是「大安區／板橋區」等行政區名稱；
 * 打「在職／非在職」，但實際存的是「教師／工程師／公務員」等職業別），導致 subgroup 篩選後
 * 樣本數為 0，後端回傳「無資料可評估」——並非前後端串接或系統有問題，純粹是打字內容與資料集
 * 對不上。使用者確認：改為「完全不開放手動輸入，僅能從清單勾選」，且清單來源採「完整掃描
 * 資料集」(而非僅 Step1 預覽的前 1000 筆) 以確保清單完整、不會漏掉實際存在的值。故新增
 * useEffect：掛載時若尚未掃描過目前的 dataFile，即完整解析一次原始上傳檔案 (不受 1000 筆
 * 預覽上限)，取得每個欄位之相異值 (依出現次數排序，最多快取 1000 個以避免極端高基數欄位
 * 耗用過多記憶體)，快取於全域 Store 之 columnCategoricalUniqueValues 供本組件使用；類別型
 * 欄位輸入框改為 Select mode="multiple" (僅能勾選清單內的值，不接受自由輸入新文字)。
 * ============================================================================
 */

import React from 'react';
import { Card, Select, Button, Space, Input, Tooltip, Empty, Typography, Spin } from 'antd';
import { PlusOutlined, DeleteOutlined, QuestionCircleOutlined, FilterOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore, type RiskSubgroupCondition } from '../../store/useWorkspaceStore';
import { useEnsureDatasetProfile, MAX_TOP_VALUES_PER_COLUMN } from '../../utils/datasetProfile';
import { resolveColumnKindForSubgroup, isColumnTemporalForSubgroup } from '../../utils/riskSubgroupHelpers';

const { Text } = Typography;

// 完整掃描資料集時，單一欄位最多快取幾個相異值 (依出現次數由高到低排序後截斷)，避免誤把
// 高基數欄位 (如流水號、自由文字) 當類別型欄位時，掃描結果佔用過多記憶體或選單過長。
const MAX_CACHED_UNIQUE_VALUES_PER_COLUMN = MAX_TOP_VALUES_PER_COLUMN;

/**
 * 函數名稱: RiskSubgroupFilterPanel
 * 函數功能: 渲染「限定特定族群評估風險 (選填)」設定面板，讓使用者可選擇 0 至多個欄位、
 *           各自填寫數值/日期範圍或從清單勾選類別允許值，寫入全域 WorkspaceStore 供 Step4
 *           組裝風險評估設定檔時讀取。與隱私保護模式 (K-匿名／差分隱私) 無關，故獨立於
 *           KAnonymityRules／DifferentialPrivacyRules 之外，由 Step3_Rules.tsx 共用渲染一份。
 *           掛載時會觸發一次完整資料集掃描 (若尚未掃描過)，取得類別型欄位之真實相異值。
 *
 * 輸入參數 (Input): 無 (React 無參數 Functional Component)
 * 輸出參數 (Output): 無
 * 返回值 (Return): React.ReactElement
 * 呼叫關係 (Call Relations): 被 Step3_Rules.tsx 載入渲染
 *
 * 規範對照: 符合規範 b) 函數開頭註記完整 5 大要素
 */
export default function RiskSubgroupFilterPanel(): React.ReactElement {
    const { t: translate } = useTranslation();

    const datasetColumnsListArray = useWorkspaceStore((state) => state.columns);
    const currentPrivacyModeTypeStr = useWorkspaceStore((state) => state.privacyMode);
    const columnTypesMapDict = useWorkspaceStore((state) => state.columnTypes);
    const dpFieldsListArray = useWorkspaceStore((state) => state.dpFields);
    const riskSubgroupFiltersMapDict = useWorkspaceStore((state) => state.riskSubgroupFilters);
    const executeSetRiskSubgroupFiltersAction = useWorkspaceStore((state) => state.setRiskSubgroupFilters);

    // ★ 完整資料集（不受 Step1 預覽 1000 筆上限）各欄位的常見值快取與掃描進行中狀態。
    // ★ 2026-09-30：改由 utils/datasetProfile.ts 統一掃描一次（同一份檔案在 Step2～Step4 共用），
    //   結果的前 1000 個常見值寫入 columnCategoricalUniqueValues，本組件不再另外完整 Papa.parse。
    const columnCategoricalUniqueValuesMapDict = useWorkspaceStore((state) => state.columnCategoricalUniqueValues);
    const isColumnCategoricalValuesScanningStatus = useWorkspaceStore((state) => state.isColumnCategoricalValuesScanning);
    useEnsureDatasetProfile();

    const configuredColumnNamesListArray = Object.keys(riskSubgroupFiltersMapDict);
    const availableColumnNamesListArray = datasetColumnsListArray.filter(
        (columnNameString) => !configuredColumnNamesListArray.includes(columnNameString)
    );

    const handleAddConditionClick = (): void => {
        if (availableColumnNamesListArray.length === 0) return;
        const newlyPickedColumnNameString = availableColumnNamesListArray[0];
        const newConditionKind = resolveColumnKindForSubgroup(newlyPickedColumnNameString, currentPrivacyModeTypeStr, columnTypesMapDict, dpFieldsListArray);
        const newConditionRecord: RiskSubgroupCondition = newConditionKind === 'range' ? { kind: 'range', min: '', max: '' } : { kind: 'categorical', values: [] };
        executeSetRiskSubgroupFiltersAction({ ...riskSubgroupFiltersMapDict, [newlyPickedColumnNameString]: newConditionRecord });
    };

    const handleRemoveConditionClick = (columnNameString: string): void => {
        const updatedFiltersMapDict = { ...riskSubgroupFiltersMapDict };
        delete updatedFiltersMapDict[columnNameString];
        executeSetRiskSubgroupFiltersAction(updatedFiltersMapDict);
    };

    const handleColumnChangeForCondition = (oldColumnNameString: string, newColumnNameString: string): void => {
        if (oldColumnNameString === newColumnNameString) return;
        const updatedFiltersMapDict = { ...riskSubgroupFiltersMapDict };
        delete updatedFiltersMapDict[oldColumnNameString];
        const newConditionKind = resolveColumnKindForSubgroup(newColumnNameString, currentPrivacyModeTypeStr, columnTypesMapDict, dpFieldsListArray);
        updatedFiltersMapDict[newColumnNameString] = newConditionKind === 'range' ? { kind: 'range', min: '', max: '' } : { kind: 'categorical', values: [] };
        executeSetRiskSubgroupFiltersAction(updatedFiltersMapDict);
    };

    const handleRangeBoundChange = (columnNameString: string, boundKey: 'min' | 'max', newValueStr: string): void => {
        const existingConditionRecord = riskSubgroupFiltersMapDict[columnNameString];
        if (!existingConditionRecord || existingConditionRecord.kind !== 'range') return;
        executeSetRiskSubgroupFiltersAction({
            ...riskSubgroupFiltersMapDict,
            [columnNameString]: { ...existingConditionRecord, [boundKey]: newValueStr }
        });
    };

    const handleCategoricalValuesChange = (columnNameString: string, newValuesListArray: string[]): void => {
        executeSetRiskSubgroupFiltersAction({
            ...riskSubgroupFiltersMapDict,
            [columnNameString]: { kind: 'categorical', values: newValuesListArray }
        });
    };

    return (
        <Card
            size="small"
            title={
                <Space size={6}>
                    <FilterOutlined />
                    <span>{translate('step3_subgroup.title', '只想評估某一群人的風險？（選填）')}</span>
                    <Tooltip
                        title={
                            <div>
                                <div>{translate('step3_subgroup.tooltip_p1', '不設定的話，風險評估會用「全部資料」來算；設定之後，只會針對你圈出的這群人來算。')}</div>
                                <div style={{ marginTop: 4 }}>{translate('step3_subgroup.tooltip_p2', '這裡的設定不會改變去識別化後產生的資料，只是讓風險評估這個步驟聚焦在你關心的那群人身上。')}</div>
                                <div style={{ marginTop: 4 }}>{translate('step3_subgroup.tooltip_p3', '數字／日期欄位：填最小值、最大值（可只填一邊）。類別欄位：直接從清單勾選，不用手打。')}</div>
                                <div style={{ marginTop: 4 }}>{translate('step3_subgroup.tooltip_p4', '同時設定好幾個欄位時，要「全部條件都符合」才算是這群人。')}</div>
                            </div>
                        }
                    >
                        <QuestionCircleOutlined style={{ color: '#999', cursor: 'help' }} />
                    </Tooltip>
                    {isColumnCategoricalValuesScanningStatus && (
                        <Tooltip title={translate('step3_subgroup.scanning_hint', '正在完整掃描資料集以建立各欄位可選值清單，大型檔案可能需要一些時間...')}>
                            <Spin size="small" />
                        </Tooltip>
                    )}
                </Space>
            }
            extra={
                <Button
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={handleAddConditionClick}
                    disabled={availableColumnNamesListArray.length === 0}
                >
                    {translate('step3_subgroup.add_condition', '新增限定條件')}
                </Button>
            }
            style={{ borderRadius: 8 }}
        >
            {/* ★ 修正：使用者反映本面板的標題與說明過於術語化，看不出「為什麼要設定這個
                欄位」。原本的用途說明只藏在滑鼠 hover 才看得到的 "?" 提示裡，容易被忽略。
                改為在卡片內固定顯示一行白話說明（不需 hover 就看得到），用具體情境（例如
                「某地區的罕見疾病患者」）解釋：整體資料的風險可能很低，但其中一小群人的風險
                可能高出很多，這裡就是用來「只看這一小群人」的風險。原本 hover 才看得到的
                tooltip 內容則簡化用字、保留較細節的操作說明。 */}
            <div style={{ fontSize: 12, color: '#888', marginBottom: 12, lineHeight: 1.6 }}>
                {translate(
                    'step3_subgroup.why_hint',
                    '整體資料看起來風險很低，不代表其中某一小群人也一樣安全——例如某地區的罕見疾病患者，人數少、特徵少，反而更容易被認出來。想確認「這一小群人」風不風險，可以在這裡設條件，只針對他們評估。不設定就是評估「全部資料」。'
                )}
            </div>
            {configuredColumnNamesListArray.length === 0 ? (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={translate('step3_subgroup.empty_state', '目前尚未設定，風險評估將以「全部資料」進行')}
                    style={{ margin: '8px 0' }}
                />
            ) : (
                <Space direction="vertical" style={{ width: '100%' }} size={12}>
                    {configuredColumnNamesListArray.map((columnNameString) => {
                        const conditionRecord = riskSubgroupFiltersMapDict[columnNameString];
                        const isTemporalColumnStatus = isColumnTemporalForSubgroup(columnNameString, currentPrivacyModeTypeStr, columnTypesMapDict, dpFieldsListArray);
                        const columnSelectOptionsListArray = [columnNameString, ...availableColumnNamesListArray].map((c) => ({ value: c, label: c }));
                        const columnCachedUniqueValuesListArray = columnCategoricalUniqueValuesMapDict[columnNameString] || [];
                        const isUniqueValuesTruncatedStatus = columnCachedUniqueValuesListArray.length >= MAX_CACHED_UNIQUE_VALUES_PER_COLUMN;

                        return (
                            <div key={columnNameString} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                                <Select
                                    size="small"
                                    value={columnNameString}
                                    style={{ width: 160 }}
                                    options={columnSelectOptionsListArray}
                                    onChange={(newColumnNameString) => handleColumnChangeForCondition(columnNameString, newColumnNameString)}
                                />
                                {conditionRecord.kind === 'range' ? (
                                    <Space size={4}>
                                        <Input
                                            size="small"
                                            style={{ width: 140 }}
                                            placeholder={isTemporalColumnStatus ? translate('step3_subgroup.range_min_date_placeholder', '下限日期（可留空）') : translate('step3_subgroup.range_min_placeholder', '下限（可留空）')}
                                            value={conditionRecord.min ?? ''}
                                            onChange={(e) => handleRangeBoundChange(columnNameString, 'min', e.target.value)}
                                        />
                                        <span>~</span>
                                        <Input
                                            size="small"
                                            style={{ width: 140 }}
                                            placeholder={isTemporalColumnStatus ? translate('step3_subgroup.range_max_date_placeholder', '上限日期（可留空）') : translate('step3_subgroup.range_max_placeholder', '上限（可留空）')}
                                            value={conditionRecord.max ?? ''}
                                            onChange={(e) => handleRangeBoundChange(columnNameString, 'max', e.target.value)}
                                        />
                                    </Space>
                                ) : (
                                    <div style={{ minWidth: 240, flex: 1 }}>
                                        {/* ★ 修正：改用 mode="multiple"（而非原本的 "tags"）——只能勾選 options 清單內的值，
                                            不再接受使用者自由輸入新文字，從根本避免「打的值跟資料集實際內容對不上」的問題。
                                            清單來源為完整掃描資料集之相異值（見上方 useEffect），而非僅前 1000 筆預覽。 */}
                                        <Select
                                            mode="multiple"
                                            size="small"
                                            style={{ width: '100%' }}
                                            placeholder={
                                                isColumnCategoricalValuesScanningStatus
                                                    ? translate('step3_subgroup.categorical_placeholder_scanning', '正在掃描資料集，請稍候...')
                                                    : translate('step3_subgroup.categorical_placeholder', '從清單中勾選允許的值')
                                            }
                                            value={conditionRecord.values}
                                            onChange={(newValuesListArray) => handleCategoricalValuesChange(columnNameString, newValuesListArray)}
                                            loading={isColumnCategoricalValuesScanningStatus}
                                            disabled={isColumnCategoricalValuesScanningStatus}
                                            options={columnCachedUniqueValuesListArray.map((valueStr) => ({ value: valueStr, label: valueStr }))}
                                            optionFilterProp="label"
                                            notFoundContent={translate('step3_subgroup.categorical_no_options', '此欄位在資料集中找不到任何可用值')}
                                        />
                                        {isUniqueValuesTruncatedStatus && (
                                            <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                                                {translate('step3_subgroup.categorical_truncated_hint', '此欄位相異值較多，僅列出最常見的前 1000 個。')}
                                            </div>
                                        )}
                                    </div>
                                )}
                                <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => handleRemoveConditionClick(columnNameString)}
                                />
                            </div>
                        );
                    })}
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        {translate('step3_subgroup.multi_column_hint', '同時設定多個欄位時，須「同時符合」所有欄位的條件才算入選（交集）。')}
                    </Text>
                </Space>
            )}
        </Card>
    );
}
