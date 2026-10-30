/**
 * ============================================================================
 * 檔案名稱 (File): PipelineElapsedText.tsx
 * 模組功能 (Description): 運算中顯示「已等待 mm:ss」。
 * ============================================================================
 * ★ 2026-10-30：大資料運算時後端不回報進度，畫面長時間停在同一個百分比，使用者以為當掉。
 *   每秒更新一次已等待時間，表示仍在進行。
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const ELAPSED_REFRESH_INTERVAL_MS = 1000;

const formatElapsed = (elapsedSeconds: number): string => {
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;
    const pad = (value: number) => String(value).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
};

interface PipelineElapsedTextProps {
    startedAtMs: number;
    style?: React.CSSProperties;
}

export const PipelineElapsedText = ({ startedAtMs, style }: PipelineElapsedTextProps) => {
    const { t: translate } = useTranslation();
    const [nowMs, setNowMs] = useState(() => Date.now());

    useEffect(() => {
        const timerId = setInterval(() => setNowMs(Date.now()), ELAPSED_REFRESH_INTERVAL_MS);
        return () => clearInterval(timerId);
    }, []);

    const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
    return (
        <div style={style} data-testid="pipeline-elapsed">
            {translate('step4.loading.elapsed', '已等待 {{elapsed}}（資料量大時可能需要數分鐘，請勿關閉視窗）', { elapsed: formatElapsed(elapsedSeconds) })}
        </div>
    );
};
