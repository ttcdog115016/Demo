/**
 * 去識別化設定檔（config.json）與表單參數的組裝邏輯。
 *
 * 2026-09-30 自 Step4_Result.tsx 的 runFullPipeline 原封不動搬出（函式本體未改寫，
 * 只把元件內的 state 改成參數傳入），讓組裝結果可單獨測試。各段落的 ★ 註解保留原本的修正脈絡。
 */
import { mapOutOfBoundsStrategyToBackend, resolveIsDateTimeDpField } from './dpFieldHelpers';
import { TEMPORAL_GRANULARITY_UNITS } from './temporalGranularity';

/** Step2／Step3 存在 useWorkspaceStore.dpFields 的單一欄位設定 */
export interface DpStoreField {
    enabled?: boolean;
    fieldName: string;
    fieldType?: string;
    epsilon?: number | string;
    delta?: number | string;
    upperBound?: number | string;
    lowerBound?: number | string;
    outOfBoundsStrategy?: 'clip' | 'wrap' | 'reflect';
    minimumUnit?: number;
    noiseStep?: number;
    /** epsilon＝純 ε（送 delta_budget 0）；epsilon-delta＝送該欄 δ；default-delta＝不送 delta_budget、由 default_delta 補足 */
    mode?: 'epsilon' | 'epsilon-delta' | 'default-delta';
    /** 使用者指定（或自設定檔匯入）的敏感度；未指定時以邊界寬度計算，見 resolveDpSensitivity */
    sensitivity?: number | string;
    /** 匯入設定檔時依 type 記錄的日期時間型標記；未設定時依欄位名稱推斷，見 resolveIsDateTimeDpField */
    isDateTime?: boolean;
}

/** Step3 的 K-匿名參數（對應 useWorkspaceStore 同名欄位） */
export interface KAnonymityPipelineSettings {
    kValue: number;
    lValue: number;
    tValue: number;
    enableLDiversity: boolean;
    enableTCloseness: boolean;
    maxSuppression: number | null | undefined;
    suppressionMethod: string | null | undefined;
    cellFillMethod: 'star' | 'missing' | null | undefined;
    limitExceededAction: string | null | undefined;
}

export interface KAnonymityConfigInput extends KAnonymityPipelineSettings {
    /** 實際要處理的欄位名稱（可能帶 BOM／零寬空白，函式內會清理） */
    processedColumnNames: string[];
    /** useWorkspaceStore.kAnonymityFields */
    kAnonymityFields: unknown[];
    /** useWorkspaceStore.kAnonymityHierarchies */
    kAnonymityHierarchies: unknown[];
    /** 欄位不在 kAnonymityFields 時，改用畫面判定的角色（'Identifier'／'Quasi-identifier'／'Sensitive'／其他） */
    resolveFallbackUiRole: (cleanColumnName: string) => string;
}

export interface DifferentialPrivacyConfigInput {
    dpFields: DpStoreField[] | null | undefined;
    columnTypes: Record<string, unknown> | null | undefined;
    accumulatedEpsilon: number | null | undefined;
    accumulatedDelta: number | null | undefined;
    targetDelta: number | null | undefined;
}

const isCellSuppressionMethod = (suppressionMethod: string | null | undefined): boolean =>
    suppressionMethod === 'cell' || suppressionMethod === 'cell_suppression';

