import { expect, test } from '@playwright/test';
import { createBoard, chooseTool, contextAction, selectValue } from './helpers';
import { roundedRectangleTrace, skewedRectangleTrace } from '../fixtures/recognition-traces';
import { decodeDocument } from '../../src/core/codec';
import { PDFDocument } from 'pdf-lib';
import { pdfFixture } from '../fixtures/pdf';

test('production PDF import, offline resources, A4 export and portable originals work without development modules', async ({ page }) => {
  const source = await pdfFixture();
  await page.goto('/'); await createBoard(page);
  await page.context().route('**/*', async route => new URL(route.request().url()).origin === 'http://127.0.0.1:14173' ? route.continue() : route.abort());
  await page.locator('#import-file').setInputFiles({ name: 'production.pdf', mimeType: 'application/pdf', buffer: source });
  await expect(page.locator('#pdf-import-dialog')).toBeVisible(); await page.locator('#pdf-confirm-import').click();
  await expect(page.locator('#pdf-page-total')).toHaveText('/ 3'); await page.locator('#pdf-double').click();
  await expect.poll(() => page.locator('#canvas').evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let green = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 80 && pixels[i + 1] > 150 && pixels[i + 1] < 210 && pixels[i + 2] < 110) green++;
    return green;
  })).toBeGreaterThan(100);
  await page.locator('#export-button').click(); await page.locator('[data-action="export-pdf"]').click();
  await page.locator('#pdf-export-range').fill('1-2');
  const exporting = page.waitForEvent('download'); await page.locator('#pdf-confirm-export').click(); const exported = await exporting;
  const { readFile } = await import('node:fs/promises');
  expect((await PDFDocument.load(await readFile((await exported.path())!))).getPageCount()).toBe(2);
  const saving = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const saved = await saving;
  await createBoard(page); await page.locator('#import-file').setInputFiles((await saved.path())!);
  await expect(page.locator('#toast')).toContainText('画板已导入'); await expect(page.locator('#pdf-page-total')).toHaveText('/ 3');
});

test('production creation retains a blank double-column board and can start with selected PDF pages', async ({ page }) => {
  await page.goto('/'); await createBoard(page, 'double');
  await expect(page.locator('#pdf-double')).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('#pdf-page-total')).toHaveText('/ 1');
  await page.reload(); await expect(page.locator('#pdf-double')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#add-paper-button').click(); await expect(page.locator('#pdf-page-total')).toHaveText('/ 2');
  await page.locator('#quick-new').click();
  await page.locator('#new-board-document').setInputFiles({ name: 'initial.pdf', mimeType: 'application/pdf', buffer: await pdfFixture(4) });
  await expect(page.locator('#new-board-pages')).toBeVisible(); await page.locator('#new-board-page-range').fill('2-3');
  await page.locator('#confirm-new-board').click(); await expect(page.locator('#new-board-dialog')).toBeHidden();
  await expect(page.locator('#board-title')).toHaveValue('initial'); await expect(page.locator('#pdf-page-total')).toHaveText('/ 2');
  await expect(page.locator('#pdf-single')).toHaveAttribute('aria-pressed', 'true');
});

test('production eraser wheel and shared slider keep cursor size, masks and preferences consistent across zoom', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  await createBoard(page); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'draft');
  await chooseTool(page, '便签'); await page.mouse.click(500, 300); await page.locator('#text-editor').fill('Eraser size'); await page.keyboard.press('Control+Enter');
  await page.keyboard.press('e'); await page.locator('#eraser-size').fill('40'); await page.mouse.move(900, 400); await page.mouse.wheel(0, -100);
  await expect(page.locator('#eraser-size-value')).toHaveText('42 px'); await expect(page.locator('#zoom-value')).toHaveText('100%');
  await page.locator('#eraser-size').fill('40');
  for (const zoom of [1, 2]) {
    await selectValue(page, '#zoom-value', zoom); await page.keyboard.press('e'); await page.mouse.click(560, 360);
    const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const download = await downloading;
    const { readFile } = await import('node:fs/promises'); const doc = decodeDocument(new Uint8Array(await readFile((await download.path())!)));
    expect(doc.elements[0].erasures!.at(-1)!.radiusX).toBeCloseTo(20 / zoom, 6);
  }
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  await page.reload(); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved'); await page.keyboard.press('e');
  await expect(page.locator('#eraser-size')).toHaveValue('40');
});

