import { expect, test, type Page } from '@playwright/test';
import { chooseTool, contextAction } from './helpers';

async function blank(page: Page): Promise<void> {
  await page.goto('/'); await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
  if (await page.locator('#properties').isHidden()) await page.locator('#expand-properties').click();
}

test('linked preset edits update both grids immediately and switching saves several colors in one session', async ({ page }) => {
  await blank(page);
  for (const property of ['stroke', 'fill']) {
    await page.locator(`#${property}-palette`).click(); const picker = page.locator(`#${property}-picker`), hex = picker.getByLabel('HEX 颜色', { exact: true });
    const original = await page.locator(`#${property}-colors [data-color]`).nth(2).getAttribute('data-color');
    await picker.locator('[data-preset-index="2"]').click(); await hex.fill('#123abc');
    await expect(picker.locator('[data-preset-index="2"]')).toHaveAttribute('data-color', '#123abc');
    await expect(page.locator(`#${property}-colors [data-color]`).nth(2)).toHaveAttribute('data-color', '#123abc');
    await expect(picker.locator('.color-before')).toHaveAttribute('data-color', original!);
    await expect(picker.locator('.color-after')).toHaveAttribute('data-color', '#123abc');
    await picker.locator('[data-preset-index="3"]').click(); await hex.fill('#fedcba');
    await picker.locator('[data-preset-index="4"]').click(); await hex.fill('#654321');
    await picker.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator(`#${property}-colors [data-color]`).nth(2)).toHaveAttribute('data-color', '#123abc');
    await expect(page.locator(`#${property}-colors [data-color]`).nth(3)).toHaveAttribute('data-color', '#fedcba');
    await expect(page.locator(`#${property}-colors [data-color]`).nth(4)).toHaveAttribute('data-color', property === 'stroke' ? '#639bba' : '#deedf5');
  }
  await page.reload(); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  for (const property of ['stroke', 'fill']) {
    await expect(page.locator(`#${property}-colors [data-color]`).nth(2)).toHaveAttribute('data-color', '#123abc');
    await expect(page.locator(`#${property}-colors [data-color]`).nth(3)).toHaveAttribute('data-color', '#fedcba');
  }
});

test('HEX blur applies valid values and restores the last effective color for empty or invalid text', async ({ page }) => {
  await blank(page); await page.locator('#stroke-palette').click();
  const picker = page.locator('#stroke-picker'), hex = picker.getByLabel('HEX 颜色', { exact: true });
  await picker.locator('[data-preset-index="2"]').click(); await hex.fill('A1B2C3'); await picker.locator('.color-picker-heading').click();
  await expect(hex).toHaveValue('#a1b2c3'); await expect(page.locator('#stroke-colors [data-color]').nth(2)).toHaveAttribute('data-color', '#a1b2c3');
  for (const value of ['', '#12', 'oops', '#12345']) {
    await hex.fill(value); await picker.locator('.color-picker-heading').click(); await expect(hex).toHaveValue('#a1b2c3');
    await expect(page.locator('#stroke-colors [data-color]').nth(2)).toHaveAttribute('data-color', '#a1b2c3');
  }
  await hex.fill('#abc'); await picker.locator('.color-picker-heading').click(); await expect(hex).toHaveValue('#aabbcc');
  await picker.getByRole('button', { name: '应用颜色', exact: true }).click();
  await page.locator('#stroke-palette').click(); await expect(hex).toHaveValue('#aabbcc');
});

test('multiple draft changes on one selected-object color make one undo step when switching preset', async ({ page }) => {
  await blank(page); await chooseTool(page, '矩形'); await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(600, 300); await page.locator('#stroke-palette').click();
  const picker = page.locator('#stroke-picker'), hex = picker.getByLabel('HEX 颜色', { exact: true });
  await picker.locator('[data-preset-index="2"]').click(); await hex.fill('#111111'); await hex.fill('#222222'); await hex.fill('#333333');
  await picker.locator('[data-preset-index="3"]').click(); await hex.fill('#444444'); await picker.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', '#333333');
  await page.keyboard.press('Control+z'); await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', '#283e36');
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', '#333333');
});