/** 組 K-匿名 config.json（v1.2.0「大包」格式，全部參數包在 k_anonymity 區塊內） */
export const buildKAnonymityConfig = (input: KAnonymityConfigInput): Record<string, unknown> => {
    const {
        processedColumnNames: actualProcessedColumnsList,
        kAnonymityFields: kAnonymityFieldsList,
        kAnonymityHierarchies: kAnonymityHierarchiesList,
        resolveFallbackUiRole,
        kValue: currentKValueNumber,
        lValue: currentLValueNumber,
        tValue: currentTValueNumber,
        enableLDiversity: isEnableLDiversityStatus,
        enableTCloseness: isEnableTClosenessStatus,
        maxSuppression: currentMaxSuppressionNumber,
        suppressionMethod: currentSuppressionMethodStr,
        cellFillMethod: currentCellFillMethodStr,
        limitExceededAction: currentLimitExceededActionStr
    } = input;

    const columnsMap: Record<string, { role: string; type: string; strategy?: string; mask_mode?: string; mask_char?: string; }> = {};
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
        // ★ 依實際後端原始碼核對 (app/core/config.py ColumnInfo)：字串型 QI 遮蔽的
        // mode／char 是欄位上的「平面」屬性 (mask_mode／mask_char)，並非包在
        // generalization_hierarchies 底下；下面於 string 分支賦值，最後併入
        // columnsMap[cleanName]。
        let qiMaskModeValue: string | undefined = undefined;
        let qiMaskCharValue: string | undefined = undefined;

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
                // ★ 使用者反映：匯入 config_kanon.json 後，明明原始檔案的 qi_generalization_levels
                // 只列出「地區」「職業」兩個類別型欄位，但實際送給後端的設定檔卻多出「年齡」
                // 「薪資」「就醫次數」這三個數值型欄位、且層級被誤設為 2。原因是這裡先前不分
                // 型態，對每個間接識別碼欄位一律寫入 qi_generalization_levels，若欄位不在匯入檔
                // 內就退回預設值 2。但依 2_操作說明.md 4-1 節「數值型間接識別碼的切法已由
                // bins／rounding 寫死，不吃層級」——數值型欄位的泛化完全由 generalization_hierarchies
                // 決定，本來就不應該出現在 qi_generalization_levels 裡。這裡改為僅在「非數值型」
                // (類別型的階層樹、時間型的時間粒度) 才寫入層級，數值型欄位一律不寫。
                if (colType !== 'numeric') {
                    // ★ 使用者反映：字串「依字串長度」策略只要調「參數設定」(bin_size) 就好，
                    // 不需要額外調「最大層級」；Step2 UI 已把這個策略的層級固定為 1（見
                    // KAnonymityMapping.tsx 之 STRING_LENGTH_STRATEGY_FIXED_LEVEL），這裡
                    // 送給後端的層級數字比照辦理、強制固定為 1，不論欄位當下實際存的
                    // genMaxLevel 是多少，避免殘留切換策略前的舊層級數字被誤送出去。
                    qiGeneralizationLevelsMap[cleanName] = (colType === 'string' && matchedField.genStrategy === 'length')
                        ? 1
                        : (typeof matchedField.genMaxLevel === 'number' ? Math.floor(matchedField.genMaxLevel) : 0);
                }

                // 讀取使用者於 Step2「泛化階層對照」分頁實際填寫的自訂區間，
                // 而非寫死的假資料；策略值須對齊 KAnonymityMapping.tsx 實際儲存的
                // 'custom_bins'（'binning' 只是匯入舊版 JSON 時的相容別名，
                // 不會是欄位實際被選取後的儲存值，故先前用它比對永遠不會成立）。
                // ★ 修正 (依實際後端原始碼核對): 後端數值型泛化 (NumericalGeneralizer)
                // 完全不吃「泛化層級」這個概念——只要設定檔有給 bins 或 rounding 就套用，
                // 沒給就不套用，qi_generalization_levels 的數字對數值型欄位而言從未有
                // 任何作用（pipeline.py 對數值欄位上設定的 level 僅發出警告並忽略）。
                // 先前這裡曾誤加一個「genMaxLevel>=1 才送出」的開關，等於是無中生有一個
                // 後端根本不認得的「啟用」語意；故移除該開關，只要使用者選了策略且填了
                // 有效參數就一律送出。
                if (colType === 'numeric' && matchedField.genStrategy === 'custom_bins') {
                    const rawCustomBinsList = matchedField.customBins as
                        { min: number | null; max: number | null; label: string }[] | undefined;

                    if (Array.isArray(rawCustomBinsList) && rawCustomBinsList.length > 0) {
                        generalizationHierarchiesMap[cleanName] = {
                            bins: rawCustomBinsList.map((binItemRecord) => ({
                                min: binItemRecord.min,
                                max: binItemRecord.max,
                                label: binItemRecord.label
                            }))
                        };
                    }
                } else if (colType === 'numeric' && matchedField.genStrategy === 'rounding') {
                    // 數值四捨五入：Step2 以 genParam 記錄捨入單位，先前同樣完全沒有寫入
                    // generalization_hierarchies——後端 NumericalGeneralizer 收不到
                    // "rounding" 就直接判定不泛化（維持原值），使用者設定形同虛設。
                    const roundingUnitValue = typeof matchedField.genParam === 'number'
                        ? matchedField.genParam
                        : Number(matchedField.genParam);

                    if (Number.isFinite(roundingUnitValue) && roundingUnitValue > 0) {
                        generalizationHierarchiesMap[cleanName] = { rounding: roundingUnitValue };
                    }
                }

                // 時間型間接識別欄位：Step2「時間粒度」（已合併日期粒度）與「時間區間」
                // 兩策略，先前完全沒有寫入 generalization_hierarchies——後端
                // DatetimeGeneralizer 收不到 levels 就直接判定「未泛化」（no_levels），
                // 使用者於 Step2 的設定形同虛設。比照上面數值自訂區間的修法補上實際串接。
                if (colType === 'temporal' && matchedField.genStrategy === 'time_rounding') {
                    // 時間粒度：宣告前端可選的時間單位（分/時/日/月/年，細到粗），qi_generalization_levels 的
                    // 層級數字 N 即泛化到第 N 個單位（後端語意），與 KAnonymityMapping.tsx 之 Segmented 選項一一對應。
                    // ★ 2026-10-01：移除 second（層級改為 1～5），見 utils/temporalGranularity.ts。
                    generalizationHierarchiesMap[cleanName] = {
                        levels: [...TEMPORAL_GRANULARITY_UNITS]
                    };
                } else if (colType === 'temporal' && matchedField.genStrategy === 'time_range') {
                    // 時間區間：customBins 為使用者以 TimePicker 選取、已轉為「當日第幾分鐘」
                    // 的整數界線，後端 time_periods 的界線格式須為 HH:MM 字串，故於此轉換；
                    // 固定宣告到 hour 這一級以觸發後端套用 time_periods。
                    const rawTimeRangeBinsList = matchedField.customBins as
                        { min: number | null; max: number | null; label: string }[] | undefined;

                    if (Array.isArray(rawTimeRangeBinsList) && rawTimeRangeBinsList.length > 0) {
                        const formatMinutesOfDayAsHHMM = (totalMinutesValue: number): string => {
                            const wrappedMinutesValue = ((Math.round(totalMinutesValue) % 1440) + 1440) % 1440;
                            const hourTextValue = String(Math.floor(wrappedMinutesValue / 60)).padStart(2, '0');
                            const minuteTextValue = String(wrappedMinutesValue % 60).padStart(2, '0');
                            return `${hourTextValue}:${minuteTextValue}`;
                        };

                        generalizationHierarchiesMap[cleanName] = {
                            levels: ['hour'],
                            time_periods: rawTimeRangeBinsList.map((binItemRecord) => ({
                                min: binItemRecord.min === null ? null : formatMinutesOfDayAsHHMM(binItemRecord.min),
                                max: binItemRecord.max === null ? null : formatMinutesOfDayAsHHMM(binItemRecord.max),
                                label: binItemRecord.label
                            }))
                        };
                    }
                }

                // ★ 修正 (依實際後端原始碼核對，app/core/config.py ColumnInfo 與
                // strategies/masking.py、strategies/generalize.py)：文字型間接識別碼
                // 的「保留前後綴」／「依字串長度」兩種遮蔽策略，實際的遮蔽強度是由
                // qi_generalization_levels 既有的 level 數字換算出來，「參數設定」
                // (genParam) 對「保留前後綴」策略完全沒有作用：
                //   - 保留前後綴 (prefix/suffix)：keep_chars = max(5 - level, 1)，
                //     level 已於上方 qiGeneralizationLevelsMap 寫入，這裡只需標明
                //     mask_mode（前方對應 'prefix'，後方對應 'suffix'）與 mask_char；
                //   - 依字串長度 (length)：輸出並非遮蔽字元，而是把值換成一個長度區間
                //     標籤（例如 "5-9"），區間寬度 = bin_size × level，bin_size 才是
                //     genParam 對應的欄位，須寫在 generalization_hierarchies 底下
                //     （預設 5，與後端一致）。
                // 這裡先前的版本是尚未核對後端原始碼前的臆測鍵名 (mask_type／keep_chars／
                // direction／level／mask_count／preserve_length)，皆非後端實際欄位，
                // 已依上述核對結果全部改正。
                if (colType === 'string' && matchedField.genStrategy === 'prefix') {
                    qiMaskModeValue = matchedField.genDirection === 'back' ? 'suffix' : 'prefix';
                    qiMaskCharValue = '*';
                } else if (colType === 'string' && matchedField.genStrategy === 'length') {
                    qiMaskModeValue = 'length';
                    qiMaskCharValue = '*';

                    const binSizeBaseValue = typeof matchedField.genParam === 'number' ? matchedField.genParam : Number(matchedField.genParam);
                    generalizationHierarchiesMap[cleanName] = {
                        bin_size: Number.isFinite(binSizeBaseValue) && binSizeBaseValue > 0 ? binSizeBaseValue : 5
                    };
                }
            }
        } else {
            const uiRole = resolveFallbackUiRole(cleanName);
            if (uiRole === 'Identifier') backendRole = 'identifier';
            if (uiRole === 'Quasi-identifier') backendRole = 'quasi_identifier';
            if (uiRole === 'Sensitive') backendRole = 'sensitive';
        }

        columnsMap[cleanName] = {
            role: backendRole,
            type: colType,
            ...(maskStrategy ? { strategy: String(maskStrategy) } : {}),
            ...(qiMaskModeValue ? { mask_mode: qiMaskModeValue } : {}),
            ...(qiMaskCharValue ? { mask_char: qiMaskCharValue } : {})
        };
    });

    kAnonymityHierarchiesList.forEach((h: unknown) => {
        const hierarchyRecord = h as Record<string, unknown>;
        // ★ 修正：上面組 columnsMap／qiGeneralizationLevelsMap 時，欄位名稱一律先用
        //   cleanName = colName.replace(/^[\uFEFF\u200B]+/, '').trim() 去除殘留的
        //   BOM／零寬空白後才當 key；但這裡的 fieldName 先前是直接取
        //   hierarchyRecord.fieldName 原始字串，未做同樣的清理。一旦欄位名稱帶有
        //   這類不可見字元（即便已修正上傳端一律去 BOM，仍可能因既有專案檔、JSON
        //   匯入等途徑殘留），generalization_matrices 的 key 就會跟 columns／
        //   qi_generalization_levels 的 key 對不起來，導致後端 validate_config()
        //   判定「類別型間接識別欄位設定了泛化層級，但未於 generalization_matrices
        //   提供對應階層」而回 400。統一用同一套清理規則，確保三者 key 一致。
        const fieldName = (hierarchyRecord.fieldName as string || '').replace(/^[\uFEFF\u200B]+/, '').trim();
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
    return {
        k_anonymity: {
            enabled: true,
            k: currentKValueNumber,
            // l-多樣性／t-趨近性：依 2_操作說明.md 第 4-1 節，l／t 為選填欄位，
            // 「設定檔未提供 l/t 時不執行該檢測」；先前不論使用者是否需要都固定送出
            // lValue/tValue 的預設值，導致純 K-匿名使用者即使沒有指定敏感欄位，
            // 後端仍嘗試做 l/t 檢測，因無敏感屬性可供量測多樣性而 l_passed 永遠為
            // false，且與 l 值調整無關。現在僅在使用者於 Step3 實際打開對應開關時
            // 才送出這兩個欄位，關閉時完全不寫入，讓後端依規格略過該項檢測。
            ...(isEnableLDiversityStatus ? { l: currentLValueNumber } : {}),
            ...(isEnableTClosenessStatus ? { t: currentTValueNumber } : {}),
            suppression_limit_percent: currentMaxSuppressionNumber ?? 5,
            limit_exceeded_action: (currentLimitExceededActionStr || 'stop_and_error') as 'stop_and_error' | 'allow_with_warning',
            suppression_method: (currentSuppressionMethodStr === 'cell' || currentSuppressionMethodStr === 'cell_suppression' ? 'cell_suppression' : 'row_suppression') as 'row_suppression' | 'cell_suppression',
            // ★ cell_fill 僅在「值抑制」(cell_suppression) 模式下才有意義，未啟用時完全不送出，
            //   避免像上方 l／t 一樣把無效參數塞進設定檔造成誤解（見上方新增選單處的完整說明）。
            ...((currentSuppressionMethodStr === 'cell' || currentSuppressionMethodStr === 'cell_suppression') ? { cell_fill: currentCellFillMethodStr ?? 'star' } : {}),
            columns: columnsMap,
            ...(Object.keys(generalizationHierarchiesMap).length > 0 && { generalization_hierarchies: generalizationHierarchiesMap }),
            ...(Object.keys(generalizationMatricesMap).length > 0 && { generalization_matrices: generalizationMatricesMap }),
            ...(Object.keys(qiGeneralizationLevelsMap).length > 0 && { qi_generalization_levels: qiGeneralizationLevelsMap })
        }
    };
};

/** 組差分隱私 config.json（v1.2.0「大包」格式，全部參數包在 differential_privacy 區塊內） */
export const buildDifferentialPrivacyConfig = (input: DifferentialPrivacyConfigInput): Record<string, unknown> => {
    const {
        dpFields: currentDpFieldsListArray,
        columnTypes: currentColumnTypesMapDict,
        accumulatedEpsilon: dpAccumulatedEpsilonValue,
        accumulatedDelta: dpAccumulatedDeltaValue,
        targetDelta: globalTargetDeltaValue
    } = input;

    const columnBudgetsMap: Record<string, unknown> = {};
    
    currentDpFieldsListArray?.forEach((field: DpStoreField) => {
        if (field.enabled) {
            const isNumeric = field.fieldType === 'Numeric';
            const originalColType = String(currentColumnTypesMapDict?.[field.fieldName] || '').toLowerCase();
            // ★ 使用者反映：此處先前自行實作的日期時間判斷關鍵字（只有 date/time/生日/日期）
            //   與 Step2／Step3 共用的 isDateTimeDpField 不一致，birthday／dob／出生 等欄位名稱
            //   在 Step2 會被判定為日期時間型（顯示日期選擇器、邊界存為 ISO 日期字串），但在這裡
            //   卻仍被判定為一般連續數值型，導致送給後端的 sensitivity／clipping_bounds 對日期字串
            //   做 Number() 運算而得到 NaN。改為與 Step2／Step3 共用同一個判斷函式，避免分歧。
            const isDateTimeType = resolveIsDateTimeDpField(field, originalColType);

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
                // ★ 修正：先前不論使用者在 Step3 選的是「ε-DP」還是「(ε,δ)-DP」模式，一律照
                //   field.delta 的值送出；但 field.delta 的預設值是 1e-5（非 0），且切換回
                //   「ε-DP」模式時畫面只是把 δ 欄位隱藏，並不會把已儲存的 delta 歸零。導致幾乎
                //   每個選了「ε-DP」(純 ε，理論上應為 Laplace 機制) 的欄位，實際上都被送成
                //   非零 delta_budget，後端依 delta>0 判斷機制時會誤用 Gaussian，與使用者於
                //   Step3 的選擇不符。改為：只有明確選擇「(ε,δ)-DP」模式時才送出實際 delta
                //   值，其餘一律強制送 0，確保送出的機制與使用者畫面上的選擇一致。
                // ★ 2026-10-01：新增「沿用全域 δ」模式——不送 delta_budget，依後端 2_操作說明.md 4-2 節由 default_delta 補足
                //   （後端範例 config_dp.json 的就醫次數即是如此）；匯入設定檔時沒有 delta_budget 的欄位即為此模式。
                if (field.mode !== 'default-delta') {
                    baseBudgetConfig.delta_budget = field.mode === 'epsilon-delta' ? Number(field.delta || 0.0) : 0;
                }
                const hasValidBoundsStatus = field.upperBound !== undefined && field.lowerBound !== undefined && field.upperBound !== '' && field.lowerBound !== '';

                // ★ 使用者反映：Step2 設定的邊界(下限/上限)與每欄個別溢出處理策略，先前完全沒有送給
                //   後端，後端只收到用邊界差算出的 sensitivity，實際 clipping_bounds／
                //   out_of_bounds_strategy 從未寫入設定檔，等同使用者的邊界設定被忽略。依
                //   config_dp.json 範例格式補上；日期時間型欄位邊界為 ISO 日期字串，須用天數差
                //   計算 sensitivity，且對應的是 time_clipping_bounds／time_out_of_bounds_strategy
                //   （非數值型的 clipping_bounds／out_of_bounds_strategy）。
                if (mappedBackendType === 'datetime') {
                    if (hasValidBoundsStatus) {
                        const lowerDateTimestamp = Date.parse(String(field.lowerBound));
                        const upperDateTimestamp = Date.parse(String(field.upperBound));
                        if (!Number.isNaN(lowerDateTimestamp) && !Number.isNaN(upperDateTimestamp)) {
                            baseBudgetConfig.sensitivity = Math.round((upperDateTimestamp - lowerDateTimestamp) / 86400000);
                            baseBudgetConfig.time_clipping_bounds = [String(field.lowerBound), String(field.upperBound)];
                        }
                    }
                    applyExplicitDpSensitivity(baseBudgetConfig, field.sensitivity);
                    baseBudgetConfig.noise_unit = 'day';
                    if (field.noiseStep !== undefined) baseBudgetConfig.noise_step = Number(field.noiseStep);
                    baseBudgetConfig.time_out_of_bounds_strategy = mapOutOfBoundsStrategyToBackend(field.outOfBoundsStrategy);
                } else if (mappedBackendType === 'continuous') {
                    if (hasValidBoundsStatus) {
                        baseBudgetConfig.sensitivity = Number(field.upperBound) - Number(field.lowerBound);
                        baseBudgetConfig.clipping_bounds = [Number(field.lowerBound), Number(field.upperBound)];
                    }
                    applyExplicitDpSensitivity(baseBudgetConfig, field.sensitivity);
                    baseBudgetConfig.minimum_unit = field.minimumUnit ?? 1;
                    baseBudgetConfig.out_of_bounds_strategy = mapOutOfBoundsStrategyToBackend(field.outOfBoundsStrategy);
                }
            }

            columnBudgetsMap[field.fieldName] = baseBudgetConfig;
        }
    });
    
    // v1.2.0 後端要求「大包」格式：column_budgets／accumulated_epsilon／
    // accumulated_delta／default_delta 都要寫在 differential_privacy 區塊內、
    // enabled 設為 true。格式依據：docs/manual_test/config_dp.json
    // ★ accumulated_epsilon／accumulated_delta 送出「本次執行前」已累計之跨批次消耗值
    //   （非固定 0），default_delta 對應 Step3 全域目標 Delta；先前這三個欄位皆未正確送出。
    return {
        differential_privacy: {
            enabled: true,
            column_budgets: columnBudgetsMap,
            accumulated_epsilon: dpAccumulatedEpsilonValue ?? 0,
            accumulated_delta: dpAccumulatedDeltaValue ?? 0,
            default_delta: globalTargetDeltaValue ?? 0.0001
        }
    };
};