test('production zoom presets and modal settings share the custom select', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  await expect(page.locator('select')).toHaveCount(0);
  await selectValue(page, '#zoom-value', 2); await expect(page.locator('#zoom-value')).toHaveText('200%');
  await expect(page.locator('#zoom-value svg')).toHaveCount(0);
  await page.locator('#workspace-settings-button').click(); await selectValue(page, '#toolbar-position', 'top');
  await page.getByRole('button', { name: '关闭工作区设置', exact: true }).click();
  await page.locator('#export-button').click(); await page.locator('[data-action="export-png"]').click();
  await selectValue(page, '#export-background', 'transparent'); await selectValue(page, '#export-format', 'svg');
  await expect(page.locator('#export-scale')).toBeDisabled(); await expect(page.locator('#confirm-export')).toHaveText('导出 SVG');
  await page.getByRole('button', { name: '关闭导出设置', exact: true }).click();
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  await page.reload(); await expect(page.locator('#zoom-value')).toHaveText('200%');
  await expect(page.locator('html')).toHaveAttribute('data-toolbar-position', 'top');
});

test('production unnamed blank boards stay out of the library until named or edited', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  await page.locator('#library-button').click(); await expect(page.locator('.board-card')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭画板库', exact: true }).click();
  for (let i = 0; i < 3; i++) {
    await createBoard(page); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'draft');
    await expect(page.locator('#toast')).toBeHidden();
  }
  await page.locator('#library-button').click(); await expect(page.locator('.board-card')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭画板库', exact: true }).click();
  await page.locator('#board-title').fill('Empty plan'); await page.locator('#board-title').press('Enter');
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  await page.reload(); await expect(page.locator('#board-title')).toHaveValue('Empty plan');
  await expect(page.locator('#element-count')).toHaveText('0 个元素');
  await page.locator('#board-title').fill(''); await page.locator('#board-title').press('Enter');
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'draft');
  await page.locator('#library-button').click(); await expect(page.locator('.board-card')).toHaveCount(1);
});

test('production highlighter draws wide translucent ink and restores ordinary pen settings', async ({ page }) => {
  await page.goto('/'); await createBoard(page);
  await expect(page.locator('#board-title')).toHaveValue('未命名画板'); await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'draft');
  await page.keyboard.press('p'); await page.getByRole('button', { name: '荧光笔', exact: true }).click();
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(750, 300, { steps: 8 }); await page.mouse.up();
  await page.getByRole('button', { name: '普通画笔', exact: true }).click();
  await page.mouse.move(500, 450); await page.mouse.down(); await page.mouse.move(750, 450, { steps: 8 }); await page.mouse.up();
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const download = await downloading;
  const { readFile } = await import('node:fs/promises'); const doc = decodeDocument(new Uint8Array(await readFile((await download.path())!)));
  expect(doc.elements).toHaveLength(2);
  expect(doc.elements[0]).toMatchObject({ kind: 'pen', stroke: '#f2d64b', strokeWidth: 20, opacity: .35, pressureEnabled: false });
  expect(doc.elements[1]).toMatchObject({ kind: 'pen', strokeWidth: 2, opacity: 1, pressureEnabled: true });
});

