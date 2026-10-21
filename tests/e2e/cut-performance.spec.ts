import { expect, test } from '@playwright/test';

test('measures background vector splitting on typical and multi-sweep geometry', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#save-status')).toContainText('已保存在本机');
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { createElement } = await load('/src/core/model.ts');
    const { eraseAt } = await load('/src/core/erasure.ts');
    const { Cutter } = await load('/src/engine/cutter.ts');
    const cutter = new Cutter();
    const line = eraseAt(createElement('line', { w: 300, h: 0 }), [{ x: 150, y: -20 }, { x: 150, y: 20 }], 10);
    let start = performance.now(); await cutter.cut([line], .1); const coldMs = performance.now() - start;
    const values: number[] = [];
    for (let i = 0; i < 15; i++) {
      start = performance.now(); await cutter.cut([line], .1); values.push(performance.now() - start);
    }
    let shape = createElement('rect', { w: 600, h: 400, fill: '#e6eee5' });
    for (let i = 1; i <= 8; i++) shape = eraseAt(shape, [{ x: i * 65, y: -20 }, { x: i * 65, y: 420 }], 5);
    for (let i = 1; i <= 4; i++) shape = eraseAt(shape, [{ x: -20, y: i * 80 }, { x: 620, y: i * 80 }], 5);
    const framesBefore = performance.now();
    let frameCallbacks = 0, finished = false;
    const animate = () => { frameCallbacks++; if (!finished) requestAnimationFrame(animate); };
    requestAnimationFrame(animate);
    start = performance.now(); const [parts] = await cutter.cut([shape], .1); const complexMs = performance.now() - start;
    finished = true; cutter.destroy();
    values.sort((a, b) => a - b);
    return { coldMs, lineP95Ms: values[Math.floor(values.length * .95)], complexMs, complexFragments: parts.length, frameCallbacks, elapsedMs: performance.now() - framesBefore };
  });
  console.log('LIUBAI_VECTOR_CUT', JSON.stringify(result, null, 2));
  expect(result.complexFragments).toBe(45);
  expect(result.lineP95Ms).toBeLessThan(200);
  expect(result.complexMs).toBeLessThan(2000);
});
