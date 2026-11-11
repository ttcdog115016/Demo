// Docker 單一映像檔實測：登入 → 新增任務 → 上傳 CSV → 屬性分類 → 隱私設定 → 執行並下載
// 執行方式見 docker/playwright.docker.config.ts；需要 E2E_BASE_URL、E2E_USERNAME、E2E_PASSWORD。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test('Docker 版：登入、上傳、K-匿名化並下載結果', async ({ page }) => {
  test.setTimeout(180_000);
  const username = process.env.E2E_USERNAME ?? '';
  const password = process.env.E2E_PASSWORD ?? '';
  test.skip(!username || !password, '未設定 E2E_USERNAME／E2E_PASSWORD');
  const shot = (name: string) => page.screenshot({ path: `test-results-docker/${name}.png`, fullPage: true });

  await page.goto('/login');
  await page.getByLabel(/帳號|Account/).fill(username);
  await page.getByLabel(/密碼|Password/).fill(password);
  await page.getByRole('button', { name: /登入系統|Log In/i }).click();
  await page.waitForURL('**/', { timeout: 15_000 });
  await expect(page.getByText('系統運作正常')).toBeVisible();
  await shot('01-dashboard');

  await page.getByRole('button', { name: /新增去識別化任務/ }).click();
  await page.locator('input[type="file"]').setInputFiles(path.resolve(process.env.E2E_CSV ?? 'e2e/fixtures/mock_privacy_data.csv'));
  await expect(page.getByText(/解析成功|筆資料/).first()).toBeVisible({ timeout: 60_000 });
  await shot('02-uploaded');

  await page.getByRole('button', { name: /下一步：屬性分類/ }).click();
  const applyBtn = page.getByRole('button', { name: /套用系統推薦設定/ });
  if (await applyBtn.isVisible()) await applyBtn.click();
  await page.waitForTimeout(800);
  await shot('03-mapping');
  await page.getByRole('button', { name: /下一步/ }).last().click();
  await page.waitForTimeout(800);
  await shot('04-privacy-settings');

  await page.getByRole('button', { name: /下一步/ }).last().click();
  const downloadBtn = page.getByRole('button', { name: /下載處理後資料/ });
  await expect(downloadBtn).toBeEnabled({ timeout: 180_000 });
  await shot('05-result');
  // 下載會依序觸發多個檔案（結果 CSV、注意事項 txt），全部收集後存檔
  const downloads: import('@playwright/test').Download[] = [];
  page.on('download', (d) => downloads.push(d));
  await downloadBtn.click();
  await page.getByRole('button', { name: /我已了解/ }).click();
  await expect.poll(() => downloads.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2000);
  for (const d of downloads) {
    const target = path.resolve('test-results-docker', 'dl-' + d.suggestedFilename());
    await d.saveAs(target);
    console.log('downloaded:', d.suggestedFilename(), fs.statSync(target).size, 'bytes');
  }
  const csv = downloads.find((d) => /\.csv$/i.test(d.suggestedFilename()));
  expect(csv, '應下載到處理後的 CSV').toBeTruthy();

  // 檢測報告（PDF，含中文字型）
  await page.getByRole('button', { name: /查看與下載報告/ }).click();
  await page.waitForTimeout(1500);
  await shot('07-report-dialog');

  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  const pdfPromise = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
  await page.getByRole('button', { name: /輸出 PDF 紀錄/ }).click();
  const pdf = await pdfPromise;
  await shot('08-after-pdf');
  console.log('console errors:', JSON.stringify(consoleErrors));
  expect(pdf, '應下載到 PDF 報告').toBeTruthy();
  const pdfPath = path.resolve('test-results-docker', 'dl-' + pdf!.suggestedFilename());
  await pdf!.saveAs(pdfPath);
  console.log('pdf:', pdf!.suggestedFilename(), fs.statSync(pdfPath).size, 'bytes');
  expect(fs.readFileSync(pdfPath).subarray(0, 4).toString()).toBe('%PDF');
});
