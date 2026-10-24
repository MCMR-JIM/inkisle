import { expect, test } from '@playwright/test';
import { createBoard, chooseTool } from './helpers';

test('a selected line keeps its original ink and gains only a soft blue halo', async ({ page }) => {
  await page.goto('/');
  await createBoard(page);
  await chooseTool(page, '线条');
  await page.locator('[data-property="stroke"][data-color="#e28165"]').click();
  await page.locator('[data-width="7"]').click();
  await page.mouse.move(500, 370); await page.mouse.down(); await page.mouse.move(800, 370); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(650, 370);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const pixels = await page.evaluate(() => {
    const main = document.querySelector<HTMLCanvasElement>('#canvas')!.getContext('2d')!;
    const overlay = document.querySelector<HTMLCanvasElement>('#interaction-canvas')!.getContext('2d')!;
    return {
      original: [...main.getImageData(650, 370, 1, 1).data],
      center: [...overlay.getImageData(650, 370, 1, 1).data],
      halo: [...overlay.getImageData(650, 377, 1, 1).data],
      far: [...overlay.getImageData(650, 460, 1, 1).data],
    };
  });
  expect(pixels.original.slice(0, 3)).toEqual([226, 129, 101]);
  expect(pixels.center[3]).toBe(255);
  expect(Math.abs(pixels.center[0] - pixels.original[0])).toBeLessThan(100);
  expect(Math.abs(pixels.center[1] - pixels.original[1])).toBeLessThan(100);
  expect(Math.abs(pixels.center[2] - pixels.original[2])).toBeLessThan(100);
  // Selection content is now composited in scene order over an opaque base.
  expect(pixels.center).toEqual(pixels.original);
  expect(pixels.halo[2]).toBeGreaterThan(pixels.halo[0]);
  expect(pixels.halo[0]).toBeLessThan(248);
  expect(pixels.far.slice(0, 3)).toEqual([248, 249, 246]);
  await page.keyboard.press('Escape');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const cleared = await page.locator('#interaction-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(650, 377, 1, 1).data[3]);
  expect(cleared).toBe(0);
});

test('selection glow follows visible pixels, respects holes and uses no enclosing frame for multi-select', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { Renderer } = await load('/src/engine/renderer.ts');
    const { Scene } = await load('/src/core/scene.ts');
    const { createElement } = await load('/src/core/model.ts');
    const container = document.createElement('div');
    Object.assign(container.style, { position: 'absolute', width: '600px', height: '400px', pointerEvents: 'none' });
    const main = document.createElement('canvas'), overlay = document.createElement('canvas');
    container.append(main, overlay); document.body.append(container);
    const rect = createElement('rect', { id: 'a', x: 100, y: 100, w: 140, h: 120, fill: '#f8e3dc', stroke: '#e28165', radius: 0, erasures: [{ points: [{ x: 70, y: 60 }], radiusX: 25, radiusY: 25 }] });
    const line = createElement('line', { id: 'b', x: 350, y: 200, w: 150, stroke: '#639bba', strokeWidth: 4 });
    const state = { camera: { x: 0, y: 0, zoom: 1 }, selected: new Set(['a', 'b']), preview: [], hidden: new Set(), marquee: null, cursor: null, tool: 'select', grid: false, dark: false, erasing: new Map() };
    const renderer = new Renderer(new Scene([rect, line]), main, overlay, state);
    await new Promise(requestAnimationFrame);
    const ctx = overlay.getContext('2d')!, dpr = renderer.dpr;
    const sample = (x: number, y: number) => [...ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data];
    const result = { hole: sample(170, 160), fill: sample(130, 160), near: sample(94, 160), gap: sample(295, 100), line: sample(420, 200), lineNear: sample(420, 206) };
    renderer.destroy(); container.remove(); return result;
  });
  expect(result.hole.slice(0, 3)).toEqual([248, 249, 246]);
  expect(result.fill[3]).toBe(255);
  expect(result.line[3]).toBe(255);
  expect(result.near[2]).toBeGreaterThan(result.near[0]);
  expect(result.near[0]).toBeLessThan(248);
  expect(result.lineNear[0]).toBeLessThan(248);
  expect(result.gap.slice(0, 3)).toEqual([248, 249, 246]);
});

test('text and image selection use the same blue halo in dark mode at retina scale', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { SelectionGlow } = await load('/src/engine/selection.ts');
    const { createElement } = await load('/src/core/model.ts');
    const { preloadImages, drawElement } = await load('/src/engine/draw.ts');
    const source = document.createElement('canvas'); source.width = source.height = 20;
    const sourceContext = source.getContext('2d')!; sourceContext.fillStyle = '#e28165'; sourceContext.fillRect(0, 0, 20, 20);
    const elements = [createElement('image', { x: 50, y: 50, w: 120, h: 100, radius: 0, src: source.toDataURL() }), createElement('text', { x: 220, y: 60, w: 200, h: 70, text: '留白', fontSize: 48 })];
    await preloadImages(elements);
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 500;
    const context = canvas.getContext('2d')!; context.scale(2, 2);
    const glow = new SelectionGlow(); glow.draw(context, elements, 1, 2, true);
    const center = [...context.getImageData(180, 180, 1, 1).data];
    const near = [...context.getImageData(92, 180, 1, 1).data];
    let textGlow = 0;
    const data = context.getImageData(430, 100, 240, 170).data;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0 && data[i + 2] > data[i] + 30) textGlow++;
    const before = performance.now();
    for (let i = 0; i < 30; i++) { context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, 1000, 500); context.restore(); glow.draw(context, elements, 1, 2, true); }
    const cachedFrameMs = (performance.now() - before) / 30;
    // Glow remains a presentation-only overlay; drawElement is unaffected.
    const original = document.createElement('canvas'); original.width = 300; original.height = 200;
    drawElement(original.getContext('2d')!, elements[0]);
    const originalColor = [...original.getContext('2d')!.getImageData(90, 90, 1, 1).data];
    glow.destroy(); return { center, near, textGlow, cachedFrameMs, originalColor };
  });
  // The glow helper only contributes a halo; the renderer paints real ink in
  // its original stack position instead of lifting it onto the top overlay.
  expect(result.center[3]).toBe(0);
  expect(result.near[3]).toBeGreaterThan(3);
  expect(result.near[2]).toBeGreaterThan(result.near[0] + 30);
  expect(result.textGlow).toBeGreaterThan(100);
  expect(result.originalColor.slice(0, 3)).toEqual([226, 129, 101]);
  expect(result.cachedFrameMs).toBeLessThan(20);
});