test('production assets boot and render without development modules or runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await expect(page.locator('#element-count')).toHaveText('21 个元素');
  await expect(page.locator('.toolbar .family-caret')).toHaveCount(0);
  expect(await page.locator('#quick-new').evaluate(el => el.nextElementSibling?.id)).toBe('theme-button');
  expect((await page.locator('.toolbar').boundingBox())!.y).toBeGreaterThan(700);
  expect(await page.locator('.toolbar .tool-key').evaluateAll(nodes => nodes.filter(el => el.textContent?.trim()).every(el => Number(getComputedStyle(el).opacity) > .5))).toBe(true);
  await page.waitForFunction(() => (window as unknown as { inkisle: { diagnostics: () => { firstSceneFrameMs: number } } }).inkisle.diagnostics().firstSceneFrameMs > 0);
  expect(errors).toEqual([]);
  const startup = await page.evaluate(() => {
    const diagnostic = (window as unknown as { inkisle: { diagnostics: () => Record<string, number> } }).inkisle.diagnostics();
    return { ...diagnostic, timeFromNavigationMs: performance.now() };
  });
  console.log('INKISLE_PRODUCTION_STARTUP', JSON.stringify(startup, null, 2));
  const phases = (startup as unknown as { startupPhases: { thumbnailMs?: number } }).startupPhases;
  expect(phases.thumbnailMs ?? 0).toBe(0);
  await createBoard(page);
  await chooseTool(page, '便签');
  await page.mouse.click(500, 350);
  await page.locator('#text-editor').fill('生产构建也可以直接使用');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload();
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  console.log('INKISLE_PRODUCTION_REOPEN', JSON.stringify(await page.evaluate(() => (window as unknown as { inkisle: { diagnostics: () => object } }).inkisle.diagnostics()), null, 2));
  // Trigger the background codec in the actual bundled application.
  for (let i = 0; i < 9; i++) { await page.keyboard.press('Control+a'); await page.keyboard.press('Control+d'); }
  await expect(page.locator('#element-count')).toHaveText('512 个元素');
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.inkisle$/);
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload();
  await expect(page.locator('#element-count')).toHaveText('512 个元素');
  await page.locator('#import-file').setInputFiles((await download.path())!);
  await expect(page.locator('#toast')).toContainText('画板已导入');
  await expect(page.locator('#element-count')).toHaveText('512 个元素');
  expect(errors).toEqual([]);
});

test('production nested groups retain independent identities through worker export, import and reopening', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await createBoard(page); await expect(page.locator('#element-count')).toHaveText('0 个元素');
  await chooseTool(page, '矩形');
  for (const x of [450, 650, 900]) { await page.mouse.move(x, 300); await page.mouse.down(); await page.mouse.move(x + 80, 360); await page.mouse.up(); }
  await chooseTool(page, '选择工具'); await page.mouse.click(490, 300);
  await page.keyboard.down('Shift'); await page.mouse.click(690, 300); await page.keyboard.up('Shift');
  await page.keyboard.press('Control+g');
  await page.keyboard.down('Shift'); await page.mouse.click(940, 300); await page.keyboard.up('Shift');
  await page.keyboard.press('Control+g');
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Control+a'); await page.keyboard.press('Control+d'); }
  await expect(page.locator('#element-count')).toHaveText('768 个元素');
  const pending = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const download = await pending;
  const stream = await download.createReadStream(); const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  const doc = decodeDocument(Buffer.concat(chunks));
  expect(new Set(doc.elements.map(el => el.groupPath![0])).size).toBe(256);
  expect(doc.elements.filter(el => el.groupPath?.length === 2)).toHaveLength(512);
  await page.locator('#import-file').setInputFiles((await download.path())!); await expect(page.locator('#toast')).toContainText('画板已导入');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload(); await expect(page.locator('#element-count')).toHaveText('768 个元素');
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+Shift+g');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.keyboard.press('Control+z'); await expect(page.locator('#element-count')).toHaveText('768 个元素');
});

test('production custom selector and local erasure remain functional after reopening', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await createBoard(page);
  const select = page.getByRole('combobox', { name: '文字大小', exact: true });
  await select.click(); await page.getByRole('option', { name: '32 px', exact: true }).click();
  await expect(select).toHaveText('32 px');
  await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(800, 500); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(650, 300);
  await page.locator('[data-property="fill"][data-color="#e6eee5"]').click();
  await page.locator('#fill-toggle').click();
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await page.mouse.move(650, 280); await page.mouse.down(); await page.mouse.move(650, 520); await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload();
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  const pixel = await page.locator('#canvas').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(650, 370, 1, 1).data]);
  expect(pixel.slice(0, 3)).toEqual([248, 249, 246]);
});

