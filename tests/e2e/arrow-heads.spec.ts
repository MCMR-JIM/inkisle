import { expect, test } from '@playwright/test';

test('dashed single and double arrows keep solid heads on Canvas and in PNG/SVG', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { createElement, createDocument } = await load('/src/core/model.ts');
    const { drawElement } = await load('/src/engine/draw.ts');
    const { exportPNG, exportSVG } = await load('/src/engine/export.ts');
    const { unionBounds } = await load('/src/core/geometry.ts');
    const results: { kind: string; format: string; headPixels: number; different: number; shaftGaps: number }[] = [];
    for (const kind of ['arrow', 'bidirectional-arrow']) {
      const el = createElement(kind, { x: 50, y: 80, w: 200, h: 0, stroke: '#000000', strokeWidth: 4, dash: true });
      for (const format of ['canvas', 'png', 'svg']) {
        const images: Uint8ClampedArray[] = [];
        for (const dash of [true, false]) {
          const doc = createDocument(); doc.elements = [{ ...el, dash }];
          const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 160;
          const ctx = canvas.getContext('2d')!;
          if (format === 'canvas') drawElement(ctx, doc.elements[0]);
          else {
            const options = { transparent: true, padding: 40, scale: 1 };
            const blob = format === 'png' ? await exportPNG(doc, doc.elements, options) : exportSVG(doc, doc.elements, options);
            const url = URL.createObjectURL(blob), image = new Image(); image.src = url; await image.decode();
            const bounds = unionBounds(doc.elements);
            ctx.drawImage(image, bounds.x - 40, bounds.y - 40); URL.revokeObjectURL(url);
          }
          images.push(ctx.getImageData(0, 0, 300, 160).data);
        }
        let headPixels = 0, different = 0, shaftGaps = 0;
        for (let y = 67; y <= 93; y++) for (let x = 30; x <= 270; x++) {
          if (Math.abs(y - 80) < 3 || !(x > 228 || (kind === 'bidirectional-arrow' && x < 72))) continue;
          const i = (y * 300 + x) * 4 + 3;
          if (images[1][i]) headPixels++;
          if (Math.abs(images[0][i] - images[1][i]) > 1) different++;
        }
        for (let x = 90; x < 210; x++) if (images[0][(80 * 300 + x) * 4 + 3] === 0) shaftGaps++;
        results.push({ kind, format, headPixels, different, shaftGaps });
      }
    }
    return results;
  });
  for (const result of results) {
    expect(result.headPixels, `${result.kind}/${result.format}`).toBeGreaterThan(20);
    expect(result.different, `${result.kind}/${result.format}`).toBe(0);
    expect(result.shaftGaps, `${result.kind}/${result.format}`).toBeGreaterThan(0);
  }
});
