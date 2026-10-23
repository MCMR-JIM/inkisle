import { expect, test, type Page } from '@playwright/test';
import { chooseTool } from './helpers';
import type { BoardElement } from '../../src/core/model';

async function setup(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
  await chooseTool(page, '画笔'); await page.locator('[data-width="7"]').click();
}

async function stroke(page: Page, device: string, y: number, stepMs = 16, finish = true) {
  return page.locator('#interaction-canvas').evaluate(async (canvas: HTMLCanvasElement, options) => {
    canvas.setPointerCapture = () => {};
    const send = (type: string, x: number, pressure: number, time: number) => {
      const event = new PointerEvent(type, { pointerId: 71, pointerType: options.device, clientX: x, clientY: options.y, pressure, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'timeStamp', { value: time }); canvas.dispatchEvent(event);
    };
    send('pointerdown', 500, options.device === 'pen' ? .05 : .5, 100);
    for (let i = 1; i <= 40; i++) send('pointermove', 500 + i * 6, options.device === 'pen' ? i < 10 ? .05 : i < 30 ? 1 : .05 : .5, 100 + i * options.stepMs);
    await new Promise(requestAnimationFrame);
    const pixels = (context: CanvasRenderingContext2D, x: number, alpha: boolean) => {
      const data = context.getImageData(x, options.y - 10, 1, 21).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += alpha ? data[i + 3] / 255 : Math.max(0, (248 - data[i]) / (248 - 40));
      return sum;
    };
    const preview = [530, 640, 720].map(x => pixels(canvas.getContext('2d')!, x, true));
    if (!options.finish) return { preview, committed: [] };
    send('pointerup', 740, 0, 100 + 41 * options.stepMs);
    await new Promise(requestAnimationFrame);
    const main = document.querySelector<HTMLCanvasElement>('#canvas')!.getContext('2d')!;
    return { preview, committed: [530, 640, 720].map(x => pixels(main, x, false)) };
  }, { device, y, stepMs, finish });
}

async function savedElements(page: Page) {
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); return doc.elements;
  });
}

test('pen pressure stays visible after release, undo, persistence and file round-trip', async ({ page }) => {
  await setup(page);
  await expect(page.getByRole('switch', { name: '压感', exact: true })).toBeChecked();
  const { preview, committed } = await stroke(page, 'pen', 350);
  expect(preview[1] - preview[0]).toBeGreaterThan(3);
  expect(committed[1] - committed[0]).toBeGreaterThan(3);
  for (let i = 0; i < 3; i++) expect(Math.abs(preview[i] - committed[i])).toBeLessThan(.8);
  const before = await savedElements(page);
  expect(before[0].pressureEnabled).toBe(true); expect(before[0].points.length).toBeGreaterThan(4);
  await page.keyboard.press('Control+z'); await expect(page.locator('#element-count')).toHaveText('0 个元素');
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await savedElements(page); await page.reload(); expect(await savedElements(page)).toEqual(before);
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const file = await downloading;
  await page.locator('#import-file').setInputFiles((await file.path())!);
  await expect(page.locator('#toast')).toContainText('画板已导入'); expect(await savedElements(page)).toEqual(before);
});

test('mouse speed changes width and disabling pressure restores equal width and remembers preference', async ({ page }) => {
  await setup(page);
  const slow = await stroke(page, 'mouse', 350, 60), fast = await stroke(page, 'mouse', 430, 2);
  expect(slow.committed[1] - fast.committed[1]).toBeGreaterThan(1.5);
  const elements = await savedElements(page);
  expect(elements[0].points.at(-1).pressure).toBeGreaterThan(elements[1].points.at(-1).pressure);
  const toggle = page.getByRole('switch', { name: '压感', exact: true });
  await toggle.click(); await expect(toggle).not.toBeChecked();
  const equal = await stroke(page, 'pen', 510);
  expect(Math.abs(equal.committed[1] - equal.committed[0])).toBeLessThan(.5);
  await savedElements(page); await page.reload(); await chooseTool(page, '画笔'); await expect(toggle).not.toBeChecked();
});