test('compact row aligns all controls, keeps comparison stacked and shows floating explanations in both themes', async ({ page }) => {
  await blank(page);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (let theme = 0; theme < 2; theme++) {
      await page.locator('#stroke-palette').click(); const picker = page.locator('#stroke-picker');
      await expect(picker.locator('.hex-label, .canvas-sample-hint, .preset-hint, [data-current-only]')).toHaveCount(0);
      const boxes = await picker.locator('.color-preview, .hex-input, .eyedropper-button').evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().toJSON()));
      expect(boxes).toHaveLength(3); expect(Math.max(...boxes.map(b => b.height)) - Math.min(...boxes.map(b => b.height))).toBeLessThan(1);
      expect(Math.max(...boxes.map(b => b.y)) - Math.min(...boxes.map(b => b.y))).toBeLessThan(1);
      const before = (await picker.locator('.color-before').boundingBox())!, after = (await picker.locator('.color-after').boundingBox())!;
      expect(before.y + before.height).toBeCloseTo(after.y, 0);
      await picker.getByRole('button', { name: '画布取色', exact: true }).hover();
      const tooltip = page.getByRole('tooltip'); await expect(tooltip).toContainText('方形');
      const box = (await tooltip.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(4); expect(box.x + box.width).toBeLessThanOrEqual(width - 4);
      const overflow = await picker.evaluate(el => el.scrollWidth > el.clientWidth); expect(overflow).toBe(false);
      await page.keyboard.press('Escape'); await page.locator('#theme-button').click();
    }
  }
});

test('the color field stays bound to the selected slot and outside close saves the latest live edit', async ({ page }) => {
  await blank(page); await page.locator('#stroke-palette').click(); const picker = page.locator('#stroke-picker');
  await picker.locator('[data-preset-index="5"]').click(); await picker.getByLabel('HEX 颜色').fill('#ff0000');
  await picker.getByRole('slider', { name: '色相', exact: true }).press('Home');
  for (let i = 0; i < 12; i++) await picker.getByRole('slider', { name: '色相', exact: true }).press('Shift+ArrowRight');
  await expect(page.locator('#stroke-colors [data-color]').nth(5)).toHaveAttribute('data-color', '#00ff00');
  await expect(picker.locator('[data-preset-index="5"]')).toHaveAttribute('data-color', '#00ff00');
  await page.mouse.click(1100, 700); await expect(picker).toBeHidden();
  await page.reload(); await expect(page.locator('#stroke-colors [data-color]').nth(5)).toHaveAttribute('data-color', '#00ff00');
});

test('cancel rolls back the live preset without saving it or changing a locked selected object', async ({ page }) => {
  await blank(page); await chooseTool(page, '矩形'); await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(600, 300); await contextAction(page, 'lock');
  await page.locator('#stroke-palette').click(); const picker = page.locator('#stroke-picker');
  await picker.locator('[data-preset-index="2"]').click(); await picker.getByLabel('HEX 颜色').fill('#112233');
  await expect(page.locator('#stroke-colors [data-color]').nth(2)).toHaveAttribute('data-color', '#112233');
  await picker.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('#stroke-colors [data-color]').nth(2)).toHaveAttribute('data-color', '#e28165');
  await page.locator('#stroke-palette').click(); await picker.locator('[data-preset-index="2"]').click(); await picker.getByLabel('HEX 颜色').fill('#445566');
  await picker.getByRole('button', { name: '应用颜色', exact: true }).click(); await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', '#283e36');
  await page.reload(); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await expect(page.locator('#stroke-colors [data-color]').nth(2)).toHaveAttribute('data-color', '#445566');
  await page.keyboard.press('Control+a'); await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', '#283e36');
});

test('palette and toolbar explanations share an unclipped tooltip without inline helper text', async ({ page }) => {
  await blank(page); await page.locator('[data-family="shapes"]').hover();
  await expect(page.getByRole('tooltip')).toHaveText(/图形.*Shift.*R/);
  await page.locator('#stroke-palette').click(); await page.locator('#stroke-hex').fill('#123456');
  await page.locator('#stroke-picker .color-preview').hover(); await expect(page.getByRole('tooltip')).toHaveText(/上方是原色/);
  await page.locator('#stroke-picker').getByRole('button', { name: '取消', exact: true }).click();
  await chooseTool(page, '画笔'); await page.locator('#pressure-toggle').hover(); await expect(page.getByRole('tooltip')).toHaveText(/手写笔/);
  await expect(page.locator('#pressure-hint, #canvas-hint, #export-hint')).toHaveCount(0);
});