/** K-匿名 API 表單參數（與 config.json 的 k_anonymity 區塊規則一致：未啟用的 l／t、非值抑制時的 cell_fill 都不送） */
export const buildKAnonymityApiOptions = (settings: KAnonymityPipelineSettings) => ({
    k: settings.kValue,
    ...(settings.enableLDiversity ? { l: settings.lValue } : {}),
    ...(settings.enableTCloseness ? { t: settings.tValue } : {}),
    suppression_limit_percent: settings.maxSuppression ?? 5,
    suppression_method: (isCellSuppressionMethod(settings.suppressionMethod) ? 'cell_suppression' : 'row_suppression') as 'row_suppression' | 'cell_suppression',
    ...(isCellSuppressionMethod(settings.suppressionMethod) ? { cell_fill: (settings.cellFillMethod ?? 'star') as 'star' | 'missing' } : {}),
    limit_exceeded_action: (settings.limitExceededAction || 'stop_and_error') as 'stop_and_error' | 'allow_with_warning'
});

/** 差分隱私 API 表單參數：只放跨批次累計值（逐欄 ε／δ 在 config 的 column_budgets） */
export const buildDifferentialPrivacyApiOptions = (input: Pick<DifferentialPrivacyConfigInput, 'accumulatedEpsilon' | 'accumulatedDelta' | 'targetDelta'>) => ({
    accumulated_epsilon: input.accumulatedEpsilon ?? 0,
    accumulated_delta: input.accumulatedDelta ?? 0,
    default_delta: input.targetDelta ?? 0.0001
});