test('pressure strokes keep width and erasure in SVG and PNG without alpha seams', async ({ page }) => {
  await setup(page); await stroke(page, 'pen', 350);
  await savedElements(page);
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { Repository } = await load('/src/storage/repository.ts');
    const { exportPNG, exportSVG } = await load('/src/engine/export.ts');
    const { createElement } = await load('/src/core/model.ts');
    const { drawElement } = await load('/src/engine/draw.ts');
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close();
    const svg = await exportSVG(doc).text();
    const rasterize = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob); const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0); bitmap.close(); return canvas;
    };
    const svgBlob = exportSVG(doc), url = URL.createObjectURL(svgBlob), image = new Image(); image.src = url; await image.decode();
    const svgCanvas = document.createElement('canvas'); svgCanvas.width = image.naturalWidth; svgCanvas.height = image.naturalHeight; svgCanvas.getContext('2d')!.drawImage(image, 0, 0); URL.revokeObjectURL(url);
    const png = await rasterize(await exportPNG(doc));
    const thickness = (canvas: HTMLCanvasElement, x: number) => {
      const ctx = canvas.getContext('2d')!, data = ctx.getImageData(x, 0, 1, canvas.height).data;
      let sum = 0; for (let i = 0; i < data.length; i += 4) sum += Math.max(0, (248 - data[i]) / (248 - 40)); return sum;
    };
    const thinX = 530 - 496.5, thickX = 640 - 496.5;
    const svgWidths = [thinX, thickX].map(x => thickness(svgCanvas, Math.round(x + 40)));
    const pngWidths = [thinX, thickX].map(x => thickness(png, Math.round((x + 48) * 2)) / 2);
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    const el = createElement('pen', { pressureEnabled: true, opacity: .5, strokeWidth: 20, x: 20, y: 40, points: [{ x: 0, y: 0, pressure: 1 }, { x: 100, y: 0, pressure: 1 }, { x: 0, y: 0, pressure: 1 }] });
    drawElement(ctx, el); const alpha = ctx.getImageData(60, 40, 1, 1).data[3];
    return { svg, svgWidths, pngWidths, alpha };
  });
  expect(result.svg).toContain('<path'); expect(result.svg).not.toContain('<polyline');
  expect(result.svgWidths[1] - result.svgWidths[0]).toBeGreaterThan(3);
  for (let i = 0; i < 2; i++) expect(Math.abs(result.svgWidths[i] - result.pngWidths[i])).toBeLessThan(1);
  expect(result.alpha).toBeGreaterThanOrEqual(127); expect(result.alpha).toBeLessThanOrEqual(128);
  await chooseTool(page, '橡皮擦');
  await page.mouse.move(640, 320); await page.mouse.down(); await page.mouse.move(640, 380); await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  const parts = await savedElements(page);
  expect(parts.every((el: { path: { strokes: { pressureEnabled: boolean }[] } }) => el.path.strokes.every(stroke => stroke.pressureEnabled))).toBe(true);
  await page.reload(); await expect(page.locator('#element-count')).toHaveText('2 个元素');
});

test('touch remains equal width and the pressure switch works on a selected stroke', async ({ page }) => {
  await setup(page);
  const touch = await stroke(page, 'touch', 350);
  expect(Math.abs(touch.committed[1] - touch.committed[0])).toBeLessThan(.5);
  await stroke(page, 'pen', 430); await chooseTool(page, '选择工具'); await page.mouse.click(640, 430);
  const toggle = page.getByRole('switch', { name: '压感', exact: true });
  await expect(toggle).toBeChecked(); await toggle.click();
  expect((await savedElements(page))[1].pressureEnabled).toBe(false);
  await page.keyboard.press('Control+z'); expect((await savedElements(page))[1].pressureEnabled).toBe(true);
});

test('coalesced stationary pressure and final pointerup coordinates are preserved', async ({ page }) => {
  await setup(page);
  await page.locator('#interaction-canvas').evaluate((canvas: HTMLCanvasElement) => {
    canvas.setPointerCapture = () => {};
    const event = (type: string, x: number, pressure: number, time: number) => {
      const e = new PointerEvent(type, { pointerId: 81, pointerType: 'pen', clientX: x, clientY: 350, pressure, buttons: type === 'pointerup' ? 0 : 1, bubbles: true });
      Object.defineProperty(e, 'timeStamp', { value: time }); return e;
    };
    canvas.dispatchEvent(event('pointerdown', 500, .05, 100));
    const move = event('pointermove', 600, .05, 220);
    Object.defineProperty(move, 'getCoalescedEvents', { value: () => [event('pointermove', 550, .05, 130), event('pointermove', 550, 1, 160), event('pointermove', 575, 1, 190), move] });
    canvas.dispatchEvent(move); canvas.dispatchEvent(event('pointerup', 650, 0, 240));
  });
  const [pen] = await savedElements(page);
  expect(pen.points.at(-1).x).toBe(150);
  expect(pen.points.at(-1).pressure).toBe(pen.points.at(-2).pressure);
  expect(pen.points.some((p: { x: number; pressure: number }) => p.x === 50 && p.pressure > .9)).toBe(true);
});

