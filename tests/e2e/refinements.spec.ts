import { expect, test, type Page } from '@playwright/test';
import { createBoard, chooseTool, contextAction, openContextMenu } from './helpers';

async function blank(page: Page): Promise<void> {
  await page.goto('/');
  await createBoard(page);
}

async function filledRect(page: Page): Promise<void> {
  await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(800, 500); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(650, 300);
  await page.locator('[data-property="fill"][data-color="#e6eee5"]').click();
  await page.locator('#fill-toggle').click();
}

async function pixels(page: Page, points: [number, number][]): Promise<number[][]> {
  return page.locator('#canvas').evaluate((canvas: HTMLCanvasElement, points) => {
    const ctx = canvas.getContext('2d')!, dpr = canvas.width / canvas.clientWidth;
    return points.map(([x, y]) => [...ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data]);
  }, points);
}

test('color selection has one border and the custom select supports keyboard and outside dismissal', async ({ page }) => {
  await blank(page);
  const swatch = page.locator('.swatch.active').first();
  const border = await swatch.evaluate(el => {
    const pseudo = getComputedStyle(el, '::after');
    return { content: pseudo.content, border: pseudo.borderTopWidth };
  });
  expect(border.content === 'none' || border.content === 'normal' || border.border === '0px').toBe(true);
  const select = page.getByRole('combobox', { name: '文字大小', exact: true });
  await select.click();
  await expect(page.getByRole('listbox', { name: '文字大小', exact: true })).toBeVisible();
  await page.getByRole('option', { name: '40 px', exact: true }).click();
  await expect(select).toHaveText('40 px');
  await expect(select).not.toBeFocused();
  await select.press('ArrowDown'); await select.press('Enter');
  await expect(select).toHaveText('56 px');
  await select.click(); await select.press('ArrowUp'); await select.press('Escape');
  await expect(select).toHaveText('56 px');
  await select.click(); await page.mouse.click(900, 700);
  await expect(select).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('select#font-size')).toHaveCount(0);
});

test('a single selected shape uses a halo with a faint dashed frame', async ({ page }) => {
  await blank(page);
  await page.evaluate(() => {
    const ctx = document.querySelector<HTMLCanvasElement>('#interaction-canvas')!.getContext('2d')!;
    const original = ctx.stroke.bind(ctx);
    (window as unknown as { selectionFrames: number }).selectionFrames = 0;
    ctx.stroke = ((...args: unknown[]) => {
      if (ctx.getLineDash().length) (window as unknown as { selectionFrames: number }).selectionFrames++;
      (original as (...args: unknown[]) => void)(...args);
    }) as typeof ctx.stroke;
  });
  await filledRect(page);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(await page.evaluate(() => (window as unknown as { selectionFrames: number }).selectionFrames)).toBeGreaterThan(0);
});

test('the eraser cuts a continuous transparent stripe, previews immediately and survives undo and reopening', async ({ page }) => {
  await blank(page); await filledRect(page);
  const [fill, untouched] = await pixels(page, [[650, 370], [560, 370]]);
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await page.mouse.move(650, 270); await page.mouse.down(); await page.mouse.move(650, 530);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const [holeDuring] = await pixels(page, [[650, 370]]);
  expect(holeDuring.slice(0, 3)).not.toEqual(fill.slice(0, 3));
  await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  const [hole, remaining] = await pixels(page, [[650, 370], [560, 370]]);
  expect(hole.slice(0, 3)).toEqual([248, 249, 246]);
  expect(remaining).toEqual(untouched);
  await page.keyboard.press('Control+z');
  expect((await pixels(page, [[650, 370]]))[0]).toEqual(fill);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload();
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  expect((await pixels(page, [[650, 370]]))[0].slice(0, 3)).toEqual([248, 249, 246]);
});

