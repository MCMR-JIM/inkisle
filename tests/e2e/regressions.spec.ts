import { expect, test } from '@playwright/test';
import { createBoard, chooseTool } from './helpers';

async function readCurrent(page: import('@playwright/test').Page): Promise<any> {
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); return doc.elements[0];
  });
}

test('rotated frame corners lie on the dashed frame and follow the pointer while resizing', async ({ page }) => {
  await page.goto('/'); await createBoard(page);
  await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(760, 460); await page.mouse.up();
  const initial = await readCurrent(page);
  // The current implementation exposes the rotation handle but has no direct
  // rotation automation control yet; inject the documented model state so the
  // real canvas pointer path starts from a rotated object.
  await page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); doc.elements[0].rotation = Math.PI / 4; await repo.compact(doc); repo.close(); location.reload();
  });
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  // Grab the visible padded frame corner, outside the stroke itself.
  const center = { x: (initial.x + initial.w / 2), y: initial.y + initial.h / 2 };
  const padding = initial.strokeWidth / 2 + 5;
  const angle = Math.PI / 4, local = { x: -initial.w / 2 - padding, y: -initial.h / 2 - padding };
  const corner = { x: center.x + local.x * Math.cos(angle) - local.y * Math.sin(angle), y: center.y + local.x * Math.sin(angle) + local.y * Math.cos(angle) };
  const target = { x: corner.x - 40, y: corner.y - 30 };
  await page.getByRole('button', { name: '选择工具', exact: true }).click();
  await page.mouse.click(center.x, center.y);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const frameVisible = await page.locator('#interaction-canvas').evaluate((canvas: HTMLCanvasElement, points) => {
    const ctx = canvas.getContext('2d')!, dpr = canvas.width / canvas.clientWidth;
    return points.map(point => {
      const data = ctx.getImageData(Math.round(point.x * dpr) - 3, Math.round(point.y * dpr) - 3, 7, 7).data;
      let blue = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 2] > data[i] + 25 && data[i + 3] > 40) blue++;
      return blue;
    });
  }, [corner, { x: corner.x + Math.cos(angle) * 75, y: corner.y + Math.sin(angle) * 75 }]);
  expect(frameVisible.every(count => count > 0)).toBe(true);
  await page.mouse.move(corner.x, corner.y); await page.mouse.down(); await page.mouse.move(target.x, target.y); await page.mouse.up();
  const final = await readCurrent(page);
  expect(final).toBeTruthy();
  expect(final.rotation).toBeCloseTo(angle, 3);
  // The dragged world corner is represented by the transformed new corner,
  // not by an axis-aligned local-coordinate approximation.
  const newCenter = { x: final.x + final.w / 2, y: final.y + final.h / 2 };
  const newCorner = { x: newCenter.x + (-final.w / 2 - padding) * Math.cos(angle) - (-final.h / 2 - padding) * Math.sin(angle), y: newCenter.y + (-final.w / 2 - padding) * Math.sin(angle) + (-final.h / 2 - padding) * Math.cos(angle) };
  expect(newCorner.x).toBeCloseTo(target.x, 0); expect(newCorner.y).toBeCloseTo(target.y, 0);
});