/**
 * 每個欄位實際送給後端的 ε／δ（直接取自 buildDifferentialPrivacyConfig 組出的 column_budgets，與送出內容保證一致）。
 * 只有已啟用欄位會出現；類別型與 ε-DP 模式欄位的 δ 為 0（不送或送 0），未填 ε 時與送出內容相同退回 1.0。
 */
export const computeDpConsumedBudgetsByField = (
    dpFields: DpStoreField[] | null | undefined, targetDelta?: number | null
): Record<string, { epsilon: number; delta: number }> => {
    const differentialPrivacyBlock = buildDifferentialPrivacyConfig({
        dpFields, columnTypes: {}, accumulatedEpsilon: 0, accumulatedDelta: 0, targetDelta
    }).differential_privacy as { default_delta: number; column_budgets: Record<string, { type?: string; epsilon_budget?: number; delta_budget?: number }> };
    const consumedBudgetsByField: Record<string, { epsilon: number; delta: number }> = {};
    Object.entries(differentialPrivacyBlock.column_budgets).forEach(([fieldName, budgetItem]) => {
        // 連續數值／日期欄位沒有 delta_budget 時由 default_delta 補足（後端 4-2 節）；類別型不使用 δ
        const isDefaultDeltaFilledStatus = budgetItem.delta_budget === undefined && (budgetItem.type === 'continuous' || budgetItem.type === 'datetime');
        consumedBudgetsByField[fieldName] = {
            epsilon: Number(budgetItem.epsilon_budget ?? 0),
            delta: isDefaultDeltaFilledStatus ? Number(differentialPrivacyBlock.default_delta) : Number(budgetItem.delta_budget ?? 0)
        };
    });
    return consumedBudgetsByField;
};

