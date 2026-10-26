import { expect, test, type Page } from '@playwright/test';
import { createBoard, chooseTool } from './helpers';

async function blank(page: Page): Promise<void> {
  await page.goto('/'); await createBoard(page);
  if (await page.locator('#properties').isHidden()) await page.locator('#expand-properties').click();
}

test('square canvas sampling remains available without the system API and can save into a preset', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'EyeDropper', { configurable: true, value: undefined }); });
  await blank(page); await chooseTool(page, '矩形');
  await page.locator('[data-property="fill"][data-color="#e6eee5"]').click();
  await page.locator('#fill-toggle').click();
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(800, 500); await page.mouse.up();
  await page.locator('#stroke-palette').click(); const picker = page.locator('#stroke-picker');
  await expect(picker.getByRole('button', { name: '屏幕取色', exact: true })).toHaveCount(0);
  await expect(picker.locator('.eyedropper-status')).toHaveCount(0);
  await picker.getByLabel('HEX 颜色').fill('#123456'); await picker.getByRole('button', { name: '画布取色', exact: true }).click();
  await page.keyboard.press('Escape'); await expect(picker).toBeVisible();
  await expect(picker.getByLabel('HEX 颜色')).toHaveValue('#123456');
  await picker.locator('[data-preset-index="2"]').click(); await picker.getByRole('button', { name: '画布取色', exact: true }).click();
  await page.mouse.click(610, 380); await expect(picker.getByLabel('HEX 颜色')).toHaveValue('#e6eee5');
  await expect(page.locator('#stroke-colors [data-color]').nth(2)).toHaveAttribute('data-color', '#e6eee5');
  await picker.getByRole('button', { name: '应用颜色' }).click();
  await expect(page.locator('#stroke-colors [data-color]').nth(2)).toHaveAttribute('data-color', '#e6eee5');
});

test('editing a preset updates that slot, remains isolated by property and survives reload and color cycling', async ({ page }) => {
  await blank(page);
  for (const [property, color] of [['stroke', '#123abc'], ['fill', '#fedcba']] as const) {
    const swatch = page.locator(`#${property}-colors [data-color]`).nth(2);
    const previous = await swatch.getAttribute('data-color'); await swatch.dblclick();
    const picker = page.locator(`#${property}-picker`); await expect(picker).toBeVisible();
    await expect(picker.locator('[data-preset-index="2"]')).toHaveAttribute('aria-pressed', 'true');
    await picker.getByLabel('HEX 颜色').fill(color); await page.keyboard.press('Escape');
    await expect(swatch).toHaveAttribute('data-color', previous!);
    await swatch.dblclick(); await picker.getByLabel('HEX 颜色').fill(color); await picker.getByRole('button', { name: '应用颜色' }).click();
    await expect(swatch).toHaveAttribute('data-color', color);
  }
  await page.reload(); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await expect(page.locator('#stroke-colors [data-color]').nth(2)).toHaveAttribute('data-color', '#123abc');
  await expect(page.locator('#fill-colors [data-color]').nth(2)).toHaveAttribute('data-color', '#fedcba');
  await page.locator('#stroke-colors [data-color]').nth(1).click(); await page.keyboard.press('Tab');
  await expect(page.locator('#stroke-colors [data-color]').nth(2)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#stroke-colors [data-color]').nth(2)).toHaveAttribute('aria-pressed', 'true');
  await chooseTool(page, '矩形'); await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(600, 300);
  await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', '#123abc');
});

test('all fill presets are colors while the independent fill switch stays off when presets are edited or restored', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await blank(page);
  await page.locator('#fill-palette').click(); const picker = page.locator('#fill-picker');
  await picker.locator('[data-preset-index="0"]').click(); await picker.getByLabel('HEX 颜色').fill('#654321');
  await picker.getByRole('button', { name: '应用颜色' }).click();
  await expect(page.locator('#fill-colors [data-color]').nth(0)).toHaveAttribute('data-color', '#654321');
  await expect(page.locator('#fill-toggle')).not.toBeChecked();
  await expect(page.locator('#fill-palette')).toHaveAttribute('data-current-color', '#654321');
  await page.locator('#fill-palette').click(); await picker.getByRole('button', { name: '恢复预设', exact: true }).click();
  await expect(page.locator('#fill-colors [data-color]').nth(0)).toHaveAttribute('data-color', '#e9ece8');
  const panel = (await page.locator('#properties').boundingBox())!, box = (await picker.boundingBox())!;
  expect(box.x).toBeCloseTo(panel.x + panel.width, 0); expect(box.y).toBeCloseTo(panel.y, 0);
  expect(box.x + box.width).toBeLessThanOrEqual(313); expect(box.y + box.height).toBeLessThanOrEqual(837);
  const overflow = await picker.evaluate(el => el.scrollWidth > el.clientWidth); expect(overflow).toBe(false);
});
