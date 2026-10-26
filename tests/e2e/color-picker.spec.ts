import { expect, test, type Page } from '@playwright/test';
import { createBoard, chooseTool } from './helpers';

async function blank(page: Page): Promise<void> {
  await page.goto('/'); await createBoard(page);
  if (await page.locator('#properties').isHidden()) await page.locator('#expand-properties').click();
}

test('custom color popovers dock flush to the properties panel and track viewport resizing', async ({ page }) => {
  await blank(page);
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const property of ['stroke', 'fill']) {
      await page.locator(`#${property}-palette`).click();
      const picker = page.locator(`#${property}-picker`);
      await expect(picker).toBeVisible();
      const panelBox = (await page.locator('#properties').boundingBox())!, pickerBox = (await picker.boundingBox())!;
      expect(Math.abs(pickerBox.x - panelBox.x - panelBox.width)).toBeLessThan(1);
      expect(Math.abs(pickerBox.y - panelBox.y)).toBeLessThan(1);
      expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual(width - 7);
      expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual(837);
      await expect(picker.locator('input[type="color"]')).toHaveCount(0);
      await expect(picker.getByRole('slider', { name: '饱和度与明度' })).toBeVisible();
      await expect(picker.getByRole('slider', { name: '色相', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
    }
  }
  await page.setViewportSize({ width: 1440, height: 844 }); await page.locator('#stroke-palette').click();
  await page.setViewportSize({ width: 390, height: 844 });
  const picker = page.locator('#stroke-picker'); await expect(picker).toBeVisible();
  const panel = (await page.locator('#properties').boundingBox())!, box = (await picker.boundingBox())!;
  expect(box.x).toBeCloseTo(panel.x + panel.width, 0); expect(box.y).toBeCloseTo(panel.y, 0);
});

test('the custom color field and hue slider synchronize with HEX without committing drafts', async ({ page }) => {
  await blank(page); await page.locator('#stroke-palette').click();
  const picker = page.locator('#stroke-picker'), hex = picker.getByLabel('HEX 颜色', { exact: true });
  await hex.fill('#ff0000');
  const field = picker.getByRole('slider', { name: '饱和度与明度' }), hue = picker.getByRole('slider', { name: '色相', exact: true });
  const rect = (await field.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down(); await page.mouse.move(rect.x - 2, rect.y - 2); await page.mouse.up(); await expect(hex).toHaveValue('#ffffff');
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down(); await page.mouse.move(rect.x + rect.width + 2, rect.y - 2); await page.mouse.up(); await expect(hex).toHaveValue('#ff0000');
  await hue.focus(); await page.keyboard.press('Home');
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect(hex).toHaveValue('#00ff00'); await expect(hue).toHaveAttribute('aria-valuenow', '120');
  await field.focus(); await page.keyboard.press('Shift+ArrowDown'); await expect(hex).toHaveValue('#00e600');
  await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', '#283e36');
  await picker.getByRole('button', { name: '应用颜色' }).click();
  await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', '#00e600');
  await page.locator('#stroke-palette').click(); await expect(hex).toHaveValue('#00e600');
  await field.focus(); await page.keyboard.press('Home'); await expect(hex).toHaveValue('#e6e6e6');
  await page.keyboard.press('Escape'); await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', '#00e600');
});

test('pointer capture clamps drags beyond the color field and hue slider in both themes', async ({ page }) => {
  await blank(page);
  for (let theme = 0; theme < 2; theme++) {
    await page.locator('#fill-palette').click();
    const picker = page.locator('#fill-picker'), hex = picker.getByLabel('HEX 颜色', { exact: true });
    await hex.fill('#ff0000');
    const field = (await picker.getByRole('slider', { name: '饱和度与明度' }).boundingBox())!;
    await page.mouse.move(field.x + 30, field.y + 30); await page.mouse.down(); await page.mouse.move(field.x + field.width + 25, field.y + field.height + 25, { steps: 4 }); await page.mouse.up();
    await expect(hex).toHaveValue('#000000');
    await hex.fill('#ff0000'); const hue = picker.getByRole('slider', { name: '色相', exact: true }), rail = (await hue.boundingBox())!;
    await page.mouse.move(rail.x + 10, rail.y + rail.height / 2); await page.mouse.down(); await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height / 2, { steps: 4 }); await page.mouse.up();
    await expect(hex).toHaveValue('#00ffff');
    await expect(page.locator('#fill-palette')).toHaveAttribute('data-current-color', '#e6eee5');
    await expect(page.locator('#fill-toggle')).not.toBeChecked();
    await picker.getByRole('button', { name: '取消', exact: true }).click(); await page.locator('#theme-button').click();
  }
});

test('custom field edits apply to a selected object as one undoable change', async ({ page }) => {
  await blank(page); await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(600, 300);
  await page.locator('#stroke-palette').click(); const picker = page.locator('#stroke-picker');
  await picker.getByLabel('HEX 颜色').fill('#123abc');
  await picker.getByRole('slider', { name: '饱和度与明度' }).press('ArrowLeft');
  const color = await picker.getByLabel('HEX 颜色').inputValue();
  await picker.getByRole('button', { name: '应用颜色' }).click();
  await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', color);
  await page.keyboard.press('Control+z'); await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', '#283e36');
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', color);
  await expect(page.locator('#save-status')).toContainText('已保存在本机'); await page.reload(); await expect(page.locator('#save-status')).toContainText('已保存在本机'); await page.keyboard.press('Control+a');
  await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', color);
});