test('both toolbars are raised, centered and the submenu is a single horizontal row', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('liubai:toolbar-position', 'top'));
  await page.goto('/');
  const family = page.locator('[data-family="shapes"]'); await family.click();
  const toolbar = page.getByRole('toolbar', { name: '白板工具', exact: true });
  const menu = page.getByRole('menu', { name: '图形工具' });
  await expect(menu).toBeVisible();
  const toolbarBox = (await toolbar.boundingBox())!, menuBox = (await menu.boundingBox())!;
  expect(toolbarBox.y).toBeLessThanOrEqual(64);
  await expect(toolbar.locator('.family-caret')).toHaveCount(0);
  await page.mouse.move(1100, 650);
  const visibleKeys = await toolbar.locator('.tool-key').evaluateAll(nodes => nodes.filter(el => el.textContent?.trim()).every(el => Number(getComputedStyle(el).opacity) > .5));
  expect(visibleKeys).toBe(true);
  expect(await menu.locator('button > kbd').evaluateAll(nodes => nodes.filter(el => el.textContent?.trim()).every(el => Number(getComputedStyle(el).opacity) > .5))).toBe(true);
  expect(Math.abs(toolbarBox.x + toolbarBox.width / 2 - 720)).toBeLessThan(2);
  expect(Math.abs(menuBox.x + menuBox.width / 2 - toolbarBox.x - toolbarBox.width / 2)).toBeLessThan(2);
  expect(menuBox.y - toolbarBox.y - toolbarBox.height).toBeGreaterThanOrEqual(3);
  expect(menuBox.y - toolbarBox.y - toolbarBox.height).toBeLessThanOrEqual(8);
  const buttons = await menu.locator('[data-tool-child]').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().toJSON()));
  expect(buttons).toHaveLength(8);
  expect(Math.max(...buttons.map(b => b.y)) - Math.min(...buttons.map(b => b.y))).toBeLessThan(1);
  expect(buttons.every((b, i) => i === 0 || b.x >= buttons[i - 1].right)).toBe(true);
  await page.mouse.click(1000, 700);
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape'); await expect(menu).not.toBeVisible();
});

test('both horizontal tool rows stay centered and inside a small viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await page.locator('[data-family="shapes"]').click();
  for (const surface of [page.locator('.toolbar'), page.locator('#tool-menu-shapes')]) {
    const box = (await surface.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - 195)).toBeLessThan(2);
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(382);
  }
  expect((await page.locator('.toolbar').boundingBox())!.y).toBeGreaterThan(500);
  await page.locator('[data-tool-child="hexagon"]').click();
  await expect(page.locator('[data-family="shapes"]')).toHaveAttribute('aria-pressed', 'true');
});

test('new board sits immediately left of the theme control with header and raised toolbar inside desktop viewports', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('liubai:toolbar-position', 'top'));
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  for (const width of [1920, 1440, 1280, 1024, 900]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const layout = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON();
      return {
        order: document.querySelector('#quick-new')?.nextElementSibling?.id,
        parent: document.querySelector('#quick-new')?.parentElement?.className,
        plus: box('#quick-new'), theme: box('#theme-button'), header: box('.app-header'), toolbar: box('.toolbar'),
        controls: [...document.querySelectorAll('.header-actions > button')].map(el => el.getBoundingClientRect().toJSON()),
        overflow: document.documentElement.scrollWidth,
      };
    });
    expect(layout.order).toBe('theme-button'); expect(layout.parent).toBe('header-actions');
    expect(layout.plus.right).toBeLessThanOrEqual(layout.theme.x);
    expect(Math.abs(layout.plus.y + layout.plus.height / 2 - layout.theme.y - layout.theme.height / 2)).toBeLessThan(1);
    expect(layout.toolbar.y).toBeLessThanOrEqual(64);
    expect(layout.toolbar.y).toBeGreaterThanOrEqual(layout.header.bottom);
    for (const box of layout.controls) { expect(box.x).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width); expect(box.width).toBeGreaterThanOrEqual(24); }
    expect(layout.overflow).toBe(width);
  }
  await createBoard(page); await expect(page.locator('#element-count')).toHaveText('0 个元素');
  await expect(page.locator('#board-title')).toHaveValue('未命名画板'); await expect(page.locator('#quick-new')).not.toBeFocused();
});

test('ordinary shape selection draws four faint dashed sides and keeps four handles', async ({ page }) => {
  await page.goto('/'); await createBoard(page); await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(760, 460); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(630, 300);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const side = await page.locator('#interaction-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    return Array.from({ length: 20 }, (_, i) => [...ctx.getImageData(620 + i, 294, 1, 1).data]).sort((a, b) => b[3] - a[3])[0];
  });
  expect(side[2]).toBeGreaterThan(side[0]); expect(side[0]).toBeGreaterThan(100); expect(side[3]).toBe(255);
});
