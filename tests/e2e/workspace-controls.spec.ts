import { expect, test } from '@playwright/test';
import { createBoard, chooseTool, selectValue } from './helpers';

test('tool shortcuts reveal the matching family and family shortcuts can be rebound', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.mouse.click(1150, 450);
  await page.keyboard.press('r');
  await expect(page.locator('#tool-menu-shapes')).toBeVisible();
  await expect(page.locator('[data-tool-child="rect"]')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Shift+r'); await expect(page.locator('#tool-menu-shapes')).toBeHidden();
  await page.keyboard.press('Shift+r'); await expect(page.locator('#tool-menu-shapes')).toBeVisible();
  await page.keyboard.press('a'); await expect(page.locator('#tool-menu-lines')).toBeVisible();
  await expect(page.locator('#tool-menu-shapes')).toBeHidden();
  await page.keyboard.press('p'); await expect(page.locator('#tool-menu-lines')).toBeHidden();
  await page.locator('#help-button').click();
  await page.locator('[data-shortcut="family:shapes"]').click(); await page.keyboard.press('Shift+s');
  await page.getByRole('button', { name: '关闭帮助', exact: true }).click();
  await page.keyboard.press('Shift+s'); await expect(page.locator('#tool-menu-shapes')).toBeVisible();
  await expect(page.locator('[data-family="shapes"] .tool-key')).toContainText('Shift + S');
});

test('toolbar placement persists, opens options toward the canvas and keeps the sidebar centered', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await expect(page.locator('html')).toHaveAttribute('data-toolbar-position', 'bottom');
  const properties = (await page.locator('#properties').boundingBox())!;
  await page.keyboard.press('r');
  let toolbar = (await page.locator('.toolbar').boundingBox())!, menu = (await page.locator('#tool-menu-shapes').boundingBox())!;
  expect(menu.y + menu.height).toBeLessThan(toolbar.y);
  await page.locator('#workspace-settings-button').click();
  await selectValue(page, '#toolbar-position', 'top');
  await page.getByRole('button', { name: '关闭工作区设置', exact: true }).click();
  toolbar = (await page.locator('.toolbar').boundingBox())!; menu = (await page.locator('#tool-menu-shapes').boundingBox())!;
  expect(menu.y).toBeGreaterThan(toolbar.y + toolbar.height);
  expect((await page.locator('#properties').boundingBox())!.y).toBeCloseTo(properties.y, 1);
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-toolbar-position', 'top');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#workspace-settings-button').click(); await selectValue(page, '#toolbar-position', 'bottom');
  await page.getByRole('button', { name: '关闭工作区设置', exact: true }).click();
  await page.keyboard.press('r');
  for (const selector of ['.toolbar > .tool-button', '#tool-menu-shapes > button']) {
    const boxes = await page.locator(selector).evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().toJSON()));
    expect(boxes.every(box => box.width >= 44 && box.height >= 44 && box.x >= 0 && box.right <= 390)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('the library supports search, inline rename, sorting and independent board copies', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await createBoard(page); await expect(page.locator('#element-count')).toHaveText('0 个元素');
  await page.locator('#board-title').fill('Project Alpha'); await page.locator('#board-title').blur();
  await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 400); await page.mouse.up();
  await page.locator('#library-button').click();
  await page.locator('#library-search').fill('ALPHA'); await expect(page.locator('.board-card')).toHaveCount(1);
  await page.getByRole('button', { name: '复制画板 Project Alpha', exact: true }).click();
  await expect(page.locator('.board-card')).toHaveCount(2);
  await page.getByRole('textbox', { name: '画板名称 Project Alpha 副本', exact: true }).fill('Project Beta');
  await page.keyboard.press('Enter');
  await page.locator('#library-search').fill('Beta'); await expect(page.locator('.board-card')).toHaveCount(1);
  await page.getByRole('button', { name: '打开画板 Project Beta', exact: true }).click();
  await expect(page.locator('#board-title')).toHaveValue('Project Beta');
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await page.keyboard.press('Control+a'); await page.keyboard.press('Delete');
  await page.locator('#library-button').click(); await page.locator('#library-search').fill('Alpha');
  await page.getByRole('button', { name: '打开画板 Project Alpha', exact: true }).click();
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await page.locator('#library-button').click(); await page.locator('#library-search').fill('no such board');
  await expect(page.locator('.library-empty')).toContainText('没有找到');
  await page.locator('#library-search').fill('Project'); await selectValue(page, '#library-sort', 'title');
  await expect(page.locator('.board-card-title').first()).toHaveValue('Project Alpha');
});