test('production recognition forces every stroke into a shape and keeps a separate round rectangle tool', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await createBoard(page);
  await chooseTool(page, '轨迹识别');
  await page.mouse.move(700, 400); await page.mouse.down();
  for (let i = 1; i <= 70; i++) await page.mouse.move(600 + 100 * Math.cos(i / 70 * Math.PI * 2), 400 + 96 * Math.sin(i / 70 * Math.PI * 2));
  await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await expect(page.locator('#selection-status')).toBeHidden();
  await chooseTool(page, '圆角矩形');
  await page.mouse.move(800, 300); await page.mouse.down(); await page.mouse.move(1000, 450); await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await chooseTool(page, '轨迹识别');
  await page.mouse.move(500, 600); await page.mouse.down();
  for (const [x, y] of [[550, 650], [600, 600], [650, 650], [700, 600]]) await page.mouse.move(x, y);
  await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('3 个元素');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload(); await expect(page.locator('#element-count')).toHaveText('3 个元素');
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s');
  const file = await downloading; expect(file.suggestedFilename()).toMatch(/\.inkisle$/);
  const stream = await file.createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const doc = JSON.parse(Buffer.concat(chunks).subarray(16).toString('utf8'));
  expect(doc.elements[0].kind).toBe('ellipse'); expect(doc.elements[0].w).toBeCloseTo(doc.elements[0].h, 6);
  expect(doc.elements[1].kind).toBe('roundrect');
  expect(['triangle', 'rect', 'ellipse']).toContain(doc.elements[2].kind);
  expect(doc.elements[2].points).toHaveLength(0);
});

test('production recognition accepts rounded hand-drawn rectangles and stores the near-horizontal frame angle', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await createBoard(page);
  await chooseTool(page, '轨迹识别');
  const points = roundedRectangleTrace(260, 160, 62, -.29, 1, { x: 760, y: 440 });
  await page.mouse.move(points[0].x, points[0].y); await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
  await page.mouse.up(); await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload(); await expect(page.locator('#element-count')).toHaveText('1 个元素');
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const file = await downloading;
  const stream = await file.createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const doc = JSON.parse(Buffer.concat(chunks).subarray(16).toString('utf8'));
  expect(doc.elements[0].kind).toBe('rect'); expect(doc.elements[0].radius).toBe(0);
  expect(doc.elements[0].rotation).toBeCloseTo(-.29, 1);
});

test('production recognition gives four-sided skewed strokes rectangular priority', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await createBoard(page);
  await chooseTool(page, '轨迹识别');
  const points = skewedRectangleTrace({ rotation: .62, shear: .35, center: { x: 760, y: 440 } });
  await page.mouse.move(points[0].x, points[0].y); await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
  await page.mouse.up(); await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const file = await downloading;
  const stream = await file.createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const [el] = JSON.parse(Buffer.concat(chunks).subarray(16).toString('utf8')).elements;
  expect(el.kind).toBe('rect'); expect(el.radius).toBe(0); expect(Math.abs(el.rotation)).toBeLessThanOrEqual(Math.PI / 4);
});