test('erased overlap is a union, follows the object and does not erase future ink', async ({ page }) => {
  await blank(page); await filledRect(page);
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await page.mouse.move(650, 330); await page.mouse.down(); await page.mouse.move(650, 450); await page.mouse.up();
  await page.mouse.move(600, 370); await page.mouse.down(); await page.mouse.move(700, 370); await page.mouse.up();
  expect((await pixels(page, [[650, 370]]))[0].slice(0, 3)).toEqual([248, 249, 246]);
  await page.getByRole('button', { name: '选择工具', exact: true }).click();
  await page.mouse.move(550, 400); await page.mouse.down(); await page.mouse.move(650, 450); await page.mouse.up();
  expect((await pixels(page, [[750, 420]]))[0].slice(0, 3)).toEqual([248, 249, 246]);
  await chooseTool(page, '画笔');
  // Isolate erasure from timing-dependent mouse pressure and antialiasing.
  await page.locator('#pressure-toggle').click();
  await page.mouse.move(700, 420); await page.mouse.down(); await page.mouse.move(800, 420); await page.mouse.up();
  expect((await pixels(page, [[750, 420]]))[0][0]).toBeLessThan(100);
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
});

test('partial erasures remain transparent in PNG and SVG export', async ({ page }) => {
  await blank(page); await filledRect(page);
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await page.mouse.click(650, 370);
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const exported = await page.evaluate(async () => {
    const repoPath = '/src/storage/repository.ts', exportPath = '/src/engine/export.ts';
    const { Repository } = await import(/* @vite-ignore */ repoPath);
    const { exportPNG, exportSVG } = await import(/* @vite-ignore */ exportPath);
    const repo = new Repository();
    const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close();
    const read = async (blob: Blob, padding: number) => {
      const url = URL.createObjectURL(blob);
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      const factor = image.width / (302 + padding * 2);
      const sample = (x: number, y: number) => [...ctx.getImageData(Math.round((x + padding) * factor), Math.round((y + padding) * factor), 1, 1).data];
      const result = { hole: sample(151, 71), filled: sample(61, 71) }; URL.revokeObjectURL(url); return result;
    };
    const png = await read(await exportPNG(doc), 48);
    const svgBlob = exportSVG(doc);
    const svg = await read(svgBlob, 40);
    return { png, svg, xml: await svgBlob.text() };
  });
  expect(exported.png.hole.slice(0, 3)).toEqual([248, 249, 246]);
  expect(exported.svg.hole.slice(0, 3)).toEqual([248, 249, 246]);
  expect(exported.png.filled.slice(0, 3)).toEqual([230, 238, 229]);
  expect(exported.svg.filled.slice(0, 3)).toEqual([230, 238, 229]);
  expect(exported.xml).toContain('<mask');
});

test('pen, shapes, text, notes and images lose only the touched pixels at high DPR', async ({ page }) => {
  await blank(page);
  const results = await page.evaluate(async () => {
    const modelPath = '/src/core/model.ts', drawPath = '/src/engine/draw.ts', erasurePath = '/src/core/erasure.ts';
    const { createElement } = await import(/* @vite-ignore */ modelPath);
    const { drawElement, preloadImages } = await import(/* @vite-ignore */ drawPath);
    const { eraseAt } = await import(/* @vite-ignore */ erasurePath);
    const image = document.createElement('canvas'); image.width = 200; image.height = 100;
    const imageContext = image.getContext('2d')!; imageContext.fillStyle = '#e28165'; imageContext.fillRect(0, 0, 200, 100);
    const src = image.toDataURL();
    const results = [];
    for (const kind of ['pen', 'rect', 'ellipse', 'diamond', 'arrow', 'line', 'text', 'note', 'image']) {
      const element = createElement(kind, { x: 20, y: 20, w: 200, h: kind === 'line' || kind === 'arrow' ? 0 : 100, points: [{ x: 0, y: 30 }, { x: 100, y: 30 }, { x: 200, y: 30 }], text: kind === 'text' ? 'MMMM' : '', fontSize: 50, strokeWidth: 4, fill: '#e28165', src });
      await preloadImages([element]);
      const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 480;
      const ctx = canvas.getContext('2d')!; ctx.scale(2, 2); ctx.translate(30, 40);
      drawElement(ctx, element);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let chosen = { x: 0, y: 0 };
      outer: for (let x = 220; x < 340; x++) for (let y = 100; y < 290; y++) {
        if (data[(y * canvas.width + x) * 4 + 3] === 255) { chosen = { x, y }; break outer; }
      }
      const world = { x: chosen.x / 2 - 30, y: chosen.y / 2 - 40 };
      const erased = eraseAt(element, [world], 8);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
      drawElement(ctx, erased);
      const hole = ctx.getImageData(chosen.x, chosen.y, 1, 1).data[3];
      const after = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let retained = 0;
      for (let i = 3; i < data.length; i += 4) if (after[i] > 0) retained++;
      results.push({ kind, hole, retained });
    }
    return results;
  });
  for (const result of results) {
    expect(result.hole, result.kind).toBe(0);
    expect(result.retained, result.kind).toBeGreaterThan(100);
  }
});