test('mouse simulation is zoom-independent and pressure settings fit desktop and mobile themes', async ({ page }) => {
  await setup(page); await stroke(page, 'mouse', 350, 16);
  const [first] = await savedElements(page);
  await page.locator('#zoom-in').click(); await page.locator('#zoom-in').click();
  await stroke(page, 'mouse', 430, 16);
  const [, second] = await savedElements(page);
  expect(second.points[0].pressure).toBe(first.points[0].pressure);
  expect(second.points.at(-1).pressure).toBeCloseTo(first.points.at(-1).pressure, 8);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    for (let i = 0; i < 2; i++) {
      const toggle = page.getByRole('switch', { name: '压感', exact: true }), box = (await toggle.boundingBox())!;
      const toolbar = (await page.locator('.toolbar').boundingBox())!;
      expect(box.x).toBeGreaterThan(0); expect(box.x + box.width).toBeLessThan(width); expect(box.y + box.height).toBeLessThan(toolbar.y);
      await expect(toggle).toHaveAttribute('data-tooltip', /手写笔/);
      await expect(page.locator('#pressure-hint')).toHaveCount(0);
      await page.getByRole('button', { name: '切换主题', exact: true }).click();
    }
  }
});

test('editing width refreshes pressure geometry and dashed Canvas/SVG keep the same gaps', async ({ page }) => {
  await setup(page); await stroke(page, 'pen', 350);
  await chooseTool(page, '选择工具'); await page.mouse.click(640, 350);
  await page.locator('[data-width="2"]').click();
  await page.locator('[data-dash="true"]').click();
  const [pen] = await savedElements(page);
  expect(pen.strokeWidth).toBe(2); expect(pen.dash).toBe(true);
  const match = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { createElement, createDocument } = await load('/src/core/model.ts');
    const { exportSVG } = await load('/src/engine/export.ts');
    const { drawElement } = await load('/src/engine/draw.ts');
    const el = createElement('pen', { x: 20, y: 30, pressureEnabled: true, dash: true, strokeWidth: 2, points: [{ x: 0, y: 0, pressure: .3 }, { x: 100, y: 0, pressure: 1 }] });
    const doc = createDocument(); doc.elements = [el];
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 80; const ctx = canvas.getContext('2d')!; drawElement(ctx, el);
    const before = ctx.getImageData(80, 30, 1, 1).data[3];
    drawElement(ctx, { ...el, strokeWidth: 7 });
    const updated = ctx.getImageData(80, 32, 1, 1).data[3];
    const data = await exportSVG(doc).text();
    return { gap: ctx.getImageData(31, 30, 1, 1).data[3], ink: before, updated, svg: data };
  });
  expect(match.gap).toBe(0); expect(match.ink).toBeGreaterThan(0); expect(match.updated).toBeGreaterThan(0);
  expect(match.svg).toContain('<path'); expect(match.svg).not.toContain('<polyline');
});

test('split pressure paths retain their silhouette in exports and stay editable after resizing', async ({ page }) => {
  await setup(page); await stroke(page, 'pen', 350);
  await chooseTool(page, '橡皮擦'); await page.mouse.move(640, 320); await page.mouse.down(); await page.mouse.move(640, 380); await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('2 个元素'); await savedElements(page);
  const colors = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { Repository } = await load('/src/storage/repository.ts');
    const { unionBounds } = await load('/src/core/geometry.ts');
    const { exportSVG, exportPNG } = await load('/src/engine/export.ts');
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); const b = unionBounds(doc.elements);
    const read = async (blob: Blob, padding: number) => {
      const url = URL.createObjectURL(blob), image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0); URL.revokeObjectURL(url);
      const scale = image.width / (b.w + padding * 2);
      return [[600, 350], [640, 350], [675, 350]].map(([x, y]) => [...ctx.getImageData(Math.round((x - b.x + padding) * scale), Math.round((y - b.y + padding) * scale), 1, 1).data]);
    };
    return { png: await read(await exportPNG(doc), 48), svg: await read(exportSVG(doc), 40) };
  });
  for (const samples of [colors.png, colors.svg]) { expect(samples[0][0]).toBeLessThan(100); expect(samples[1].slice(0, 3)).toEqual([248, 249, 246]); expect(samples[2][0]).toBeLessThan(100); }
  await chooseTool(page, '选择工具'); await page.mouse.click(600, 350);
  const before: BoardElement = (await savedElements(page))[0];
  const { selectionFrame } = await import('../../src/core/selection-frame');
  const corner = selectionFrame(before, 1).corners.se;
  await page.mouse.move(corner.x, corner.y); await page.mouse.down(); await page.mouse.move(corner.x + 40, corner.y + 30); await page.mouse.up();
  const after: BoardElement = (await savedElements(page))[0];
  expect(after.w).toBeGreaterThan(before.w);
  expect(after.path!.strokes.map(stroke => stroke.points.map(p => p.pressure))).toEqual(before.path!.strokes.map(stroke => stroke.points.map(p => p.pressure)));
  const toggle = page.getByRole('switch', { name: '压感', exact: true }); await toggle.click(); await toggle.click(); await expect(toggle).toBeChecked();
});
