import { expect, test } from '@playwright/test';
import { createBoard, chooseTool, contextAction } from './helpers';

test('creates a drawing, edits it, undoes and restores it from local storage', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '选择工具', exact: true })).toBeVisible();
  await createBoard(page);
  await expect(page.locator('#board-title')).toHaveValue('未命名画板');
  await chooseTool(page, '矩形');
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(730, 450, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#element-count')).toHaveText('0 个元素');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await chooseTool(page, '文字');
  await page.mouse.click(520, 500);
  await page.locator('#text-editor').fill('今天的好想法');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload();
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await expect(page.locator('#board-title')).toHaveValue('未命名画板');
  expect(errors).toEqual([]);
});

test('exports a file, imports it as a new board and supports keyboard selection', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#canvas')).toBeVisible();
  await createBoard(page);
  await chooseTool(page, '便签');
  await page.mouse.click(600, 400);
  await page.locator('#text-editor').fill('保存我的灵感');
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+d');
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.inkisle$/);
  const filePath = await download.path();
  await page.locator('#import-file').setInputFiles(filePath!);
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await expect(page.locator('#element-count')).toHaveText('0 个元素');
});

test('pen, zoom, theme and shortcut settings work without runtime errors', async ({ page }) => {
  await page.goto('/');
  await createBoard(page);
  await chooseTool(page, '画笔');
  await page.mouse.move(450, 400);
  await page.mouse.down();
  for (let i = 0; i < 40; i++) await page.mouse.move(450 + i * 8, 400 + Math.sin(i / 5) * 50);
  await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(page.locator('#zoom-value')).toHaveText('125%');
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#help-button').click();
  await expect(page.locator('[data-shortcut="color-next"]')).toHaveText('Tab');
  await page.getByRole('button', { name: '关闭帮助', exact: true }).click();
  await expect(page.locator('#help-dialog')).not.toBeVisible();
});

test('dragging a selection only redraws the static scene at the start and end of the gesture', async ({ page }) => {
  await page.goto('/');
  await createBoard(page);
  await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 420); await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
    const context = canvas.getContext('2d')!;
    const original = context.fillRect.bind(context);
    (window as unknown as { staticPaints: number }).staticPaints = 0;
    context.fillRect = (...args) => { (window as unknown as { staticPaints: number }).staticPaints++; original(...args); };
  });
  await page.mouse.move(600, 360); await page.mouse.down();
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(610 + i * 8, 365 + i * 2);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  const paintsDuringDrag = await page.evaluate(() => (window as unknown as { staticPaints: number }).staticPaints);
  await page.mouse.up();
  expect(paintsDuringDrag).toBeLessThanOrEqual(2);
});

test('welcome canvas and desktop controls fit in the viewport', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#element-count')).not.toHaveText('0 个元素');
  await page.screenshot({ path: testInfo.outputPath('welcome-desktop.png') });
  await page.setViewportSize({ width: 1024, height: 844 });
  await expect(page.getByRole('button', { name: '选择工具', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('welcome-compact-desktop.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024);
});

test('a pointer update is painted within its first animation frame', async ({ page }) => {
  await page.goto('/');
  await createBoard(page);
  await chooseTool(page, '矩形');
  const painted = await page.evaluate(async () => {
    const target = document.querySelector<HTMLCanvasElement>('#interaction-canvas')!;
    const context = target.getContext('2d')!;
    const original = context.stroke.bind(context);
    let strokes = 0;
    context.stroke = ((...args: unknown[]) => { strokes++; (original as (...args: unknown[]) => void)(...args); }) as typeof context.stroke;
    const event = (type: string, x: number, y: number) => target.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, button: 0, bubbles: true }));
    // Real pointer capture is covered by the other tests. These synthetic
    // events precisely place one move before an animation-frame boundary.
    target.setPointerCapture = () => {};
    event('pointerdown', 500, 300);
    await new Promise(requestAnimationFrame);
    strokes = 0;
    event('pointermove', 700, 440);
    await new Promise(requestAnimationFrame);
    const result = strokes;
    event('pointerup', 700, 440);
    return result;
  });
  expect(painted).toBeGreaterThan(0);
});

test('exports valid PNG and SVG assets and supports image insertion', async ({ page }) => {
  await page.goto('/');
  await createBoard(page);
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.locator('#image-file').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: image });
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await chooseTool(page, '画笔');
  await page.mouse.move(500, 400); await page.mouse.down(); await page.mouse.move(700, 450, { steps: 10 }); await page.mouse.up();
  const svgPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.locator('[data-action="export-svg"]').click();
  await page.locator('#confirm-export').click();
  const svg = await svgPromise;
  const stream = await svg.createReadStream();
  const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  const xml = Buffer.concat(chunks).toString();
  const parserError = await page.evaluate(svgText => {
    const xml = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    return xml.querySelector('parsererror')?.textContent ?? null;
  }, xml);
  expect(parserError).toBeNull();
  expect(xml).toContain('<image'); expect(xml).toMatch(/<(path|polyline)\b/);
  const pngPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.locator('[data-action="export-png"]').click();
  await page.locator('#confirm-export').click();
  const png = await pngPromise;
  expect(png.suggestedFilename()).toMatch(/\.png$/);
});

