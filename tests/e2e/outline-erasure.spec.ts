import { expect, test } from '@playwright/test';
import { createBoard, chooseTool } from './helpers';

test('erasing a single outline edge makes an open path and a second gap creates independently editable fragments', async ({ page }) => {
  await page.goto('/'); await createBoard(page);
  await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(800, 500); await page.mouse.up();
  await chooseTool(page, '橡皮擦');
  await page.mouse.move(650, 280); await page.mouse.down(); await page.mouse.move(650, 320, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => {
    await expect(page.locator('#save-status')).toContainText('已保存在本机');
    return page.evaluate(async () => {
      const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
      const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close();
      return doc.elements[0]?.kind;
    });
  }).toBe('path');
  await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await page.mouse.move(650, 480); await page.mouse.down(); await page.mouse.move(650, 520, { steps: 4 }); await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await chooseTool(page, '选择工具');
  await page.mouse.move(500, 400); await page.mouse.down(); await page.mouse.move(460, 400); await page.mouse.up();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const pixels = await page.locator('#canvas').evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    return [[460, 400], [500, 400], [800, 400]].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
  });
  expect(pixels[0][0]).toBeLessThan(100); expect(pixels[1].slice(0, 3)).toEqual([248, 249, 246]); expect(pixels[2][0]).toBeLessThan(100);
});

test('a recognized rotated unfilled rectangle is cut at the erased world border without moving residual edges', async ({ page }) => {
  await page.goto('/'); await createBoard(page);
  await chooseTool(page, '轨迹识别');
  const angle = .45, center = { x: 700, y: 440 };
  const world = (x: number, y: number) => ({ x: center.x + x * Math.cos(angle) - y * Math.sin(angle), y: center.y + x * Math.sin(angle) + y * Math.cos(angle) });
  const corners = [[-140, -90], [140, -90], [140, 90], [-140, 90]].map(([x, y]) => world(x, y));
  await page.mouse.move(corners[0].x, corners[0].y); await page.mouse.down();
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    await page.mouse.move(a.x, a.y); await page.mouse.move(b.x, b.y, { steps: 15 });
  }
  await page.mouse.up(); await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await chooseTool(page, '橡皮擦');
  const a = world(0, -120), b = world(0, 120);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 15 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const liveHole = world(0, -90);
  const previewPixel = await page.locator('#canvas').evaluate((canvas: HTMLCanvasElement, p) => [...canvas.getContext('2d')!.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data], liveHole);
  expect(previewPixel.slice(0, 3)).toEqual([248, 249, 246]);
  await page.mouse.up();
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const samples = [world(-140, 0), world(140, 0), world(0, -90), world(0, 90)];
  const pixels = await page.locator('#canvas').evaluate((canvas: HTMLCanvasElement, points) => {
    const ctx = canvas.getContext('2d')!;
    return points.map(p => [...ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data]);
  }, samples);
  expect(pixels[0][0]).toBeLessThan(140); expect(pixels[1][0]).toBeLessThan(140);
  expect(pixels[2].slice(0, 3)).toEqual([248, 249, 246]); expect(pixels[3].slice(0, 3)).toEqual([248, 249, 246]);
  await page.keyboard.press('Control+z'); await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload(); await expect(page.locator('#element-count')).toHaveText('2 个元素');
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Control+s');
  const source = await downloading;
  await page.locator('#import-file').setInputFiles((await source.path())!);
  await expect(page.locator('#toast')).toContainText('画板已导入');
  const imported = await page.locator('#canvas').evaluate((canvas: HTMLCanvasElement, points) => {
    const ctx = canvas.getContext('2d')!;
    return points.map(p => [...ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data]);
  }, samples);
  expect(imported[0][0]).toBeLessThan(140); expect(imported[1][0]).toBeLessThan(140);
  expect(imported[2].slice(0, 3)).toEqual([248, 249, 246]); expect(imported[3].slice(0, 3)).toEqual([248, 249, 246]);
});

test('quick consecutive outline erasures finish splitting even when the first worker result arrives late', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private delayed: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options); this.delayed = String(url).includes('cutter.worker');
      }
      set onmessage(handler: ((this: Worker, event: MessageEvent) => unknown) | null) {
        super.onmessage = handler ? event => {
          if (this.delayed) window.setTimeout(() => handler.call(this, event), 450);
          else handler.call(this, event);
        } : null;
      }
    };
  });
  await page.goto('/'); await createBoard(page);
  await chooseTool(page, '矩形');
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(800, 500); await page.mouse.up();
  await chooseTool(page, '橡皮擦');
  await page.mouse.click(650, 300);
  await page.mouse.click(650, 500);
  await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await page.keyboard.press('Control+z'); await expect(page.locator('#element-count')).toHaveText('1 个元素');
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('#element-count')).toHaveText('2 个元素');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  await page.reload(); await expect(page.locator('#element-count')).toHaveText('2 个元素');
});
