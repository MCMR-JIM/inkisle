import { expect, test } from '@playwright/test';
import { chooseTool } from './helpers';
import { roundedRectangleTrace, skewedRectangleTrace } from '../fixtures/recognition-traces';

test('production assets boot and render without development modules or runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await expect(page.locator('#element-count')).toHaveText('21 个元素');
  await expect(page.locator('.toolbar .family-caret')).toHaveCount(0);
  expect(await page.locator('#quick-new').evaluate(el => el.nextElementSibling?.id)).toBe('theme-button');
  expect((await page.locator('.toolbar').boundingBox())!.y).toBeLessThanOrEqual(64);
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
  await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
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

test('production custom selector and local erasure remain functional after reopening', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
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
  await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
  await chooseTool(page, '轨迹识别');
  await page.mouse.move(700, 400); await page.mouse.down();
  for (let i = 1; i <= 70; i++) await page.mouse.move(600 + 100 * Math.cos(i / 70 * Math.PI * 2), 400 + 96 * Math.sin(i / 70 * Math.PI * 2));
  await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await expect(page.locator('#selection-actions')).toBeHidden();
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
  await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
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
  await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
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
  await page.getByRole('button', { name: '新建画板', exact: true }).first().click(); await chooseTool(page, '画笔'); await page.locator('[data-width="7"]').click();
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
  await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
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
  await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
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
  await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
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
  await page.getByRole('button', { name: '新建画板', exact: true }).first().click(); await page.locator('#stroke-palette').click();
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
  await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
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
  await page.locator('#quick-new').click(); await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
  await chooseTool(page, '选择工具');
  const label = (await page.locator('#property-title').boundingBox())!;
  await page.mouse.move(label.x + 2, label.y + label.height / 2); await page.mouse.down(); await page.mouse.move(label.x + label.width - 2, label.y + label.height / 2); await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await page.mouse.move(480, 280); await page.mouse.down(); await page.mouse.move(690, 470); await page.mouse.up();
  await expect(page.locator('#selection-actions')).toBeHidden();
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
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机'); await page.locator('#quick-new').click();
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
  await page.locator('#bring-forward').click(); await expect(page.locator('#save-status')).toContainText('已保存在本机'); expect(await pixel()).toEqual([248, 227, 220]);
  await page.locator('#send-backward').click(); await expect(page.locator('#save-status')).toContainText('已保存在本机'); expect(await pixel()).toEqual([222, 237, 245]);
  await page.keyboard.press('Control+]'); await expect(page.locator('#save-status')).toContainText('已保存在本机'); expect(await pixel()).toEqual([248, 227, 220]);
  await page.reload(); await expect(page.locator('#save-status')).toContainText('已保存在本机'); expect(await pixel()).toEqual([248, 227, 220]);
});
