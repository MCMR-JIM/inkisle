import { expect, test, type Page } from '@playwright/test';
import { createBoard, chooseTool } from './helpers';
import { selectionFrame } from '../../src/core/selection-frame';
import { skewedRectangleTrace } from '../fixtures/recognition-traces';

async function blank(page: Page) {
  await page.goto('/'); await createBoard(page);
}

async function trace(page: Page, points: { x: number; y: number }[]) {
  await page.mouse.move(points[0].x, points[0].y); await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 1 });
  await page.mouse.up();
}

async function read(page: Page) {
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); return doc.elements;
  });
}

const outline = (corners: { x: number; y: number }[]) => corners.flatMap((a, i) => {
  const b = corners[(i + 1) % corners.length];
  return Array.from({ length: 15 }, (_, j) => ({ x: a.x + (b.x - a.x) * j / 15, y: a.y + (b.y - a.y) * j / 15 }));
}).concat([corners[0]]);

test('sharp and rounded rectangles are distinct tools with matching visible geometry', async ({ page }) => {
  await blank(page);
  await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.mouse.click(600, 300);
  await page.locator('[data-property="fill"][data-color="#e6eee5"]').click();
  await page.locator('#fill-toggle').click();
  const rect = (await read(page))[0]; expect(rect.radius).toBe(0);
  await chooseTool(page, '圆角矩形');
  await page.mouse.move(800, 300); await page.mouse.down(); await page.mouse.move(1000, 450); await page.mouse.up();
  const elements = await read(page); expect(elements[1].kind).toBe('roundrect'); expect(elements[1].radius).toBeGreaterThan(0);
  const corners = await page.locator('#canvas').evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    return [[502, 302], [802, 302]].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
  });
  expect(corners[0].slice(0, 3)).toEqual([230, 238, 229]); expect(corners[1].slice(0, 3)).toEqual([248, 249, 246]);
});

test('recognition is first, converts a near-square in one undo step and preserves style', async ({ page }) => {
  await blank(page); await chooseTool(page, '轨迹识别');
  await expect(page.locator('#tool-menu-shapes [data-tool-child]').first()).toHaveAttribute('data-tool-child', 'recognize');
  await page.locator('[data-property="stroke"][data-color="#e28165"]').click();
  await page.locator('[data-property="fill"][data-color="#deedf5"]').click();
  await page.locator('#fill-toggle').click();
  await trace(page, outline([{ x: 500, y: 300 }, { x: 700, y: 300 }, { x: 700, y: 490 }, { x: 500, y: 490 }]));
  const [el] = await read(page); expect(el.kind).toBe('rect'); expect(el.radius).toBe(0); expect(el.w).toBeCloseTo(el.h, 5);
  expect(el.stroke).toBe('#e28165'); expect(el.fill).toBe('#deedf5');
  await page.keyboard.press('Control+z'); await expect(page.locator('#element-count')).toHaveText('0 个元素');
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await expect(page.locator('#save-status')).toContainText('已保存在本机'); await page.reload();
  await expect(page.locator('#element-count')).toHaveText('1 个元素'); expect((await read(page))[0].kind).toBe('rect');
});

test('arbitrary triangles and ellipses are recognized and every other stroke is forced into a shape', async ({ page }) => {
  await blank(page); await chooseTool(page, '轨迹识别');
  await trace(page, outline([{ x: 480, y: 290 }, { x: 760, y: 330 }, { x: 520, y: 500 }]));
  let elements = await read(page); expect(elements[0].kind).toBe('triangle'); expect(elements[0].vertices).toHaveLength(3);
  await chooseTool(page, '轨迹识别');
  await trace(page, Array.from({ length: 71 }, (_, i) => ({ x: 950 + 110 * Math.cos(i / 70 * Math.PI * 2), y: 380 + 55 * Math.sin(i / 70 * Math.PI * 2) })));
  elements = await read(page); expect(elements[1].kind).toBe('ellipse'); expect(elements[1].w / elements[1].h).toBeGreaterThan(1.5);
  await chooseTool(page, '轨迹识别');
  await trace(page, [{ x: 500, y: 600 }, { x: 550, y: 650 }, { x: 600, y: 600 }, { x: 650, y: 650 }, { x: 700, y: 600 }]);
  elements = await read(page); expect(['triangle', 'rect', 'ellipse']).toContain(elements[2].kind); expect(elements[2].points).toHaveLength(0);
  await expect(page.locator('#selection-status')).toBeHidden();
  await page.keyboard.press('Control+z'); await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('#element-count')).toHaveText('3 个元素');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload(); await expect(page.locator('#element-count')).toHaveText('3 个元素');
  expect((await read(page)).every((element: { kind: string; points: unknown[] }) => ['triangle', 'rect', 'ellipse'].includes(element.kind) && element.points.length === 0)).toBe(true);
});

