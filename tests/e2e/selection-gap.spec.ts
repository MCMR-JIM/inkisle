import { expect, test } from '@playwright/test';
import { createBoard, chooseTool } from './helpers';

test('a shape frame has a five-pixel air gap and its handles remain on the frame', async ({ page }) => {
  await page.goto('/');
  await createBoard(page);
  await chooseTool(page, '矩形');
  await page.locator('[data-width="7"]').click();
  await page.evaluate(() => {
    const ctx = document.querySelector<HTMLCanvasElement>('#interaction-canvas')!.getContext('2d')!;
    const stroke = ctx.stroke.bind(ctx), roundRect = ctx.roundRect.bind(ctx);
    const records = { frames: [] as { x: number; y: number }[][], handles: [] as { x: number; y: number }[] };
    let vertices: { x: number; y: number }[] = [];
    const moveTo = ctx.moveTo.bind(ctx), lineTo = ctx.lineTo.bind(ctx), beginPath = ctx.beginPath.bind(ctx);
    ctx.beginPath = () => { vertices = []; beginPath(); };
    ctx.moveTo = (x, y) => { vertices.push({ x, y }); moveTo(x, y); };
    ctx.lineTo = (x, y) => { vertices.push({ x, y }); lineTo(x, y); };
    ctx.stroke = ((...args: unknown[]) => {
      if (ctx.getLineDash().length && vertices.length === 4) records.frames.push(vertices.slice());
      (stroke as (...args: unknown[]) => void)(...args);
    }) as typeof ctx.stroke;
    ctx.roundRect = (x, y, w, h, radii) => {
      if (w === 7 && h === 7) records.handles.push({ x: x + w / 2, y: y + h / 2 });
      roundRect(x, y, w, h, radii);
    };
    (window as unknown as { selectionGapRecords: typeof records }).selectionGapRecords = records;
  });
  await page.mouse.move(500, 320); await page.mouse.down(); await page.mouse.move(760, 480); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(630, 320);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const records = await page.evaluate(() => (window as unknown as { selectionGapRecords: { frames: { x: number; y: number }[][]; handles: { x: number; y: number }[] } }).selectionGapRecords);
  const frame = records.frames.at(-1)!;
  expect(frame).toHaveLength(4);
  expect(frame[0].x).toBeCloseTo(491.5); expect(frame[0].y).toBeCloseTo(311.5);
  expect(frame[2].x).toBeCloseTo(768.5); expect(frame[2].y).toBeCloseTo(488.5);
  for (const point of frame) expect(records.handles.some(handle => Math.hypot(point.x - handle.x, point.y - handle.y) < .01)).toBe(true);

  const target = { x: frame[2].x + 60, y: frame[2].y + 40 };
  await page.mouse.move(frame[2].x, frame[2].y); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 6 }); await page.mouse.up();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const finalFrame = await page.evaluate(() => (window as unknown as { selectionGapRecords: { frames: { x: number; y: number }[][] } }).selectionGapRecords.frames.at(-1)!);
  expect(finalFrame[2].x).toBeCloseTo(target.x, 0); expect(finalFrame[2].y).toBeCloseTo(target.y, 0);
  expect(finalFrame[0].x).toBeCloseTo(frame[0].x, 0); expect(finalFrame[0].y).toBeCloseTo(frame[0].y, 0);
  await page.keyboard.press('Control+z');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const restored = await page.evaluate(() => (window as unknown as { selectionGapRecords: { frames: { x: number; y: number }[][] } }).selectionGapRecords.frames.at(-1)!);
  expect(restored).toEqual(frame);
});

test('the visible frame, corner hit targets and rotation stem stay in sync at different zooms', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const results = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { Renderer } = await load('/src/engine/renderer.ts');
    const { Scene } = await load('/src/core/scene.ts');
    const { createElement } = await load('/src/core/model.ts');
    const { selectionFrame, objectRotationHandle } = await load('/src/core/selection-frame.ts');
    const { worldToScreen } = await load('/src/core/geometry.ts');
    const element = createElement('rect', { id: 'gap-check', x: 100, y: 100, w: 160, h: 100, rotation: .4, strokeWidth: 4 });
    const container = document.createElement('div');
    Object.assign(container.style, { position: 'absolute', width: '800px', height: '600px', pointerEvents: 'none' });
    const main = document.createElement('canvas'), overlay = document.createElement('canvas');
    container.append(main, overlay); document.body.append(container);
    const state = { camera: { x: 80, y: 60, zoom: 1 }, selected: new Set([element.id]), preview: [], hidden: new Set(), marquee: null, cursor: null, tool: 'select', grid: false, dark: false, erasing: new Map() };
    const renderer = new Renderer(new Scene([element]), main, overlay, state);
    const results = [];
    for (const zoom of [.5, 1, 2]) {
      renderer.state.camera = { x: 80, y: 60, zoom };
      await new Promise<void>(resolve => { renderer.onFrame = () => resolve(); renderer.invalidate(); });
      const corners = selectionFrame(element, zoom).corners;
      const ctx = overlay.getContext('2d')!, dpr = renderer.dpr;
      const handles = Object.entries(corners).map(([name, point]) => {
        const screen = worldToScreen(point, renderer.state.camera);
        const pixel = [...ctx.getImageData(Math.round(screen.x * dpr), Math.round(screen.y * dpr), 1, 1).data];
        return { name, hit: renderer.handleAt(screen), alpha: pixel[3] };
      });
      const rotation = objectRotationHandle(element, zoom);
      results.push({ zoom, handles, rotationHit: renderer.rotationHandleAt(worldToScreen(rotation.handle, renderer.state.camera)) });
    }
    renderer.destroy(); container.remove(); return results;
  });
  for (const result of results) {
    for (const handle of result.handles) { expect(handle.hit).toBe(handle.name); expect(handle.alpha).toBeGreaterThan(100); }
    expect(result.rotationHit).toBe(true);
  }
});
