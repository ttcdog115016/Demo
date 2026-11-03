/**
 * 檔案名稱 (File): html2pdfLoader.ts
 * 模組功能 (Description): 載入 html2pdf（PDF 匯出）。
 *
 * ★ 2026-10-29：原本匯出時才從 cdnjs.cloudflare.com 載入 html2pdf.bundle.min.js，離線（單機版）就無法匯出 PDF；
 *   改用 npm 套件 html2pdf.js（同版本 0.10.1）打包進前端，第一次匯出時才動態載入（不拖慢首頁）。
 *   保留原本 <script> 的 onload／onerror 寫法，AuditLogHub 與 Step4 匯出流程不用改。
 * ★ 2026-11-03：npm audit 指出 0.10.1 內含之 jspdf／dompurify 有已知弱點，升級為 0.14.0（jspdf 4.x、dompurify 3.x），匯出 API 不變。
 */

export interface Html2PdfLoader
{
	onload: (() => void) | null;   // 載入完成（window.html2pdf 可用）
	onerror: (() => void) | null;  // 載入失敗
}

export const createHtml2PdfLoader = (): Html2PdfLoader => ({ onload: null, onerror: null });

export const startHtml2PdfLoader = (loader: Html2PdfLoader): void =>
{
	import('html2pdf.js')
		.then((html2pdfModule) =>
		{
			(window as unknown as { html2pdf: unknown }).html2pdf = html2pdfModule.default ?? html2pdfModule;
			loader.onload?.();
		})
		.catch((loadErrorValue) =>
		{
			console.error('載入 PDF 轉檔套件失敗：', loadErrorValue);
			loader.onerror?.();
		});
};