test('open contours and single clicks never remain as pen objects in shape recognition mode', async ({ page }) => {
  await blank(page); await chooseTool(page, '轨迹识别');
  await trace(page, outline([{ x: 500, y: 300 }, { x: 740, y: 300 }, { x: 740, y: 470 }, { x: 500, y: 470 }]).slice(0, 45));
  expect((await read(page))[0].kind).toBe('rect');
  await chooseTool(page, '轨迹识别'); await page.mouse.click(950, 410);
  const elements = await read(page);
  expect(elements[1].kind).toBe('ellipse'); expect(elements[1].points).toHaveLength(0);
});

test('all eight shape options fit two touch-friendly rows on small screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await page.locator('[data-family="shapes"]').click();
  const menu = page.locator('#tool-menu-shapes'), box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(8); expect(box.x + box.width).toBeLessThanOrEqual(382);
  const children = await menu.locator('[data-tool-child]').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
  expect(children).toHaveLength(8); expect(new Set(children.map(b => b.y)).size).toBe(2);
  expect(children.every(b => b.width >= 44 && b.height >= 44)).toBe(true);
  for (const child of children) expect(child.x + child.width).toBeLessThanOrEqual(382);
});

test('recognized scalene triangles render and export the same vertices after resizing and source-file import', async ({ page }) => {
  await blank(page); await chooseTool(page, '轨迹识别');
  await page.locator('[data-property="fill"][data-color="#e6eee5"]').click();
  await page.locator('#fill-toggle').click();
  await trace(page, outline([{ x: 500, y: 300 }, { x: 760, y: 340 }, { x: 530, y: 500 }]));
  let [el] = await read(page); expect(el.kind).toBe('triangle');
  await chooseTool(page, '选择工具'); await page.keyboard.press('Control+a');
  const corner = selectionFrame(el, 1).corners.se;
  await page.mouse.move(corner.x, corner.y); await page.mouse.down(); await page.mouse.move(corner.x + 80, corner.y + 60); await page.mouse.up();
  [el] = await read(page); expect(el.vertices).toHaveLength(3);
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s');
  const sourceFile = await downloading;
  await page.locator('#import-file').setInputFiles((await sourceFile.path())!);
  await expect(page.locator('#toast')).toContainText('画板已导入');
  const [imported] = await read(page); expect(imported.vertices).toEqual(el.vertices);
  const colors = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { Repository } = await load('/src/storage/repository.ts');
    const { exportSVG, exportPNG } = await load('/src/engine/export.ts');
    const { unionBounds } = await load('/src/core/geometry.ts');
    const { worldPoint } = await load('/src/core/transforms.ts');
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close();
    const el = doc.elements[0], bounds = unionBounds(doc.elements), vertices = el.vertices;
    const centroid = { x: vertices.reduce((sum: number, p: { x: number }) => sum + p.x, 0) / 3, y: vertices.reduce((sum: number, p: { y: number }) => sum + p.y, 0) / 3 };
    const points = [worldPoint(el, centroid), worldPoint(el, { x: el.w * .85, y: el.h * .85 })];
    const sample = async (blob: Blob, padding: number) => {
      const url = URL.createObjectURL(blob), image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      const scale = image.width / (bounds.w + padding * 2);
      const result = points.map(p => [...ctx.getImageData(Math.round((p.x - bounds.x + padding) * scale), Math.round((p.y - bounds.y + padding) * scale), 1, 1).data]);
      URL.revokeObjectURL(url); return result;
    };
    const svg = exportSVG(doc);
    return { png: await sample(await exportPNG(doc), 48), svg: await sample(svg, 40), xml: await svg.text() };
  });
  for (const pixels of [colors.png, colors.svg]) {
    expect(pixels[0].slice(0, 3)).toEqual([230, 238, 229]);
    expect(pixels[1].slice(0, 3)).toEqual([248, 249, 246]);
  }
  expect(colors.xml).toContain('<polygon');
});