test('production pressure ink survives persistence, worker splitting and source-file import', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await createBoard(page); await chooseTool(page, '画笔'); await page.locator('[data-width="7"]').click();
  await expect(page.getByRole('switch', { name: '压感', exact: true })).toBeChecked();
  await page.locator('#interaction-canvas').evaluate((canvas: HTMLCanvasElement) => {
    canvas.setPointerCapture = () => {};
    const send = (type: string, x: number, pressure: number, time: number) => {
      const event = new PointerEvent(type, { pointerId: 71, pointerType: 'pen', clientX: x, clientY: 350, pressure, buttons: type === 'pointerup' ? 0 : 1, bubbles: true });
      Object.defineProperty(event, 'timeStamp', { value: time }); canvas.dispatchEvent(event);
    };
    send('pointerdown', 500, .05, 100);
    for (let i = 1; i <= 40; i++) send('pointermove', 500 + i * 6, i < 10 ? .05 : i < 30 ? 1 : .05, 100 + i * 16);
    send('pointerup', 740, 0, 770);
  });
  await expect(page.locator('#save-status')).toContainText('已保存在本机'); await page.reload();
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  const widths = await page.locator('#canvas').evaluate((canvas: HTMLCanvasElement) => [530, 610].map(x => {
    const data = canvas.getContext('2d')!.getImageData(x, 340, 1, 21).data;
    let sum = 0; for (let i = 0; i < data.length; i += 4) sum += Math.max(0, (248 - data[i]) / 208); return sum;
  }));
  expect(widths[1] - widths[0]).toBeGreaterThan(3);
  await chooseTool(page, '橡皮擦'); await page.mouse.move(640, 320); await page.mouse.down(); await page.mouse.move(640, 380); await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const file = await downloading;
  const stream = await file.createReadStream(), chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(chunk);
  const doc = JSON.parse(Buffer.concat(chunks).subarray(16).toString('utf8'));
  expect(doc.elements.every((el: { path: { strokes: { pressureEnabled: boolean }[] } }) => el.path.strokes.every(stroke => stroke.pressureEnabled))).toBe(true);
  await page.locator('#import-file').setInputFiles((await file.path())!); await expect(page.locator('#toast')).toContainText('画板已导入');
  await expect(page.locator('#save-status')).toContainText('已保存在本机'); await page.reload(); await expect(page.locator('#element-count')).toHaveText('2 个元素');
});

test('production palette and editable color shortcuts persist without search UI', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await createBoard(page);
  await expect(page.locator('#stroke-colors [data-color]')).toHaveCount(10); await expect(page.locator('#fill-colors [data-color]')).toHaveCount(10);
  await page.mouse.click(1000, 650); await page.keyboard.press('Tab'); await expect(page.locator('#stroke-colors [data-color="#748477"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#help-button').click(); await page.locator('[data-shortcut="color-next"]').click(); await page.keyboard.press('q');
  await page.getByRole('button', { name: '关闭帮助', exact: true }).click();
  await page.getByRole('button', { name: '填充调色板', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '填充调色板', exact: true });
  const panelBox = (await page.locator('#properties').boundingBox())!, pickerBox = (await picker.boundingBox())!;
  expect(pickerBox.x).toBeCloseTo(panelBox.x + panelBox.width, 0); expect(pickerBox.y).toBeCloseTo(panelBox.y, 0);
  await expect(picker.locator('input[type="color"]')).toHaveCount(0);
  await picker.getByLabel('HEX 颜色').fill('#ff0000');
  await picker.getByRole('slider', { name: '色相', exact: true }).press('Home');
  await picker.getByRole('slider', { name: '色相', exact: true }).press('Shift+ArrowRight');
  await expect(picker.getByLabel('HEX 颜色')).toHaveValue('#ff2b00');
  await picker.getByLabel('HEX 颜色').fill('#abc123');
  await page.getByRole('button', { name: '应用颜色', exact: true }).click();
  await chooseTool(page, '矩形'); await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
  await expect(page.locator('#save-status')).toContainText('已保存在本机'); await page.reload(); await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await chooseTool(page, '选择工具'); await page.mouse.click(600, 350);
  await expect(page.locator('#fill-palette')).toHaveAttribute('data-current-color', '#abc123'); await page.keyboard.press('q');
  await expect(page.locator('#stroke-colors [data-color="#e28165"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#command-button, #command-dialog')).toHaveCount(0);
});