/**
 * 本次執行實際消耗的 ε／δ 總和（基本組合定理：逐欄直接相加）。
 * ★ 2026-10-01：δ 先前把所有已啟用欄位的 δ 都加進去（含類別型、ε-DP 模式欄位畫面上保留的預設 δ），
 *   但那些欄位實際送出的 δ 是 0；例如只有薪資一欄用 (ε,δ)-DP 時，送出 δ 合計 1e-5，這裡卻算成 3.1e-4。
 */
export const sumDpConsumedBudgets = (dpFields: DpStoreField[] | null | undefined, targetDelta?: number | null): { totalEpsilon: number; totalDelta: number } =>
    Object.values(computeDpConsumedBudgetsByField(dpFields, targetDelta)).reduce(
        (accumulator, budgetItem) => ({ totalEpsilon: accumulator.totalEpsilon + budgetItem.epsilon, totalDelta: accumulator.totalDelta + budgetItem.delta }),
        { totalEpsilon: 0, totalDelta: 0 }
    );

/** 後端未回報告時的預設消耗值（與實際送出的 column_budgets 一致）；沒有任何 ε 時退回 1.0 */
export const computeDpTotalBudgets = (dpFields: DpStoreField[] | null | undefined, targetDelta?: number | null): { totalEpsilonBudget: number; totalDeltaBudget: number } => {
    const { totalEpsilon, totalDelta } = sumDpConsumedBudgets(dpFields, targetDelta);
    return { totalEpsilonBudget: totalEpsilon || 1.0, totalDeltaBudget: totalDelta || 0 };
};