test('switches and deletes local boards without losing their contents', async ({ page }) => {
  await page.goto('/');
  await createBoard(page);
  await page.locator('#board-title').fill('我的独立画板');
  await page.locator('#board-title').press('Enter');
  await chooseTool(page, '椭圆');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
  await page.getByRole('button', { name: '我的画板', exact: true }).click();
  await expect(page.locator('#board-count')).toHaveText('2 块画板');
  await page.getByRole('button', { name: '打开画板 好想法，从这里开始', exact: true }).click();
  await expect(page.locator('#element-count')).toHaveText('21 个元素');
  await page.getByRole('button', { name: '我的画板', exact: true }).click();
  await page.getByRole('button', { name: '打开画板 我的独立画板', exact: true }).click();
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await page.getByRole('button', { name: '我的画板', exact: true }).click();
  await page.getByRole('button', { name: '删除画板 我的独立画板', exact: true }).click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('#board-count')).toHaveText('1 块画板');
  await page.getByRole('button', { name: '关闭画板库', exact: true }).click();
  await expect(page.locator('#element-count')).toHaveText('21 个元素');
});

test('keeps unfilled strokes legible when switching to a dark canvas', async ({ page }) => {
  await page.goto('/');
  await createBoard(page);
  await chooseTool(page, '线条');
  await page.mouse.move(500, 350); await page.mouse.down(); await page.mouse.move(700, 350); await page.mouse.up();
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const pixel = await page.locator('#canvas').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(600, 350, 1, 1).data]);
  expect(pixel[0]).toBeGreaterThan(120);
  expect(pixel[1]).toBeGreaterThan(120);
});

test('resizes, styles, locks and erases an element with real pointer gestures', async ({ page }) => {
  await page.goto('/');
  await createBoard(page);
  await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 420); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(600, 300);
  await page.mouse.move(701, 421); await page.mouse.down(); await page.mouse.move(801, 521, { steps: 8 }); await page.mouse.up();
  await page.locator('[data-property="fill"][data-color="#e6eee5"]').click();
  await page.locator('#fill-toggle').click();
  await contextAction(page, 'lock');
  await page.keyboard.press('Delete');
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  const result = await page.evaluate(async bytes => {
    const path = '/src/core/codec.ts';
    const codec = await import(/* @vite-ignore */ path);
    return codec.decodeDocument(new Uint8Array(bytes)).elements[0];
  }, [...Buffer.concat(chunks)]);
  expect(result.w).toBeGreaterThan(290);
  expect(result.h).toBeGreaterThan(210);
  expect(result.fill).toBe('#e6eee5'); expect(result.locked).toBe(true);
  await contextAction(page, 'lock');
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await page.mouse.click(600, 400);
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  const hole = await page.locator('#canvas').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(600, 400, 1, 1).data]);
  expect(hole.slice(0, 3)).toEqual([248, 249, 246]);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
});

test('a corrupt import leaves the open document intact and canceled gestures are not saved', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#element-count')).toHaveText('21 个元素');
  await page.locator('#import-file').setInputFiles({ name: 'broken.liubai', mimeType: 'application/octet-stream', buffer: Buffer.from('not-a-valid-whiteboard') });
  await expect(page.locator('#toast')).toContainText('导入失败');
  await expect(page.locator('#element-count')).toHaveText('21 个元素');
  await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 420);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('21 个元素');
});

test('changing text size keeps its editable and selectable bounds in proportion', async ({ page }) => {
  await page.goto('/');
  await createBoard(page);
  await chooseTool(page, '文字');
  await page.mouse.click(500, 350); await page.locator('#text-editor').fill('Hello 留白');
  await page.keyboard.press('Control+Enter');
  await chooseTool(page, '选择工具'); await page.keyboard.press('Control+a');
  const read = () => page.locator('#canvas').evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository();
    const doc = await repo.load(localStorage.getItem('liubai:last-board'));
    repo.close(); return doc.elements[0];
  });
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const before = await read();
  await page.locator('#font-size').click();
  await page.getByRole('option', { name: '72 px', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const after = await read();
  expect(after.w).toBeCloseTo(before.w * 3, 2);
  expect(after.h).toBeCloseTo(before.h * 3, 2);
});
