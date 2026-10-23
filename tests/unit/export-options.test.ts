import { expect, it } from 'vitest';
import { exportDimensions } from '../../src/engine/export';

it('calculates requested pixel dimensions and caps oversized raster exports', () => {
  expect(exportDimensions({ w: 200, h: 100 }, { padding: 10, scale: 2 })).toEqual({ width: 440, height: 240, scale: 2 });
  const large = exportDimensions({ w: 100000, h: 50000 }, { padding: 0, scale: 4 });
  expect(large.width).toBeLessThanOrEqual(8192);
  expect(large.width * large.height).toBeLessThanOrEqual(16000000);
  expect(large.scale).toBeLessThan(1);
  for (const padding of [NaN, Infinity, -1, 501]) expect(() => exportDimensions({ w: 20, h: 10 }, { padding })).toThrow();
});