/** 有效的明確敏感度（大於 0 的有限數字）；未指定或無效時回傳 null */
export const parseExplicitDpSensitivity = (sensitivityValue: number | string | null | undefined): number | null => {
    if (sensitivityValue === undefined || sensitivityValue === null || sensitivityValue === '') return null;
    const parsedSensitivityValue = Number(sensitivityValue);
    return Number.isFinite(parsedSensitivityValue) && parsedSensitivityValue > 0 ? parsedSensitivityValue : null;
};

/**
 * 預設敏感度＝邊界寬度：數值型為「上限 − 下限」，日期時間型為兩日期相差天數。邊界不完整或無效時回傳 null。
 * 這是最保守的設定（任一筆值在邊界內任意變動都被涵蓋）；後端範例 config_dp.json 的敏感度另行指定、通常小於邊界寬度。
 */
export const computeDefaultDpSensitivity = (
    field: Pick<DpStoreField, 'lowerBound' | 'upperBound'>, isDateTimeField: boolean
): number | null => {
    if (field.upperBound === undefined || field.lowerBound === undefined || field.upperBound === '' || field.lowerBound === '') return null;
    if (isDateTimeField) {
        const lowerDateTimestamp = Date.parse(String(field.lowerBound));
        const upperDateTimestamp = Date.parse(String(field.upperBound));
        if (Number.isNaN(lowerDateTimestamp) || Number.isNaN(upperDateTimestamp)) return null;
        return Math.round((upperDateTimestamp - lowerDateTimestamp) / 86400000);
    }
    const boundWidthValue = Number(field.upperBound) - Number(field.lowerBound);
    return Number.isFinite(boundWidthValue) ? boundWidthValue : null;
};