test('eraser gestures respect locks and cancellation, and holes transform with resize', async ({ page }) => {
  await blank(page); await filledRect(page);
  await contextAction(page, 'lock');
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await page.mouse.click(650, 370);
  expect((await pixels(page, [[650, 370]]))[0].slice(0, 3)).toEqual([230, 238, 229]);
  await page.getByRole('button', { name: '选择工具', exact: true }).click();
  await page.mouse.click(550, 400); await contextAction(page, 'lock');
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await page.mouse.move(650, 270); await page.mouse.down(); await page.mouse.move(650, 530);
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect((await pixels(page, [[650, 370]]))[0].slice(0, 3)).toEqual([230, 238, 229]);
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await page.mouse.click(650, 370);
  await page.getByRole('button', { name: '选择工具', exact: true }).click();
  await page.mouse.click(550, 400);
  await page.mouse.move(801, 501); await page.mouse.down(); await page.mouse.move(951, 601); await page.mouse.up();
  const [hole, filled] = await pixels(page, [[725, 405], [640, 405]]);
  expect(hole.slice(0, 3)).toEqual([248, 249, 246]);
  expect(filled.slice(0, 3)).toEqual([230, 238, 229]);
});

test('the custom selector remains in the mobile viewport in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await blank(page);
  await page.getByRole('button', { name: '展开样式', exact: true }).click();
  const select = page.getByRole('combobox', { name: '文字大小', exact: true });
  for (let i = 0; i < 2; i++) {
    await select.click();
    const list = page.getByRole('listbox', { name: '文字大小', exact: true });
    const b = await list.boundingBox();
    expect(b!.x).toBeGreaterThanOrEqual(0); expect(b!.y).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width).toBeLessThanOrEqual(390); expect(b!.y + b!.height).toBeLessThanOrEqual(844);
    await select.press('End'); await select.press('Enter');
    await expect(select).toHaveText('72 px');
    await page.getByRole('button', { name: '切换主题', exact: true }).click();
  }
});

test('drawing through an erased hole selects the content underneath and preserves locked lower layers', async ({ page }) => {
  await blank(page); await filledRect(page);
  await contextAction(page, 'lock');
  await chooseTool(page, '矩形');
  await page.mouse.move(520, 320); await page.mouse.down(); await page.mouse.move(780, 480); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(650, 320);
  await page.locator('[data-property="fill"][data-color="#f8e3dc"]').click();
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await page.mouse.click(650, 370);
  expect((await pixels(page, [[650, 370]]))[0].slice(0, 3)).toEqual([230, 238, 229]);
  await page.getByRole('button', { name: '选择工具', exact: true }).click();
  await page.mouse.click(650, 370);
  await openContextMenu(page);
  await expect(page.locator('#context-menu [data-action="lock"]')).toBeEnabled();
  const selectedFill = page.locator('[data-property="fill"][data-color="#e6eee5"]');
  await expect(selectedFill).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Delete');
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
});

test('partial masks survive source export and import in a new document', async ({ page }) => {
  await blank(page); await filledRect(page);
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click(); await page.mouse.click(650, 370);
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s');
  const file = await downloading;
  await page.locator('#import-file').setInputFiles((await file.path())!);
  await expect(page.locator('#toast')).toContainText('画板已导入');
  const [hole, filled] = await pixels(page, [[650, 370], [560, 370]]);
  expect(hole.slice(0, 3)).toEqual([248, 249, 246]);
  expect(filled.slice(0, 3)).toEqual([230, 238, 229]);
});
