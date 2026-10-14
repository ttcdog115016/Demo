/**
 * ============================================================================
 * 檔案名稱 (File): DatasetScaleHint.tsx
 * 模組功能 (Description): Step3「保護強度」下方的資料規模提示（K-匿名／差分隱私共用）。
 * ============================================================================
 * ★ 2026-10-08 諮詢會（郭博鈞執行長）：同一個 K 值套用在筆數差異很大的資料上，安全程度不同，
 *   應把資料筆數納入考量。此元件只做提示、不阻擋操作；分級門檻見 utils/datasetScaleHint.ts（暫定）。
 */
import { Tooltip, theme } from 'antd';
import { DatabaseOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import {
    classifyDatasetScale, computeKGroupShare, formatSharePercentText,
    DATASET_SCALE_SMALL_MAX_ROWS, DATASET_SCALE_LARGE_MIN_ROWS
} from '../utils/datasetScaleHint';
import { scaleFontSize } from '../utils/fontScale';

interface DatasetScaleHintProps
{
    mode: 'k-anonymity' | 'differential-privacy';
    /** 資料總筆數（0 代表尚未載入） */
    rowCount: number;
    /** K-匿名模式的 K 值 */
    kValue?: number;
}

export default function DatasetScaleHint({ mode, rowCount, kValue }: DatasetScaleHintProps): React.ReactElement | null
{
    const { token } = theme.useToken();
    const { t: translate } = useTranslation();
    const scaleLevel = classifyDatasetScale(rowCount);
    if (scaleLevel === 'unknown') return null;

    const rowsText = rowCount.toLocaleString();
    const isAttentionStatus = scaleLevel !== 'medium';

    let summaryText: string;
    let adviceText: string;
    if (mode === 'k-anonymity')
    {
        const shareInfo = computeKGroupShare(kValue, rowCount);
        summaryText = shareInfo
            ? translate('step3.scale_k_summary', '資料共 {{rows}} 筆；K = {{k}} 時，每群至少佔全部資料的 {{share}}（最多約 {{groups}} 群）。', {
                rows: rowsText, k: kValue, share: formatSharePercentText(shareInfo.groupSharePercent), groups: shareInfo.maxGroupCount.toLocaleString()
            })
            : translate('step3.scale_rows_only', '資料共 {{rows}} 筆。', { rows: rowsText });
        adviceText = scaleLevel === 'small'
            ? translate('step3.scale_k_small', '資料量較少：每一群佔的比例高，需要較多泛化或刪除才能湊滿，請在 Step4 確認刪除筆數；若資料只涵蓋小範圍（例如單一村里），熟悉當地的人較容易認出，可考慮提高保護強度。')
            : scaleLevel === 'large'
                ? translate('step3.scale_k_large', '資料量很大：同一個 K 值，每群只佔全部資料極小的比例。若接收資料的一方握有其他大型資料可交叉比對（例如主管機關），被對上的機會較高，可考慮選「加強」或「嚴格」。')
                : translate('step3.scale_k_medium', '同一個 K 值在不同規模的資料中，代表的保護程度並不相同，請一併參考 Step4 的風險評估結果。');
    }
    else
    {
        summaryText = translate('step3_dp.scale_summary', '資料共 {{rows}} 筆。加入的雜訊大小與筆數無關：筆數越少，雜訊對統計結果的影響越大。', { rows: rowsText });
        adviceText = scaleLevel === 'small'
            ? translate('step3_dp.scale_small', '資料量較少：平均數、總數等統計誤差會明顯變大，分組統計時誤差更大，請在 Step4 確認資料可用性。')
            : scaleLevel === 'large'
                ? translate('step3_dp.scale_large', '資料量很大：雜訊對整體統計的影響相對小，但分組後筆數很少的群組，誤差仍然很大。')
                : translate('step3_dp.scale_medium', '分組後筆數很少的群組，誤差會比整體統計大。');
    }

    const thresholdTipText = translate('step3.scale_threshold_tip', '規模分級：未滿 {{small}} 筆為小型、{{large}} 筆以上為大型。此分級為暫定參考值，僅用於提示，不影響處理結果。', {
        small: DATASET_SCALE_SMALL_MAX_ROWS.toLocaleString(), large: DATASET_SCALE_LARGE_MIN_ROWS.toLocaleString()
    });

    return (
        <div
            data-testid="dataset-scale-hint"
            data-scale-level={scaleLevel}
            style={{
                marginTop: 14, padding: '10px 12px', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-start',
                background: isAttentionStatus ? token.colorWarningBg : token.colorFillQuaternary,
                border: `1px solid ${isAttentionStatus ? token.colorWarningBorder : token.colorBorderSecondary}`,
            }}
        >
            <DatabaseOutlined style={{ marginTop: 3, color: isAttentionStatus ? token.colorWarning : token.colorTextSecondary }} />
            <div style={{ fontSize: scaleFontSize(13), lineHeight: 1.6, color: token.colorText }}>
                <div>
                    <span style={{ fontWeight: 600 }}>{translate('step3.scale_title', '資料規模')}</span>
                    <Tooltip title={thresholdTipText}>
                        <QuestionCircleOutlined style={{ marginLeft: 4, color: token.colorTextDescription, cursor: 'help' }} />
                    </Tooltip>
                    <span style={{ marginLeft: 8 }}>{summaryText}</span>
                </div>
                <div style={{ marginTop: 2, color: token.colorTextSecondary }}>{adviceText}</div>
            </div>
        </div>
    );
}
