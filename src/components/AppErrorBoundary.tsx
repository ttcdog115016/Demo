/**
 * ============================================================================
 * 檔案名稱 (File): AppErrorBoundary.tsx
 * 模組功能 (Description): 全域錯誤邊界。任何元件在渲染時拋出例外，React 預設會把整個畫面卸載
 *   （變成整頁空白、看不到任何訊息）。此元件攔截例外，改為顯示錯誤訊息與「重新載入／複製錯誤
 *   內容」按鈕，並把完整錯誤印到主控台，方便測試人員回報。
 * ★ 2026-10-05 新增：使用者回報「泛化階層對照輸入值過長後整頁空白」，現場無任何錯誤訊息可查。
 * ============================================================================
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { scaleFontSize } from '../utils/fontScale';
interface AppErrorBoundaryProps { children: ReactNode }
interface AppErrorBoundaryState { caughtError: Error | null; componentStackText: string }

export default class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
    state: AppErrorBoundaryState = { caughtError: null, componentStackText: '' };

    static getDerivedStateFromError(caughtError: Error): Partial<AppErrorBoundaryState> {
        return { caughtError };
    }

    componentDidCatch(caughtError: Error, errorInfo: ErrorInfo): void {
        console.error('[AppErrorBoundary] 畫面渲染發生例外：', caughtError, errorInfo.componentStack);
        this.setState({ componentStackText: errorInfo.componentStack ?? '' });
    }

    private buildReportText(): string {
        const { caughtError, componentStackText } = this.state;
        return [
            `時間: ${new Date().toISOString()}`,
            `網址: ${window.location.href}`,
            `瀏覽器: ${navigator.userAgent}`,
            `頁面語言標記: ${document.documentElement.lang}／是否被翻譯: ${document.documentElement.className.includes('translated') ? '是' : '否'}`,
            `錯誤: ${caughtError?.name}: ${caughtError?.message}`,
            `堆疊:\n${caughtError?.stack ?? ''}`,
            `元件堆疊:${componentStackText}`
        ].join('\n');
    }

    private handleCopyReport = (): void => {
        void navigator.clipboard?.writeText(this.buildReportText());
    };

    render(): ReactNode {
        const { caughtError } = this.state;
        if (!caughtError) return this.props.children;

        return (
            <div style={{ maxWidth: '63em', margin: '48px auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#e5e5e5', background: '#1f1f1f', borderRadius: 12, border: '1px solid #ff4d4f' }}>
                <h2 style={{ marginTop: 0, color: '#ff7875' }}>畫面發生錯誤</h2>
                <p>系統遇到未預期的錯誤，畫面已停止更新。請按「複製錯誤內容」後回報給開發人員，再重新載入頁面。</p>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#141414', padding: 12, borderRadius: 8, maxHeight: 360, overflow: 'auto', fontSize: scaleFontSize(12) }}>
                    {this.buildReportText()}
                </pre>
                <button type="button" onClick={this.handleCopyReport} style={{ marginRight: 8, padding: '6px 16px', cursor: 'pointer' }}>複製錯誤內容</button>
                <button type="button" onClick={() => window.location.reload()} style={{ padding: '6px 16px', cursor: 'pointer' }}>重新載入</button>
            </div>
        );
    }
}
