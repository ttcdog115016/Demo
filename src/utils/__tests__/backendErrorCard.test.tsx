import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildFriendlyErrorDisplayNode } from '../../features/step4_result/backendErrorCatalog';

describe('錯誤卡片：問題／建議', () => {
    it('可辨識的後端訊息 → 顯示問題、建議與錯誤代碼，不再顯示通用說明', () => {
        const html = renderToStaticMarkup(<>{buildFriendlyErrorDisplayNode({ responseErrorCode: 'ERR_CONFIG_DATA_MISMATCH', responseHttpStatus: 422, backendRawMessageText: "欄位 '年齡' 宣告為 continuous，但實體資料包含無法轉換的非數值內容。" })}</>);
        expect(html).toContain('問題：');
        expect(html).toContain('「年齡」設定為數值欄位');
        expect(html).toContain('錯誤代碼：ERR_CONFIG_DATA_MISMATCH');
        expect(html).not.toContain('對不起來');
    });
    it('辨識不出來 → 維持原本通用說明', () => {
        const html = renderToStaticMarkup(<>{buildFriendlyErrorDisplayNode({ responseErrorCode: 'ERR_INTERNAL', responseHttpStatus: 500, backendRawMessageText: 'Internal Server Error' })}</>);
        expect(html).toContain('建議：');
        expect(html).toContain('錯誤訊息：Internal Server Error');
    });
});