/** 實際送出的敏感度：使用者有指定就用指定值，否則用邊界寬度 */
export const resolveDpSensitivity = (field: Pick<DpStoreField, 'lowerBound' | 'upperBound' | 'sensitivity'>, isDateTimeField: boolean): number | null =>
    parseExplicitDpSensitivity(field.sensitivity) ?? computeDefaultDpSensitivity(field, isDateTimeField);

// ★ 2026-10-01：後端範例 config_dp.json 的 sensitivity 與 clipping_bounds 分開指定（例如年齡邊界 0～120、
//   敏感度 71；生日邊界 1930～2026、敏感度 365 天）。先前前端一律以邊界寬度計算、匯入時也不讀取，
//   生日在 ε=1 時雜訊尺度約 97 年。改為使用者指定（或匯入）的值優先，未指定才用邊界寬度。
const applyExplicitDpSensitivity = (budgetConfig: Record<string, unknown>, sensitivityValue: number | string | null | undefined): void => {
    const explicitSensitivityValue = parseExplicitDpSensitivity(sensitivityValue);
    if (explicitSensitivityValue !== null) budgetConfig.sensitivity = explicitSensitivityValue;
};

/** 後端 config.json 的版本（docs/manual_test/config_*.json） */
export const BACKEND_CONFIG_VERSION = '1.2.0';

