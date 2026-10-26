import { expect, test, type Page } from '@playwright/test';
import { createBoard, chooseTool, contextAction } from './helpers';

async function blank(page: Page) {
  await page.goto('/'); await createBoard(page);
}

const active = (page: Page, property = 'stroke') => page.locator(`#${property}-colors [aria-pressed="true"]`).getAttribute('data-color');

test('Tab cycles only stroke presets in both directions, wraps and preserves text editing', async ({ page }) => {
  await blank(page);
  const colors = await page.locator('#stroke-colors [data-color]').evaluateAll(nodes => nodes.map(el => (el as HTMLElement).dataset.color));
  expect(colors).toHaveLength(10);
  const fill = await active(page, 'fill');
  await page.mouse.click(1000, 650);
  await page.keyboard.press('Tab'); expect(await active(page)).toBe(colors[1]);
  await page.keyboard.press('Shift+Tab'); expect(await active(page)).toBe(colors[0]);
  await page.keyboard.press('Shift+Tab'); expect(await active(page)).toBe(colors[9]);
  await page.keyboard.press('Tab'); expect(await active(page)).toBe(colors[0]);
  expect(await active(page, 'fill')).toBe(fill);
  const focus = await page.evaluate(() => document.activeElement?.id); await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(focus);
  await page.keyboard.press('Shift+Tab');
  await page.locator('#board-title').focus(); await page.keyboard.press('Tab'); expect(await active(page)).toBe(colors[0]);
  await chooseTool(page, '文字'); await page.mouse.click(600, 400); await page.locator('#text-editor').fill('输入期间');
  await page.keyboard.press('Tab'); expect(await active(page)).toBe(colors[0]);
});

test('color shortcuts change selected elements, undo correctly and preserve locked elements', async ({ page }) => {
  await blank(page); await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(600, 300);
  const initial = await active(page);
  await page.keyboard.press('Tab'); const next = await active(page); expect(next).not.toBe(initial);
  await page.keyboard.press('Control+z'); expect(await active(page)).toBe(initial);
  await page.keyboard.press('Control+Shift+z'); expect(await active(page)).toBe(next);
  await contextAction(page, 'lock'); await page.keyboard.press('Tab'); expect(await active(page)).toBe(next);
});

test('both custom palettes recover invalid HEX and commit while cancel restores the active edit', async ({ page }) => {
  await blank(page);
  for (const property of ['描边', '填充']) {
    await page.getByRole('button', { name: `${property}调色板`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `${property}调色板`, exact: true }); await expect(dialog).toBeVisible();
    await dialog.getByLabel('HEX 颜色', { exact: true }).fill('bad-color');
    await dialog.locator('.color-picker-heading').click();
    await expect(dialog.getByLabel('HEX 颜色', { exact: true })).toHaveValue(property === '描边' ? '#283e36' : '#e6eee5');
    await dialog.getByLabel('HEX 颜色', { exact: true }).fill(property === '描边' ? '#123abc' : '#fedcba');
    await dialog.getByRole('button', { name: '应用颜色', exact: true }).click(); await expect(dialog).not.toBeVisible();
  }
  await expect(page.locator('#stroke-colors [data-color-index="0"]')).toHaveAttribute('data-color', '#123abc');
  await page.getByRole('button', { name: '描边调色板', exact: true }).click();
  await page.getByRole('dialog', { name: '描边调色板', exact: true }).getByLabel('HEX 颜色', { exact: true }).fill('#ffffff'); await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '描边调色板', exact: true })).toHaveAttribute('data-current-color', '#123abc');
  await chooseTool(page, '矩形'); await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
  await expect(page.locator('#save-status')).toContainText('已保存在本机'); await page.reload();
  await chooseTool(page, '选择工具'); await page.mouse.click(600, 300);
  await expect(page.getByRole('button', { name: '填充调色板', exact: true })).toHaveAttribute('data-current-color', '#fedcba');
});

test('shortcut list includes color cycling and can rebind, detect conflicts, persist and reset', async ({ page }) => {
  await blank(page); await page.locator('#help-button').click();
  const next = page.locator('[data-shortcut="color-next"]'); await expect(next).toHaveText('Tab');
  await next.click(); await page.keyboard.press('v'); await expect(page.locator('#shortcut-status')).toContainText('选择');
  await next.click(); await page.keyboard.press('q'); await expect(next).toHaveText('Q');
  await page.getByRole('button', { name: '关闭帮助', exact: true }).click();
  await page.mouse.click(1000, 650); const before = await active(page); await page.keyboard.press('q'); expect(await active(page)).not.toBe(before);
  await page.reload(); await page.locator('#help-button').click(); await expect(next).toHaveText('Q');
  await page.locator('#reset-shortcuts').click(); await expect(next).toHaveText('Tab');
  await expect(page.locator('[data-shortcut="color-previous"]')).toHaveText('Shift + Tab');
});