test('production canvas sampling and editable presets keep the sampled slot after reload', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await createBoard(page);
  await chooseTool(page, '矩形'); await page.locator('[data-property="fill"][data-color="#e6eee5"]').click();
  await page.locator('#fill-toggle').click();
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(800, 500); await page.mouse.up();
  await page.locator('#stroke-colors [data-color]').nth(2).dblclick();
  const picker = page.locator('#stroke-picker');
  await expect(picker.locator('[data-preset-index="2"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.getByRole('button', { name: '屏幕取色', exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: '画布取色', exact: true }).click(); await page.mouse.click(610, 380);
  await expect(picker.getByLabel('HEX 颜色')).toHaveValue('#e6eee5');
  await picker.getByRole('button', { name: '应用颜色', exact: true }).click();
  await expect(page.locator('#stroke-colors [data-color]').nth(2)).toHaveAttribute('data-color', '#e6eee5');
  await page.reload(); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await expect(page.locator('#stroke-colors [data-color]').nth(2)).toHaveAttribute('data-color', '#e6eee5');
  await page.locator('#stroke-colors [data-color]').nth(1).click(); await page.keyboard.press('Tab');
  await expect(page.locator('#stroke-colors [data-color]').nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#fill-colors [data-color]').nth(2)).toHaveAttribute('data-color', '#f8e3dc');
});

test('production square canvas sampler shows HEX and canvas focus prevents repeated button activation', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await createBoard(page);
  await page.locator('#theme-button').click(); await expect(page.locator('#theme-button')).not.toBeFocused();
  await page.mouse.click(1000, 650); await expect(page.locator('#interaction-canvas')).toBeFocused();
  await page.keyboard.down('Space'); await page.mouse.move(950, 600); await page.mouse.down(); await page.mouse.move(1050, 650); await page.mouse.up(); await page.keyboard.up('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); await expect(page.locator('#element-count')).toHaveText('0 个元素');
  await chooseTool(page, '矩形'); await page.locator('[data-property="fill"][data-color="#e6eee5"]').click();
  await page.locator('#fill-toggle').click();
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(800, 500); await page.mouse.up();
  await page.locator('#stroke-palette').click(); await page.locator('#stroke-picker .color-value-row .eyedropper-button').click();
  await page.mouse.move(610, 380); await expect(page.locator('.canvas-eyedropper-hex')).toHaveText('#e6eee5');
  const box = (await page.locator('.canvas-eyedropper-loupe').boundingBox())!; expect(box.width).toBe(box.height);
  await page.mouse.click(610, 380); await expect(page.locator('#stroke-hex')).toHaveValue('#e6eee5');
  await page.locator('#stroke-picker').getByRole('button', { name: '应用颜色' }).click(); await expect(page.locator('#stroke-palette')).toHaveAttribute('data-current-color', '#e6eee5');
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
});

test('production palette edits several linked colors and repairs invalid HEX on blur', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await createBoard(page); await page.locator('#stroke-palette').click();
  const picker = page.locator('#stroke-picker'), hex = picker.getByLabel('HEX 颜色');
  await picker.locator('[data-preset-index="2"]').click(); await hex.fill('#123abc');
  await expect(page.locator('#stroke-colors [data-color]').nth(2)).toHaveAttribute('data-color', '#123abc');
  await picker.locator('[data-preset-index="3"]').click(); await hex.fill('#fedcba');
  await picker.locator('[data-preset-index="4"]').click(); await hex.fill(''); await picker.locator('.color-picker-heading').click();
  await expect(hex).toHaveValue('#639bba'); await hex.fill('#112233'); await picker.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('#stroke-colors [data-color]').nth(4)).toHaveAttribute('data-color', '#639bba');
  await page.reload(); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await expect(page.locator('#stroke-colors [data-color]').nth(2)).toHaveAttribute('data-color', '#123abc');
  await expect(page.locator('#stroke-colors [data-color]').nth(3)).toHaveAttribute('data-color', '#fedcba');
  await page.locator('#stroke-palette').click(); await picker.getByRole('button', { name: '画布取色', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toContainText('方形');
  await expect(picker.locator('.hex-label, .preset-hint, [data-current-only]')).toHaveCount(0);
});

test('production fill switch retains its selected color through source-file import and re-enabling', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await createBoard(page);
  await expect(page.locator('#fill-toggle')).not.toBeChecked(); await expect(page.locator('#fill-colors [data-color="transparent"]')).toHaveCount(0);
  await page.locator('[data-property="fill"][data-color="#deedf5"]').click();
  await chooseTool(page, '矩形'); await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(600, 300); await expect(page.locator('#fill-toggle')).not.toBeChecked();
  await page.locator('#fill-toggle').click(); await expect(page.locator('#fill-toggle')).toBeChecked();
  await page.locator('#fill-toggle').click(); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const file = await downloading;
  await page.locator('#import-file').setInputFiles((await file.path())!); await expect(page.locator('#toast')).toContainText('画板已导入');
  await page.reload(); await expect(page.locator('#save-status')).toContainText('已保存在本机'); await page.keyboard.press('Control+a');
  await expect(page.locator('#fill-toggle')).not.toBeChecked(); await expect(page.locator('#fill-palette')).toHaveAttribute('data-current-color', '#deedf5');
  await page.locator('#fill-toggle').click(); await expect(page.locator('#fill-toggle')).toBeChecked();
  const pixel = await page.locator('#canvas').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(600, 380, 1, 1).data]);
  expect(pixel.slice(0, 3)).toEqual([222, 237, 245]);
});

