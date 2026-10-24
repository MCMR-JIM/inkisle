import { expect, test, type Page } from '@playwright/test';
import type { BoardDocument } from '../../src/core/model';
import { selectValue } from './helpers';

async function read(page: Page): Promise<BoardDocument> {
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(); try { return await repo.load(localStorage.getItem('liubai:last-board')); } finally { repo.close(); }
  });
}

async function fixture(page: Page) {
  await page.goto('/'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  const bytes = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { createDocument, createElement } = await load('/src/core/model.ts'), { encodeDocument } = await load('/src/core/codec.ts');
    const doc = createDocument('Eraser test'); doc.elements = [createElement('note', { x: 400, y: 250, w: 400, h: 300, text: 'Eraser', fill: '#faefc9' })];
    return [...encodeDocument(doc)];
  });
  await page.locator('#import-file').setInputFiles({ name: 'eraser.inkisle', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
  await expect(page.locator('#board-title')).toHaveValue('Eraser test');
  await page.keyboard.press('e');
}

test('eraser slider reuses the floating bar, updates live with keyboard and remembers size without moving the sidebar', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  const before = await page.locator('#properties').boundingBox(); await page.keyboard.press('e');
  await expect(page.locator('#tool-menu-eraser')).toBeVisible();
  await expect(page.locator('#tool-menu-eraser')).toHaveClass(/floating-bar/);
  const slider = page.getByRole('slider', { name: '橡皮大小', exact: true });
  await expect(slider).toHaveValue('20'); await slider.fill('40');
  await expect(page.locator('#eraser-size-value')).toHaveText('40 px'); await expect(slider).toHaveAttribute('aria-valuetext', '40 px');
  await slider.press('ArrowRight'); await expect(slider).toHaveValue('42');
  expect(await page.locator('#properties').boundingBox()).toEqual(before);
  await page.mouse.click(1150, 700); await page.keyboard.press('v'); await expect(page.locator('#tool-menu-eraser')).toBeHidden();
  await page.keyboard.press('e'); await expect(slider).toHaveValue('42');
  await page.reload(); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved'); await page.keyboard.press('e'); await expect(slider).toHaveValue('42');
});

test('plain wheel adjusts only eraser size while modifier zoom, Space panning and other tools keep their camera behavior', async ({ page }) => {
  await fixture(page); const before = (await read(page)).camera;
  await page.mouse.move(900, 400); await page.mouse.wheel(0, -100);
  await expect(page.locator('#eraser-size')).toHaveValue('22'); await expect(page.locator('#eraser-size-value')).toHaveText('22 px');
  expect((await read(page)).camera).toEqual(before);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  const zoomed = (await read(page)).camera; expect(zoomed.zoom).toBeGreaterThan(before.zoom); await expect(page.locator('#eraser-size')).toHaveValue('22');
  await page.keyboard.down('Space'); await page.mouse.wheel(0, 100); await page.keyboard.up('Space');
  const panned = (await read(page)).camera; expect(panned.y).toBeCloseTo(zoomed.y - 100, 5); await expect(page.locator('#eraser-size')).toHaveValue('22');
  await page.locator('#interaction-canvas').evaluate(el => el.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, clientX: 900, clientY: 400, bubbles: true, cancelable: true })));
  await expect(page.locator('#eraser-size')).toHaveValue('24'); expect((await read(page)).camera).toEqual(panned);
  await page.mouse.wheel(0, -10000); await expect(page.locator('#eraser-size')).toHaveValue('120');
  await page.mouse.wheel(0, 10000); await expect(page.locator('#eraser-size')).toHaveValue('4');
  await page.keyboard.press('v'); await page.mouse.wheel(0, 100);
  expect((await read(page)).camera.y).toBeCloseTo(panned.y - 100, 5);
});

test('cursor diameter matches actual erasure at 100% and 200% zoom', async ({ page }) => {
  await fixture(page); await page.locator('#eraser-size').fill('40');
  await page.locator('#interaction-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')!, original = context.arc.bind(context);
    Object.assign(window, { eraserPreviewRadius: 0 });
    context.arc = (x, y, radius, start, end, counterclockwise) => {
      (window as unknown as { eraserPreviewRadius: number }).eraserPreviewRadius = radius * context.getTransform().a;
      original(x, y, radius, start, end, counterclockwise);
    };
  });
  for (const zoom of [1, 2]) {
    await selectValue(page, '#zoom-value', zoom); await page.keyboard.press('e');
    await page.mouse.move(650, 400); await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(await page.evaluate(() => (window as unknown as { eraserPreviewRadius: number }).eraserPreviewRadius)).toBeCloseTo(20, 5);
    await page.mouse.click(650, 400); const doc = await read(page);
    expect(doc.elements[0].erasures!.at(-1)!.radiusX).toBeCloseTo(20 / zoom, 5);
  }
});

test('resizing while erasing preserves each segment radius and one undo through persistence and source round-trip', async ({ page }) => {
  await fixture(page); await page.mouse.move(500, 400); await page.mouse.down(); await page.mouse.move(550, 400);
  await page.mouse.wheel(0, -1000); await expect(page.locator('#eraser-size')).toHaveValue('40');
  await page.mouse.move(650, 400); await page.mouse.up();
  const erased = (await read(page)).elements[0]; expect(erased.erasures!.map(stroke => stroke.radiusX)).toEqual([10, 20]);
  await page.keyboard.press('Control+z'); expect((await read(page)).elements[0].erasures).toBeUndefined();
  await page.keyboard.press('Control+Shift+z'); expect((await read(page)).elements[0].erasures).toEqual(erased.erasures);
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const download = await downloading;
  await page.locator('#import-file').setInputFiles((await download.path())!); await expect(page.locator('#toast')).toContainText('画板已导入');
  expect((await read(page)).elements[0].erasures).toEqual(erased.erasures);
  await page.reload(); expect((await read(page)).elements[0].erasures).toEqual(erased.erasures);
});

test('eraser range fits either toolbar edge and narrow viewports in both themes', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const position of ['top', 'bottom']) {
      await page.locator('#workspace-settings-button').click(); await selectValue(page, '#toolbar-position', position);
      await page.getByRole('button', { name: '关闭工作区设置', exact: true }).click(); await page.keyboard.press('e');
      const box = (await page.locator('#tool-menu-eraser').boundingBox())!, toolbar = (await page.locator('.toolbar').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(12); expect(box.x + box.width).toBeLessThanOrEqual(width - 12);
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(844);
      expect(box.x + box.width / 2).toBeCloseTo(toolbar.x + toolbar.width / 2, 1);
      if (position === 'bottom') expect(box.y + box.height).toBeLessThan(toolbar.y); else expect(box.y).toBeGreaterThan(toolbar.y + toolbar.height);
      await page.locator('#eraser-size').fill('80'); await expect(page.locator('#eraser-size-value')).toHaveText('80 px');
      await page.locator('#theme-button').click();
    }
  }
});