test('tool bindings and toolbar hints update together and old keys stop triggering', async ({ page }) => {
  await blank(page); await page.locator('#help-button').click();
  const pen = page.locator('[data-shortcut="tool:pen"]'); await pen.click(); await page.keyboard.press('q');
  await page.getByRole('button', { name: '关闭帮助', exact: true }).click();
  await expect(page.locator('[data-family="pen"]')).toHaveAttribute('data-tooltip', /Q/);
  await page.mouse.click(1000, 650); await page.keyboard.press('p'); await expect(page.locator('[data-family="select"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('q'); await expect(page.locator('[data-family="pen"]')).toHaveAttribute('aria-pressed', 'true');
  await page.reload(); await expect(page.locator('#save-status')).toContainText('已保存在本机'); await page.keyboard.press('q'); await expect(page.locator('[data-family="pen"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#help-button').click(); await pen.click(); await page.keyboard.press('Backspace'); await expect(pen).toHaveText('未设置');
  await pen.click(); await page.keyboard.press('Tab'); await expect(page.locator('#shortcut-status')).toContainText('下一个描边');
});

test('mobile palettes and shortcut settings stay in view in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await blank(page); await page.locator('#expand-properties').click();
  for (let i = 0; i < 2; i++) {
    for (const property of ['描边', '填充']) {
      await page.getByRole('button', { name: `${property}调色板`, exact: true }).click();
      const picker = page.getByRole('dialog', { name: `${property}调色板`, exact: true }), box = (await picker.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(8); expect(box.x + box.width).toBeLessThanOrEqual(382); expect(box.y + box.height).toBeLessThanOrEqual(836);
      await picker.getByLabel('HEX 颜色').press('Tab');
      await expect(picker.getByRole('button', { name: '画布取色', exact: true })).toBeFocused();
      await page.keyboard.press('Escape');
    }
    await page.locator('#help-button').click(); await expect(page.locator('#help-dialog')).toBeVisible();
    const state = await page.locator('#help-dialog').evaluate(el => ({ box: el.getBoundingClientRect().toJSON(), scroll: el.scrollWidth, client: el.clientWidth }));
    expect(state.box.x).toBeGreaterThanOrEqual(8); expect(state.box.right).toBeLessThanOrEqual(382); expect(state.scroll).toBeLessThanOrEqual(state.client);
    await expect(page.locator('[data-shortcut="color-next"]')).toBeInViewport();
    await page.getByRole('button', { name: '关闭帮助', exact: true }).click(); await page.locator('#theme-button').click();
  }
});

test('palette grids are five square colors wide and dark UI labels have sufficient contrast', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await blank(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    if (await page.locator('#properties').isHidden()) await page.locator('#expand-properties').click();
    for (const property of ['stroke', 'fill']) {
      const boxes = await page.locator(`#${property}-colors [data-color]`).evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().toJSON()));
      expect(boxes).toHaveLength(10);
      for (const box of boxes) { expect(Math.abs(box.width - box.height)).toBeLessThan(1); expect(box.x + box.width).toBeLessThan(width); }
      expect(boxes[4].y).toBe(boxes[0].y); expect(boxes[5].y).toBeGreaterThan(boxes[0].y);
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 }); await page.locator('#theme-button').click();
  const readContrast = async (selectors: string[]) => page.evaluate(selectors => {
    const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const lum = (value: number[]) => value.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    return selectors.map(selector => {
      const el = document.querySelector(selector)!, style = getComputedStyle(el); let parent: Element | null = el, background = '';
      while (parent) { const color = getComputedStyle(parent).backgroundColor; if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') { background = color; break; } parent = parent.parentElement; }
      const a = lum(rgb(style.color)), b = lum(rgb(background)); return { selector, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  }, selectors);
  for (const result of await readContrast(['#library-button', '#theme-button', '#property-title', '[data-dash="false"]', '#font-size', '#zoom-value'])) expect(result.ratio, result.selector).toBeGreaterThanOrEqual(4.5);
  await page.locator('#export-button').click(); for (const result of await readContrast(['[data-action="export-file"]', '#export-menu .menu-title'])) expect(result.ratio, result.selector).toBeGreaterThanOrEqual(4.5);
  await page.mouse.click(1000, 700); await page.locator('[data-family="shapes"]').click();
  for (const result of await readContrast(['[data-tool-child="rect"]', '[data-tool-child="ellipse"]'])) expect(result.ratio, result.selector).toBeGreaterThanOrEqual(4.5);
  await expect(page.locator('#command-button, #command-dialog')).toHaveCount(0);
});
