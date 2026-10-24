import { expect, test } from '@playwright/test';
import { chooseTool } from './helpers';

for (const pressure of [false, true]) test(`handwriting keeps its live curve after release and reopening (pressure ${pressure})`, async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
  await chooseTool(page, '画笔');
  const toggle = page.getByRole('switch', { name: '压感', exact: true });
  if ((await toggle.isChecked()) !== pressure) await toggle.click();
  await page.locator('[data-width="2"]').click();
  const result = await page.locator('#interaction-canvas').evaluate(async (canvas: HTMLCanvasElement) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { drawElement } = await load('/src/engine/draw.ts');
    const { Repository } = await load('/src/storage/repository.ts');
    canvas.setPointerCapture = () => {};
    const send = (type: string, x: number, y: number, time: number) => {
      const event = new PointerEvent(type, { pointerId: 93, pointerType: 'pen', clientX: x, clientY: y, pressure: .7, buttons: type === 'pointerup' ? 0 : 1, bubbles: true });
      Object.defineProperty(event, 'timeStamp', { value: time }); canvas.dispatchEvent(event);
    };
    send('pointerdown', 500, 350, 100);
    let x = 500, y = 350;
    for (let i = 1; i <= 160; i++) { x = 500 + i * 2; y = 350 + 30 * Math.sin(i / 16) + .9 * Math.sin(i * 2.4); send('pointermove', x, y, 100 + i * 8); }
    await new Promise(requestAnimationFrame);
    const before = canvas.getContext('2d')!.getImageData(490, 300, 350, 100).data;
    send('pointerup', x, y, 1400);
    let doc;
    const repo = new Repository();
    for (let i = 0; i < 100; i++) {
      doc = await repo.load(localStorage.getItem('liubai:last-board'));
      if (doc?.elements.length === 1) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    repo.close();
    if (!doc?.elements.length) throw new Error('Stroke was not saved');
    const pen = doc.elements[0];
    const reference = document.createElement('canvas'); reference.width = canvas.width; reference.height = canvas.height;
    const ctx = reference.getContext('2d')!; ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.translate(doc.camera.x, doc.camera.y); ctx.scale(doc.camera.zoom, doc.camera.zoom); drawElement(ctx, pen);
    const after = ctx.getImageData(490, 300, 350, 100).data;
    let maxAlphaDelta = 0;
    for (let i = 3; i < before.length; i += 4) maxAlphaDelta = Math.max(maxAlphaDelta, Math.abs(before[i] - after[i]));
    return { maxAlphaDelta, pen };
  });
  expect(result.maxAlphaDelta).toBe(0);
  expect(result.pen.points.length).toBeGreaterThan(120);
  expect(result.pen.pressureEnabled).toBe(pressure);
  await page.reload();
  const reopened = await page.evaluate(async () => {
    const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
    const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close(); return doc!.elements[0];
  });
  expect(reopened).toEqual(result.pen);
});

test('coalesced batches and zoom preserve the same screen-space handwriting', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建画板', exact: true }).first().click();
  await chooseTool(page, '画笔');
  const strokes = [];
  for (const batch of [false, true]) {
    if (batch) { await page.locator('#zoom-in').click(); await page.locator('#zoom-in').click(); }
    await page.locator('#interaction-canvas').evaluate((canvas: HTMLCanvasElement, batch) => {
      canvas.setPointerCapture = () => {};
      const event = (type: string, i: number) => {
        const e = new PointerEvent(type, { pointerId: 94, pointerType: 'pen', clientX: 500 + i * 2, clientY: 350 + 20 * Math.sin(i / 9) + .8 * Math.sin(i * 2.4), pressure: .7, buttons: type === 'pointerup' ? 0 : 1, bubbles: true });
        Object.defineProperty(e, 'timeStamp', { value: 100 + i * 8 }); return e;
      };
      canvas.dispatchEvent(event('pointerdown', 0));
      const moves = Array.from({ length: 90 }, (_, i) => event('pointermove', i + 1));
      if (batch) { const final = moves.at(-1)!; Object.defineProperty(final, 'getCoalescedEvents', { value: () => moves }); canvas.dispatchEvent(final); }
      else for (const move of moves) canvas.dispatchEvent(move);
      canvas.dispatchEvent(event('pointerup', 90));
    }, batch);
    await expect(page.locator('#element-count')).toHaveText(`${batch ? 2 : 1} 个元素`);
    await expect(page.locator('#save-status')).toContainText('已保存在本机');
    strokes.push(await page.evaluate(async () => {
      const path = '/src/storage/repository.ts'; const { Repository } = await import(/* @vite-ignore */ path);
      const repo = new Repository(); const doc = await repo.load(localStorage.getItem('liubai:last-board')); repo.close();
      return { zoom: doc!.camera.zoom, points: doc!.elements.at(-1)!.points };
    }));
  }
  expect(strokes[1].points.length).toBe(strokes[0].points.length);
  for (let i = 0; i < strokes[0].points.length; i++) {
    expect(strokes[1].points[i].x * strokes[1].zoom).toBeCloseTo(strokes[0].points[i].x * strokes[0].zoom, 8);
    expect(strokes[1].points[i].y * strokes[1].zoom).toBeCloseTo(strokes[0].points[i].y * strokes[0].zoom, 8);
    expect(strokes[1].points[i].pressure).toBeCloseTo(strokes[0].points[i].pressure!, 8);
  }
});
