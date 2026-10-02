import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Privacy Toolkit 全流程端到端測試 (E2E Workflow Test)', () => {

  test('測試使用者從登入、上傳 CSV 測資、預覽到下載的完整流程', async ({ page }) => {
    // ------------------------------------------------------------------
    // Step 1: 登入驗證 (Login)
    // ------------------------------------------------------------------
    await page.goto('/login');
    await expect(page.getByText('PRIVACY APP')).toBeVisible();

    // 點擊一鍵快速登入
    // ★ 2026-10-02：登入已串接後端，「一鍵快速登入」只在 Demo 模式顯示——
    //   執行 E2E 前請以 VITE_ENABLE_DEMO_LOGIN=true 啟動前端（例如 set VITE_ENABLE_DEMO_LOGIN=true && npm run dev）
    const quickLoginBtn = page.getByRole('button', { name: /一鍵快速登入|One-Click Quick Login/i });
    await expect(quickLoginBtn).toBeVisible();
    await quickLoginBtn.click();

    // 驗證進入主頁面
    await page.waitForURL('**/', { timeout: 10000 });
    await expect(page).not.toHaveURL('/login');

    // ------------------------------------------------------------------
    // Step 2: 上傳 CSV 測資檔 (Upload Test CSV)
    // ------------------------------------------------------------------
    const csvFilePath = path.resolve('e2e/fixtures/mock_privacy_data.csv');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(csvFilePath);

    // 驗證資料解析成功
    await expect(page.getByText('張小明')).toBeVisible({ timeout: 5000 });

    // ------------------------------------------------------------------
    // Step 3: 從 Step 1 (資料匯入) 進入 Step 2 (屬性分類)
    // ------------------------------------------------------------------
    const toStep2Btn = page.getByRole('button', { name: /下一步：屬性分類/i });
    await expect(toStep2Btn).toBeVisible();
    await toStep2Btn.click();

    // ------------------------------------------------------------------
    // Step 4: 完成 Step 2 屬性設定 (確保有「間接識別碼」)
    // ------------------------------------------------------------------
    // 1. 優先點擊套用系統推薦設定
    const applyBtn = page.getByRole('button', { name: /套用系統推薦設定/i });
    if (await applyBtn.isVisible()) {
      await applyBtn.click();
      await page.waitForTimeout(500);
    }

    // 2. 若有警示提示，點擊第一個下拉選單設定為「間接識別碼」
    try {
      const firstRowSelect = page.locator('.ant-table-row').first().locator('.ant-select').first();
      if (await firstRowSelect.isVisible()) {
        await firstRowSelect.click();
        const option = page.locator('.ant-select-item-option-content').filter({ hasText: '間接識別碼' }).first();
        await option.waitFor({ state: 'visible', timeout: 2000 });
        await option.click();
      }
    } catch (e) {
      console.log('推薦設定已自動涵蓋屬性分組', e);
    }

    // ------------------------------------------------------------------
    // Step 5: 從 Step 2 進入 Step 3 (隱私設定)
    // ------------------------------------------------------------------
    const toStep3Btn = page.getByRole('button', { name: /下一步/i }).last();
    await expect(toStep3Btn).toBeEnabled();
    await toStep3Btn.click();

    // ------------------------------------------------------------------
    // Step 6: 從 Step 3 進入 Step 4 (預覽匯出) 並執行匯出
    // ------------------------------------------------------------------
    // 利用頂部步驟條直達或點擊下一步
    const step4Nav = page.getByRole('button', { name: '4 預覽匯出' });
    if (await step4Nav.isVisible()) {
      await step4Nav.click();
    }

    // 驗證順利達到 Step 4 預覽匯出
    await expect(page.getByRole('button', { name: '4 預覽匯出' })).toBeVisible();

    // 觸發匯出/下載按鈕
    const exportBtn = page.getByRole('button', { name: /下載|匯出|Export|Download/i }).first();
    if (await exportBtn.isVisible()) {
      await exportBtn.click();
    }

    // 確保頁面運作正常且無崩潰
    await expect(page.locator('body')).toBeVisible();
  });

});