test('production selection encloses complete shapes and never selects interface text', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await createBoard(page); await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
  await chooseTool(page, '选择工具');
  const label = (await page.locator('#property-title').boundingBox())!;
  await page.mouse.move(label.x + 2, label.y + label.height / 2); await page.mouse.down(); await page.mouse.move(label.x + label.width - 2, label.y + label.height / 2); await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await page.mouse.move(480, 280); await page.mouse.down(); await page.mouse.move(690, 470); await page.mouse.up();
  await expect(page.locator('#selection-status')).toBeHidden();
  await page.mouse.move(480, 280); await page.mouse.down(); await page.mouse.move(720, 470); await page.mouse.up();
  await expect(page.locator('#selection-label')).toHaveText('已选择 1 个元素');
  const copy = await page.locator('#interaction-canvas').evaluate(el => {
    const clipboard = new DataTransfer(), event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: clipboard });
    el.dispatchEvent(event); return clipboard.getData('text/plain');
  });
  expect(JSON.parse(copy).elements[0].kind).toBe('rect');
  const title = page.locator('#board-title'); await title.selectText();
  expect(await title.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)).toBeGreaterThan(0);
});

test('production selected content stays below upper objects while step controls persist the intended order', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机'); await createBoard(page);
  await page.locator('#fill-toggle').click(); await chooseTool(page, '矩形'); await page.locator('[data-property="fill"][data-color="#f8e3dc"]').click();
  await page.mouse.move(480, 300); await page.mouse.down(); await page.mouse.move(780, 520); await page.mouse.up();
  await page.locator('[data-property="fill"][data-color="#deedf5"]').click(); await page.mouse.move(600, 350); await page.mouse.down(); await page.mouse.move(900, 570); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(520, 410);
  const pixel = () => page.evaluate(() => {
    const main = document.querySelector<HTMLCanvasElement>('#canvas')!, overlay = document.querySelector<HTMLCanvasElement>('#interaction-canvas')!;
    const combined = document.createElement('canvas'); combined.width = main.width; combined.height = main.height;
    const ctx = combined.getContext('2d')!; ctx.drawImage(main, 0, 0); ctx.drawImage(overlay, 0, 0); return [...ctx.getImageData(670, 410, 1, 1).data].slice(0, 3);
  });
  await page.evaluate(() => new Promise(requestAnimationFrame)); expect(await pixel()).toEqual([222, 237, 245]);
  await page.mouse.move(520, 410); await page.mouse.down(); await page.mouse.move(540, 420); await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(await pixel()).toEqual([222, 237, 245]); await page.mouse.up();
  await contextAction(page, 'forward'); await expect(page.locator('#save-status')).toContainText('已保存在本机'); expect(await pixel()).toEqual([248, 227, 220]);
  await contextAction(page, 'backward'); await expect(page.locator('#save-status')).toContainText('已保存在本机'); expect(await pixel()).toEqual([222, 237, 245]);
  await page.keyboard.press('Control+]'); await expect(page.locator('#save-status')).toContainText('已保存在本机'); expect(await pixel()).toEqual([248, 227, 220]);
  await page.reload(); await expect(page.locator('#save-status')).toContainText('已保存在本机'); expect(await pixel()).toEqual([248, 227, 220]);
});
