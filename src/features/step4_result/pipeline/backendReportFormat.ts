/** Step4「後端處理報告明細」（BackendReportDetails.tsx）用的顯示文字轉換。欄位定義見後端 2_操作說明.md 2-5／3-5 節。 */
import type { DpPerColumnBudgetReport } from '../../../api/apiService';

/** 報告項目可能是字串或物件，一律轉成可讀文字 */
export const formatReportListItem = (reportItem: unknown): string =>
    typeof reportItem === 'string' ? reportItem : JSON.stringify(reportItem);

export const MECHANISM_LABELS: Record<string, string> = {
    DiscreteLaplace: '離散型 Laplace', DiscreteGaussian: '離散型 Gaussian', 'k-RR': 'k-RR（隨機回應）', Laplace: 'Laplace', Gaussian: 'Gaussian'
};
export const COLUMN_TYPE_LABELS: Record<string, string> = { continuous: '連續數值', categorical: '類別', datetime: '日期時間' };
export const OUT_OF_BOUNDS_LABELS: Record<string, string> = { clamp: '截斷 (clamp)', fold: '鏡像 (fold)', wrap: '環繞 (wrap)' };
export const NOISE_UNIT_LABELS: Record<string, string> = { day: '天', hour: '時', minute: '分', second: '秒' };

/** 刻度欄：連續值為 minimum_unit，日期為「noise_step 個 noise_unit」，類別為「-」 */
export const describeDpColumnStep = (columnReport: DpPerColumnBudgetReport): string => {
    if (columnReport.type === 'datetime') {
        const unitText = NOISE_UNIT_LABELS[columnReport.noise_unit ?? 'day'] ?? columnReport.noise_unit ?? '天';
        return `${columnReport.noise_step ?? 1} ${unitText}`;
    }
    if (columnReport.type === 'continuous') return String(columnReport.minimum_unit ?? 1);
    return '-';
};
