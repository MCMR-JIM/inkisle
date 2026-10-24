import { expect, test, type Page } from '@playwright/test';
import type { BoardElement } from '../../src/core/model';

async function blank(page: Page) {
  await page.goto('/'); await page.locator('#quick-new').click();
  await expect(page.locator('#board-title')).toHaveValue('未命名画板');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.keyboard.press('p');
}

async function read(page: Page): Promise<BoardElement[]> {
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); return doc.elements;
  });
}

async function draw(page: Page, y: number) {
  await page.mouse.move(500, y); await page.mouse.down(); await page.mouse.move(750, y, { steps: 8 }); await page.mouse.up();
}

test('highlighter has its own translucent wide style and restores ordinary tools without moving the sidebar', async ({ page }) => {
  await blank(page);
  await page.locator('[data-width="4"]').click(); await page.locator('#opacity').fill('70'); await page.locator('#opacity').dispatchEvent('change');
  await page.locator('#stroke-colors [data-color="#639bba"]').click();
  const panel = await page.locator('#properties').boundingBox();
  await page.getByRole('button', { name: '荧光笔', exact: true }).click();
  await expect(page.locator('#pressure-toggle')).toBeDisabled();
  expect(await page.locator('#properties').boundingBox()).toEqual(panel);
  await draw(page, 320);
  const marker = (await read(page))[0];
  expect(marker.kind).toBe('pen'); expect(marker.stroke).toBe('#f2d64b'); expect(marker.strokeWidth).toBe(20); expect(marker.opacity).toBe(.35); expect(marker.pressureEnabled).toBe(false);
  await page.locator('[data-family="shapes"]').click(); await page.mouse.move(500, 430); await page.mouse.down(); await page.mouse.move(700, 530); await page.mouse.up();
  const shape = (await read(page))[1];
  expect(shape.kind).toBe('rect'); expect(shape.stroke).toBe('#639bba'); expect(shape.strokeWidth).toBe(4); expect(shape.opacity).toBe(.7);
  await page.keyboard.press('p'); await expect(page.getByRole('button', { name: '荧光笔', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '普通画笔', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#pressure-toggle')).toBeEnabled();
  await draw(page, 600); const ordinary = (await read(page))[2];
  expect(ordinary.stroke).toBe('#639bba'); expect(ordinary.strokeWidth).toBe(4); expect(ordinary.opacity).toBe(.7); expect(ordinary.pressureEnabled).toBe(true);
  await page.getByRole('button', { name: '荧光笔', exact: true }).click();
  await page.keyboard.press('Control+z'); expect(await read(page)).toHaveLength(2);
  await page.keyboard.press('Control+Shift+z'); expect(await read(page)).toHaveLength(3);
  await page.reload(); await read(page); await page.keyboard.press('p'); await expect(page.getByRole('button', { name: '荧光笔', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('highlighter opacity stays uniform through self-overlap, PNG/SVG and source-file reopening', async ({ page }) => {
  await blank(page); await page.getByRole('button', { name: '荧光笔', exact: true }).click();
  await page.mouse.move(500, 350); await page.mouse.down(); await page.mouse.move(750, 350, { steps: 8 }); await page.mouse.move(500, 350, { steps: 8 }); await page.mouse.up();
  const [marker] = await read(page);
  const alphas = await page.evaluate(async marker => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { drawElement } = await load('/src/engine/draw.ts'), { exportPNG, exportSVG } = await load('/src/engine/export.ts');
    const { createDocument } = await load('/src/core/model.ts'), { unionBounds } = await load('/src/core/geometry.ts');
    const doc = createDocument(); doc.elements = [marker]; const bounds = unionBounds(doc.elements);
    const result: number[] = [];
    for (const format of ['canvas', 'png', 'svg']) {
      const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 700; const ctx = canvas.getContext('2d')!;
      if (format === 'canvas') drawElement(ctx, marker);
      else {
        const options = { transparent: true, scale: 1, padding: 40 };
        const blob = format === 'png' ? await exportPNG(doc, doc.elements, options) : exportSVG(doc, doc.elements, options);
        const url = URL.createObjectURL(blob), image = new Image(); image.src = url; await image.decode();
        ctx.drawImage(image, bounds.x - 40, bounds.y - 40); URL.revokeObjectURL(url);
      }
      for (const x of [540, 580, 620]) result.push(ctx.getImageData(x, 350, 1, 1).data[3]);
    }
    return result;
  }, marker);
  for (const alpha of alphas) expect(Math.abs(alpha - 89)).toBeLessThanOrEqual(1);
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const download = await downloading;
  await page.locator('#import-file').setInputFiles((await download.path())!); await expect(page.locator('#toast')).toContainText('画板已导入');
  expect((await read(page))[0]).toMatchObject({ stroke: marker.stroke, strokeWidth: 20, opacity: .35, pressureEnabled: false });
  await page.reload(); expect((await read(page))[0].opacity).toBe(.35);
});

test('curved translucent ink keeps its color and coverage through release and the canvas handoff', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await blank(page); if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#theme-button').click();
    await page.getByRole('button', { name: '荧光笔', exact: true }).click();
    await draw(page, 400);
    const result = await page.locator('#interaction-canvas').evaluate(async (overlay: HTMLCanvasElement) => {
      const main = document.querySelector<HTMLCanvasElement>('#canvas')!;
      overlay.setPointerCapture = () => {};
      const send = (type: string, x: number, y: number) => overlay.dispatchEvent(new PointerEvent(type, { pointerId: 81, pointerType: 'mouse', clientX: x, clientY: y, pressure: .5, buttons: type === 'pointerup' ? 0 : 1, bubbles: true }));
      const composite = (top: HTMLCanvasElement) => {
        const canvas = document.createElement('canvas'); canvas.width = main.width; canvas.height = main.height;
        const ctx = canvas.getContext('2d')!; ctx.drawImage(main, 0, 0); ctx.drawImage(top, 0, 0);
        return ctx.getImageData(480, 300, 450, 200).data;
      };
      const y = (x: number) => 400 + 40 * Math.sin((x - 500) / 24);
      send('pointerdown', 500, y(500)); for (let x = 501; x <= 900; x++) send('pointermove', x, y(x));
      await new Promise(requestAnimationFrame);
      const oldOverlay = document.createElement('canvas'); oldOverlay.width = overlay.width; oldOverlay.height = overlay.height;
      oldOverlay.getContext('2d')!.drawImage(overlay, 0, 0);
      const before = composite(oldOverlay);
      send('pointerup', 900, y(900)); await new Promise(requestAnimationFrame);
      const after = composite(overlay);
      // Desynchronized canvases may present the committed base before clearing
      // the old preview. That intermediate presentation must not darken ink.
      const handoff = composite(oldOverlay);
      let releaseChange = 0, handoffChange = 0;
      for (let i = 0; i < before.length; i++) {
        releaseChange = Math.max(releaseChange, Math.abs(before[i] - after[i]));
        handoffChange = Math.max(handoffChange, Math.abs(before[i] - handoff[i]));
      }
      return { releaseChange, handoffChange };
    });
    expect(result.releaseChange, theme).toBeLessThanOrEqual(1);
    expect(result.handoffChange, theme).toBeLessThanOrEqual(1);
  }
});

test('both pen modes remain accessible beside top and bottom toolbars at desktop and mobile widths', async ({ page }) => {
  await blank(page);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const position of ['top', 'bottom']) {
      await page.locator('#workspace-settings-button').click(); await page.locator('#toolbar-position').selectOption(position);
      await page.getByRole('button', { name: '关闭工作区设置', exact: true }).click(); await page.keyboard.press('p');
      await page.getByRole('button', { name: '荧光笔', exact: true }).click();
      const box = (await page.locator('#pressure-setting').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(844);
      await page.getByRole('button', { name: '普通画笔', exact: true }).click(); await page.locator('#theme-button').click();
    }
  }
});