/** 把 k_anonymity 或 differential_privacy 區塊包成後端完整設定檔（version／dataset／input_format＋區塊） */
export const wrapBackendConfigDocument = (datasetFileName: string | null | undefined, privacyBlock: Record<string, unknown>): Record<string, unknown> => ({
    version: BACKEND_CONFIG_VERSION,
    dataset: datasetFileName || 'dataset.csv',
    // Step1 上傳 Excel 時已轉為 CSV，送給後端的一律是 CSV
    input_format: 'csv',
    ...privacyBlock
});

/** 工作區（useWorkspaceStore）中組設定檔會用到的欄位 */
export interface WorkspaceConfigSource {
    privacyMode: string | null | undefined;
    fileName?: string | null;
    columns?: string[] | null;
    columnRoles?: Record<string, string> | null;
    columnTypes?: Record<string, unknown> | null;
    kAnonymityFields?: unknown[] | null;
    kAnonymityHierarchies?: unknown[] | null;
    kValue: number; lValue: number; tValue: number;
    enableLDiversity: boolean; enableTCloseness: boolean;
    maxSuppression: number | null | undefined;
    suppressionMethod: string | null | undefined;
    cellFillMethod: 'star' | 'missing' | null | undefined;
    limitExceededAction: string | null | undefined;
    dpFields?: DpStoreField[] | null;
    dpAccumulatedEpsilon?: number | null;
    dpAccumulatedDelta?: number | null;
    targetDelta?: number | null;
}

/**
 * 依目前工作區設定組出後端完整設定檔（與 Step4 實際送出的內容相同組裝邏輯），供 Step3 匯出與 Step2 即時預覽使用。
 * 欄位不在 kAnonymityFields 時以 columnRoles 的畫面角色判定；隱私模式未選擇時回傳 null。
 */
export const buildBackendConfigDocumentFromWorkspace = (
    workspaceState: WorkspaceConfigSource,
    options: { resolveFallbackUiRole?: (cleanColumnName: string) => string } = {}
): Record<string, unknown> | null => {
    if (workspaceState.privacyMode === 'k-anonymity') {
        const kAnonymityFields = workspaceState.kAnonymityFields || [];
        const processedColumnNames = (workspaceState.columns && workspaceState.columns.length > 0)
            ? workspaceState.columns.map((columnName) => columnName.replace(/^[\uFEFF\u200B]+/, '').trim())
            : kAnonymityFields.map((fieldItem) => String((fieldItem as { name?: string }).name || '')).filter(Boolean);
        return wrapBackendConfigDocument(workspaceState.fileName, buildKAnonymityConfig({
            kValue: workspaceState.kValue, lValue: workspaceState.lValue, tValue: workspaceState.tValue,
            enableLDiversity: workspaceState.enableLDiversity, enableTCloseness: workspaceState.enableTCloseness,
            maxSuppression: workspaceState.maxSuppression, suppressionMethod: workspaceState.suppressionMethod,
            cellFillMethod: workspaceState.cellFillMethod, limitExceededAction: workspaceState.limitExceededAction,
            processedColumnNames,
            kAnonymityFields,
            kAnonymityHierarchies: workspaceState.kAnonymityHierarchies || [],
            resolveFallbackUiRole: options.resolveFallbackUiRole ?? ((cleanColumnName) => workspaceState.columnRoles?.[cleanColumnName] || 'Non-sensitive')
        }));
    }
    if (workspaceState.privacyMode === 'differential-privacy') {
        return wrapBackendConfigDocument(workspaceState.fileName, buildDifferentialPrivacyConfig({
            dpFields: workspaceState.dpFields,
            columnTypes: workspaceState.columnTypes,
            accumulatedEpsilon: workspaceState.dpAccumulatedEpsilon,
            accumulatedDelta: workspaceState.dpAccumulatedDelta,
            targetDelta: workspaceState.targetDelta
        }));
    }
    return null;
};
