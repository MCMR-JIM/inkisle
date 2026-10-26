import { expect, test, type Page } from '@playwright/test';
import { createBoard, chooseTool } from './helpers';

async function setup(page: Page): Promise<void> {
  await page.goto('/'); await createBoard(page);
  await chooseTool(page, '矩形'); await page.locator('[data-property="fill"][data-color="#e6eee5"]').click();
  await page.locator('#fill-toggle').click();
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(800, 500); await page.mouse.up();
  await page.locator('#stroke-palette').click();
}

test('the primary eyedropper beside HEX opens the square preview for both palettes without invoking the system picker', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { systemPicks: number }).systemPicks = 0;
    Object.defineProperty(window, 'EyeDropper', { configurable: true, value: class {
      async open(): Promise<{ sRGBHex: string }> { (window as unknown as { systemPicks: number }).systemPicks++; return { sRGBHex: '#123456' }; }
    } });
  });
  await setup(page);
  for (const property of ['stroke', 'fill']) {
    if (property === 'fill') await page.locator('#fill-palette').click();
    const picker = page.locator(`#${property}-picker`);
    await expect(picker.getByRole('button', { name: '屏幕取色', exact: true })).toHaveCount(0);
    await expect(picker).not.toContainText('系统吸管');
    await picker.locator('.color-value-row .eyedropper-button').click();
    const loupe = page.locator('.canvas-eyedropper-loupe'); await expect(loupe).toBeVisible();
    await page.mouse.move(610, 380); await expect(page.locator('.canvas-eyedropper-hex')).toHaveText('#e6eee5');
    const box = (await loupe.boundingBox())!, hex = (await page.locator('.canvas-eyedropper-hex').boundingBox())!;
    expect(box.width).toBe(box.height); expect(hex.y).toBeGreaterThanOrEqual(box.y + box.height);
    await page.mouse.click(610, 380); await expect(picker.getByLabel('HEX 颜色')).toHaveValue('#e6eee5');
    await picker.getByRole('button', { name: '取消', exact: true }).click();
  }
  expect(await page.evaluate(() => (window as unknown as { systemPicks: number }).systemPicks)).toBe(0);
});

test('canvas eyedropper shows a square pixel loupe with live HEX underneath and picks without drawing', async ({ page }) => {
  await setup(page); await page.locator('#stroke-picker').getByRole('button', { name: '画布取色', exact: true }).click();
  await page.mouse.move(610, 380);
  const loupe = page.locator('.canvas-eyedropper-loupe'), label = page.locator('.canvas-eyedropper-hex');
  await expect(label).toHaveText('#e6eee5'); await expect(loupe).toBeVisible();
  const box = (await loupe.boundingBox())!, value = (await label.boundingBox())!;
  expect(Math.abs(box.width - box.height)).toBeLessThan(1); expect(value.y).toBeGreaterThanOrEqual(box.y + box.height);
  expect(await loupe.evaluate(el => getComputedStyle(el).borderRadius)).toBe('0px');
  await page.mouse.click(610, 380); await expect(page.locator('.canvas-eyedropper')).toHaveCount(0);
  await expect(page.locator('#stroke-hex')).toHaveValue('#e6eee5'); await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', '#283e36');
  await page.locator('#stroke-picker').getByRole('button', { name: '应用颜色' }).click();
  await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', '#e6eee5');
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
});

test('canceling canvas sampling keeps the existing draft and its preview stays inside the viewport', async ({ page }) => {
  await setup(page); await page.locator('#stroke-hex').fill('#123abc');
  await page.locator('#stroke-picker').getByRole('button', { name: '画布取色', exact: true }).click();
  await page.mouse.move(1437, 957);
  const box = (await page.locator('.canvas-eyedropper-preview').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(8); expect(box.y).toBeGreaterThanOrEqual(8); expect(box.x + box.width).toBeLessThanOrEqual(1432); expect(box.y + box.height).toBeLessThanOrEqual(952);
  await page.keyboard.press('Escape'); await expect(page.locator('.canvas-eyedropper')).toHaveCount(0);
  await expect(page.locator('#stroke-picker')).toBeVisible(); await expect(page.locator('#stroke-hex')).toHaveValue('#123abc');
  await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', '#283e36');
});

test('canvas sampling reads the composited pixels at high DPR and does not sample floating controls', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
  const retina = await context.newPage(); await setup(retina);
  await retina.locator('#stroke-picker').getByRole('button', { name: '画布取色', exact: true }).click();
  await retina.mouse.move(610, 380); await expect(retina.locator('.canvas-eyedropper-hex')).toHaveText('#e6eee5');
  await retina.mouse.move(100, 240); await expect(retina.locator('.canvas-eyedropper-hex')).toHaveText('移到画布取色');
  await retina.mouse.click(100, 240); await expect(retina.locator('.canvas-eyedropper')).toBeVisible();
  await retina.mouse.move(610, 380); await retina.keyboard.press('Enter'); await expect(retina.locator('#stroke-hex')).toHaveValue('#e6eee5');
  await context.close();
});