test('recognition fits remain fast at pen sample density', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const measurement = await page.evaluate(async () => {
    const path = '/src/core/recognition.ts'; const { recognizeShape } = await import(/* @vite-ignore */ path);
    const strokes = [
      Array.from({ length: 2001 }, (_, i) => ({ x: 300 + 130 * Math.cos(i / 2000 * Math.PI * 2), y: 300 + 70 * Math.sin(i / 2000 * Math.PI * 2) })),
      Array.from({ length: 201 }, (_, i) => ({ x: 300 + 90 * Math.cos(i / 200 * Math.PI * 2), y: 300 + 87 * Math.sin(i / 200 * Math.PI * 2) })),
    ];
    const times: number[] = [];
    for (let i = 0; i < 40; i++) { const start = performance.now(); const result = recognizeShape(strokes[i % 2]); times.push(performance.now() - start); if (result?.kind !== 'ellipse') throw new Error('fit failed'); }
    times.sort((a, b) => a - b);
    return { samples: 2001, p50Ms: times[20], p95Ms: times[38] };
  });
  console.log('LIUBAI_RECOGNITION', JSON.stringify(measurement));
  expect(measurement.p95Ms).toBeLessThan(50);
});

test('four-sided diagonal gestures do not add expensive contour fitting after their straight runs are confirmed', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const strokes = [.35, .62, .95].map(rotation => skewedRectangleTrace({ rotation, shear: .35 }));
  const measurement = await page.evaluate(async strokes => {
    const path = '/src/core/recognition.ts'; const { recognizeShape } = await import(/* @vite-ignore */ path);
    const times: number[] = [];
    for (let i = 0; i < 40; i++) {
      const start = performance.now(); const result = recognizeShape(strokes[i % strokes.length]); times.push(performance.now() - start);
      if (result?.kind !== 'rect') throw new Error('four-sided gesture became an oval');
    }
    times.sort((a, b) => a - b); return { p50Ms: times[20], p95Ms: times[38] };
  }, strokes);
  console.log('LIUBAI_RECTANGULAR_GESTURE', JSON.stringify(measurement));
  expect(measurement.p95Ms).toBeLessThan(30);
});

test('shape recognition works offline after the application is opened', async ({ page, context }) => {
  await blank(page); await chooseTool(page, '轨迹识别');
  // Preload the test's inspection helper before taking the network away.
  await page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; await import(/* @vite-ignore */ path);
  });
  await context.setOffline(true);
  await trace(page, outline([{ x: 600, y: 280 }, { x: 710, y: 465 }, { x: 490, y: 470 }]));
  const [el] = await read(page);
  expect(el.kind).toBe('triangle');
  const sides = el.vertices.map((p: { x: number; y: number }, i: number, list: { x: number; y: number }[]) => Math.hypot(p.x - list[(i + 1) % 3].x, p.y - list[(i + 1) % 3].y));
  expect(Math.max(...sides) - Math.min(...sides)).toBeLessThan(.001);
});

test('a tilted recognized ellipse keeps its pose in vector and image exports', async ({ page }) => {
  await blank(page); await chooseTool(page, '轨迹识别');
  await page.locator('[data-property="fill"][data-color="#deedf5"]').click();
  await page.locator('#fill-toggle').click();
  const rotation = .55;
  await trace(page, Array.from({ length: 81 }, (_, i) => {
    const angle = i / 80 * Math.PI * 2, x = 120 * Math.cos(angle), y = 50 * Math.sin(angle);
    return { x: 700 + x * Math.cos(rotation) - y * Math.sin(rotation), y: 420 + x * Math.sin(rotation) + y * Math.cos(rotation) };
  }));
  const [el] = await read(page); expect(el.kind).toBe('ellipse'); expect(Math.abs(Math.sin(el.rotation))).toBeGreaterThan(.3);
  const pixels = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { Repository } = await load('/src/storage/repository.ts');
    const { exportSVG, exportPNG } = await load('/src/engine/export.ts');
    const { unionBounds } = await load('/src/core/geometry.ts');
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close();
    const bounds = unionBounds(doc.elements), svg = exportSVG(doc);
    const sample = async (blob: Blob, padding: number) => {
      const url = URL.createObjectURL(blob), image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      const scale = image.width / (bounds.w + 2 * padding);
      const samples = [[768, 462], [768, 378]].map(([x, y]) => [...ctx.getImageData(Math.round((x - bounds.x + padding) * scale), Math.round((y - bounds.y + padding) * scale), 1, 1).data]);
      URL.revokeObjectURL(url); return samples;
    };
    return { png: await sample(await exportPNG(doc), 48), svg: await sample(svg, 40), xml: await svg.text() };
  });
  for (const colors of [pixels.png, pixels.svg]) {
    expect(colors[0].slice(0, 3)).toEqual([222, 237, 245]);
    expect(colors[1].slice(0, 3)).toEqual([248, 249, 246]);
  }
  expect(pixels.xml).toContain('rotate(');
});
