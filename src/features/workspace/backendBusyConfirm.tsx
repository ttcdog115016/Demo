/**
 * ============================================================================
 * 檔案名稱 (File): backendBusyConfirm.tsx
 * 模組功能 (Description): 送出去識別化前的「上一筆運算可能還在進行」確認視窗（Step3→Step4、Step4「重新計算」共用）。
 * ============================================================================
 * ★ 2026-10-22：收到 524／504 後一段時間內再送出，提醒「上一筆可能還在後端執行」，避免請求在後端疊加排隊。
 * ★ 2026-10-29（TTC Wei 要求）：拔除差分隱私執行時間預估（原 dpSlowRunConfirm.tsx 的「預估會執行很久」提醒），
 *   只保留這個冷卻提醒；冷卻時間見 utils/backendBusyCooldown.ts。
 */
import { Button } from 'antd';
import type { useAppProps } from 'antd/es/app/context';
import type { TFunction } from 'i18next';

import { getBackendBusyReason, isBackendLikelyBusy } from '../../utils/backendBusyCooldown';

interface ConfirmIfBackendBusyParams {
    modalApi: useAppProps['modal'];
    translate: TFunction;
    proceedAction: () => void;
    /** 'navigate'：Step3 → Step4；'rerun'：Step4「重新計算」 */
    context: 'navigate' | 'rerun';
}

/**
 * 函數名稱: confirmIfBackendBusy
 * 函數功能: 上一筆可能還在後端執行（收到 524／504 後 5 分鐘內）時跳出確認視窗；否則直接執行 proceedAction。
 */
export const confirmIfBackendBusy = ({ modalApi, translate, proceedAction, context }: ConfirmIfBackendBusyParams): void => {
    if (!isBackendLikelyBusy()) {
        proceedAction();
        return;
    }

    const busyConfirmDialog = modalApi.confirm({
        title: translate('workspace.backend_busy_confirm_title', '上一筆運算可能還在進行'),
        width: '36em',
        closable: true,
        content: (
            <p style={{ marginBottom: 0 }} data-testid="backend-busy-notice">
                {getBackendBusyReason() === 'canceled'
                    ? translate('workspace.backend_busy_confirm_desc_canceled', '剛才取消的運算，後端可能仍在算完已開始的部分。現在送出會排在它後面，要等它結束才會開始；若不急，建議等幾分鐘再執行。')
                    : translate('workspace.backend_busy_confirm_desc_v2', '上一次執行等待太久被中斷，但後端通常仍會繼續算完。現在送出會排在它後面，可能一起逾時；建議等幾分鐘再執行。')}
            </p>
        ),
        footer: (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                <Button onClick={() => { busyConfirmDialog.destroy(); proceedAction(); }}>
                    {translate('workspace.heavy_run_confirm_continue', '仍要執行')}
                </Button>
                <Button type="primary" onClick={() => busyConfirmDialog.destroy()}>
                    {context === 'navigate'
                        ? translate('workspace.heavy_run_confirm_back', '返回調整')
                        : translate('workspace.heavy_run_confirm_wait', '先不要執行')}
                </Button>
            </div>
        )
    });
};
