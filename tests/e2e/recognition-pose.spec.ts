import { expect, test, type Page } from '@playwright/test';
import { createBoard, chooseTool } from './helpers';
import { roundedRectangleTrace, sampledEllipse, skewedRectangleTrace } from '../fixtures/recognition-traces';
import type { BoardElement, Point } from '../../src/core/model';
import { objectRotationHandle, selectionFrame } from '../../src/core/selection-frame';
import { rotationCenter, worldPoint } from '../../src/core/transforms';

async function drawRecognition(page: Page, trace: Point[]): Promise<BoardElement> {
  await page.goto('/'); await createBoard(page);
  await chooseTool(page, '轨迹识别');
  await page.mouse.move(trace[0].x, trace[0].y); await page.mouse.down();
  for (const point of trace.slice(1)) await page.mouse.move(point.x, point.y);
  await page.mouse.up();
  await chooseTool(page, '选择工具'); await page.keyboard.press('Control+a');
  return readElement(page);
}

async function readElement(page: Page): Promise<BoardElement> {
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  return page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); return doc.elements[0];
  });
}

async function expectFrameAligned(page: Page, el: BoardElement): Promise<void> {
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const { nw, ne } = selectionFrame(el, 1).corners;
  const angle = Math.atan2(ne.y - nw.y, ne.x - nw.x);
  expect(angle).toBeCloseTo(el.rotation, 6);
  const count = await page.locator('#interaction-canvas').evaluate((canvas: HTMLCanvasElement, point) => {
    const ctx = canvas.getContext('2d')!, dpr = canvas.width / canvas.clientWidth;
    const data = ctx.getImageData(Math.round(point.x * dpr) - 3, Math.round(point.y * dpr) - 3, 7, 7).data;
    let blue = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 2] > data[i] + 20 && data[i + 3] > 50) blue++;
    return blue;
  }, nw);
  expect(count).toBeGreaterThan(0);
}

async function alignToZero(page: Page, el: BoardElement): Promise<BoardElement> {
  const handle = objectRotationHandle(el, 1).handle, center = rotationCenter(el);
  const vector = { x: handle.x - center.x, y: handle.y - center.y };
  const cos = Math.cos(-el.rotation), sin = Math.sin(-el.rotation);
  const target = { x: center.x + vector.x * cos - vector.y * sin, y: center.y + vector.x * sin + vector.y * cos };
  await page.mouse.move(handle.x, handle.y); await page.mouse.down();
  await page.keyboard.down('Shift'); await page.mouse.move(target.x, target.y, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Shift');
  const result = await readElement(page); expect(result.rotation).toBeCloseTo(0, 6); return result;
}

test('hand-drawn rounded rectangle becomes a tilted sharp rectangle whose frame can be aligned to zero', async ({ page }) => {
  const el = await drawRecognition(page, roundedRectangleTrace(260, 160, 64, -.3, 1.1, { x: 760, y: 440 }));
  expect(el.kind).toBe('rect'); expect(el.radius).toBe(0); expect(el.rotation).toBeCloseTo(-.3, 1);
  await expectFrameAligned(page, el);
  await alignToZero(page, el);
  await page.keyboard.press('Control+z'); const undone = await readElement(page); expect(undone.rotation).toBeCloseTo(el.rotation, 6);
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload(); await expect(page.locator('#element-count')).toHaveText('1 个元素');
  expect((await readElement(page)).rotation).toBeCloseTo(0, 6);
});

test('a tilted scalene triangle frame uses its near-horizontal edge and keeps that base level when aligned', async ({ page }) => {
  const angle = -.23, center = { x: 760, y: 440 };
  const vertices = [{ x: -140, y: 85 }, { x: 140, y: 85 }, { x: -70, y: -95 }].map(p => ({ x: center.x + p.x * Math.cos(angle) - p.y * Math.sin(angle), y: center.y + p.x * Math.sin(angle) + p.y * Math.cos(angle) }));
  const trace = vertices.flatMap((a, i) => {
    const b = vertices[(i + 1) % 3]; return Array.from({ length: 25 }, (_, j) => ({ x: a.x + (b.x - a.x) * j / 25, y: a.y + (b.y - a.y) * j / 25 }));
  }).concat([vertices[0]]);
  const el = await drawRecognition(page, trace);
  expect(el.kind).toBe('triangle'); expect(el.rotation).toBeCloseTo(angle, 2); await expectFrameAligned(page, el);
  const aligned = await alignToZero(page, el);
  const world = aligned.vertices!.map(p => worldPoint(aligned, p));
  expect(world.some((a, i) => Math.abs(a.y - world[(i + 1) % 3].y) < .001)).toBe(true);
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s'); const file = await downloading;
  await page.locator('#import-file').setInputFiles((await file.path())!); await expect(page.locator('#toast')).toContainText('画板已导入');
  const imported = await readElement(page); expect(imported.rotation).toBeCloseTo(0, 6); expect(imported.vertices).toEqual(aligned.vertices);
});

test('a tall tilted ellipse uses its major axis and the nearer direction rather than an extra half-turn', async ({ page }) => {
  const el = await drawRecognition(page, sampledEllipse(140, 60, -.64, 2, .5, { x: 760, y: 440 }));
  expect(el.kind).toBe('ellipse'); expect(el.w).toBeGreaterThan(el.h); expect(el.rotation).toBeCloseTo(-.64, 2);
  await expectFrameAligned(page, el); const aligned = await alignToZero(page, el);
  expect(aligned.w).toBeGreaterThan(aligned.h);
  await page.reload(); await expect(page.locator('#element-count')).toHaveText('1 个元素');
  expect((await readElement(page)).rotation).toBeCloseTo(0, 6);
});

test('diagonal hand-skewed rounded quadrilaterals straighten into rectangles with an editable tilted frame', async ({ page }) => {
  const el = await drawRecognition(page, skewedRectangleTrace({ rotation: .62, shear: .35, taper: .08, radius: 38, bow: 5, center: { x: 760, y: 440 } }));
  expect(el.kind).toBe('rect'); expect(el.radius).toBe(0);
  expect(el.rotation).not.toBe(0); expect(Math.abs(el.rotation)).toBeLessThanOrEqual(Math.PI / 4);
  await expectFrameAligned(page, el);
  const { se } = selectionFrame(el, 1).corners;
  await page.mouse.move(se.x, se.y); await page.mouse.down(); await page.mouse.move(se.x + 50, se.y + 45, { steps: 6 }); await page.mouse.up();
  const resized = await readElement(page); expect(resized.kind).toBe('rect'); expect(resized.rotation).toBeCloseTo(el.rotation, 8);
  const nextCorner = selectionFrame(resized, 1).corners.se;
  expect(nextCorner.x).toBeCloseTo(se.x + 50, 0); expect(nextCorner.y).toBeCloseTo(se.y + 45, 0);
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload(); await expect(page.locator('#element-count')).toHaveText('1 个元素');
  const restored = await readElement(page); expect(restored.kind).toBe('rect'); expect(restored.rotation).toBeCloseTo(el.rotation, 8);
});
