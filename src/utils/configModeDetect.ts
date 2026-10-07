/**
 * 檔案用途: 判斷匯入的 JSON 設定檔屬於哪一種隱私模式（K-匿名化／差分隱私），
 *           供 Step2 兩個欄位設定頁面在匯入前擋下「模式不符」的設定檔。
 *
 * ★ 2026-10-02：使用者反映 K-匿名 Step2「匯入 JSON 設定檔」可以匯入差分隱私的設定檔且不報錯。
 *   根因：K-匿名匯入會退回讀取頂層 field_attributes／columns，DP 舊版匯出檔（final_privacy_config_*.json）
 *   兩者都有，於是被當成 K-匿名設定「成功匯入」。改為匯入前先判斷模式，不符即報錯、不寫入任何設定。
 */

export type DetectedConfigMode = 'k-anonymity' | 'differential-privacy' | 'unknown';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmpty = (value: unknown): boolean =>
    Array.isArray(value) ? value.length > 0 : isPlainObject(value) ? Object.keys(value).length > 0 : false;

/**
 * 函數名稱: detectConfigPrivacyMode
 * 函數功能: 依設定檔中的模式標記判斷其隱私模式。
 *   差分隱私標記：頂層 differential_privacy 區塊（後端 v1.2.0 大包）、column_budgets、
 *                 非空的 differential_privacy_rules、privacy_targets.differential_privacy.enabled=true、
 *                 privacy_mode='differential-privacy'、整份為陣列（DP 欄位規則陣列格式）。
 *   K-匿名標記：頂層 k_anonymity 區塊、privacy_targets.k_anonymity.enabled=true、privacy_mode='k-anonymity'、
 *               非空的 masking_rules／generalization_rules／generalization_matrices／qi_generalization_levels。
 * 返回值: 只有單一模式的標記時回傳該模式；兩者皆有或皆無時回傳 'unknown'（交由各頁面原本的格式判斷處理）。
 */
export const detectConfigPrivacyMode = (parsedJson: unknown): DetectedConfigMode => {
    if (Array.isArray(parsedJson)) return 'differential-privacy';
    if (!isPlainObject(parsedJson)) return 'unknown';

    const privacyTargets = isPlainObject(parsedJson.privacy_targets) ? parsedJson.privacy_targets : {};
    const legacyDpTarget = isPlainObject(privacyTargets.differential_privacy) ? privacyTargets.differential_privacy : {};
    const legacyKTarget = isPlainObject(privacyTargets.k_anonymity) ? privacyTargets.k_anonymity : {};

    const hasDpMarker =
        isPlainObject(parsedJson.differential_privacy) ||
        isPlainObject(parsedJson.column_budgets) ||
        isNonEmpty(parsedJson.differential_privacy_rules) ||
        legacyDpTarget.enabled === true ||
        parsedJson.privacy_mode === 'differential-privacy';

    const hasKMarker =
        isPlainObject(parsedJson.k_anonymity) ||
        legacyKTarget.enabled === true ||
        parsedJson.privacy_mode === 'k-anonymity' ||
        isNonEmpty(parsedJson.masking_rules) ||
        isNonEmpty(parsedJson.generalization_rules) ||
        isNonEmpty(parsedJson.generalization_matrices) ||
        isNonEmpty(parsedJson.qi_generalization_levels);

    if (hasDpMarker && !hasKMarker) return 'differential-privacy';
    if (hasKMarker && !hasDpMarker) return 'k-anonymity';
    return 'unknown';
};
