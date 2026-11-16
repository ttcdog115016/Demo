// Docker 單一映像檔的模式切換驗證（OPEN_PETS_MODE）
// 需要：E2E_BASE_URL、E2E_ADMIN_USERNAME、E2E_ADMIN_PASSWORD、EXPECT_MODE（local|lan）
// 見 docker/playwright.docker.config.ts。
import { test, expect } from '@playwright/test';

const expectedMode = process.env.EXPECT_MODE ?? '';
const adminUsername = process.env.E2E_ADMIN_USERNAME ?? '';
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? '';

test.describe(`模式：${expectedMode}`, () => {
  test.skip(!expectedMode, '未設定 EXPECT_MODE');

  test('/runtime-config.js 內容與環境變數一致，且為 JavaScript 而不是被 SPA 攔截的 index.html', async ({ request }) => {
    const response = await request.get('/runtime-config.js');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('javascript');
    expect(response.headers()['cache-control']).toContain('no-cache');
    const body = await response.text();
    expect(body).toContain(`"mode": "${expectedMode}"`);
    expect(body).not.toContain('showDemoAccounts');
  });

  test('登入頁不顯示 Demo 測試帳號，也不含寫死的測試帳密', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('PRIVACY APP')).toBeVisible();
    await expect(page.getByText(/Demo 測試帳號|Demo Account/)).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain('Owner@123456');
    expect(html).not.toContain('Admin@123456');
  });

  test('管理員的「系統維運日誌」分頁', async ({ page }) => {
    test.skip(!adminUsername || !adminPassword, '未設定管理員帳密');
    await page.goto('/login');
    await page.getByLabel(/帳號|Account/).fill(adminUsername);
    await page.getByLabel(/密碼|Password/).fill(adminPassword);
    await page.getByRole('button', { name: /登入系統|Log In/i }).click();
    await page.waitForURL('**/admin', { timeout: 15_000 });
    await page.goto('/settings/preferences');
    await expect(page.getByText('帳號與權限管理').first()).toBeVisible({ timeout: 15_000 });
    const logTab = page.getByRole('tab', { name: /系統維運日誌/ });
    if (expectedMode === 'lan') await expect(logTab).toBeVisible();
    else await expect(logTab).toHaveCount(0);
  });
});
