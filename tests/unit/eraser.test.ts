import { expect, it } from 'vitest';
import { eraserRadius, normalizeEraserSize, wheelEraserSize } from '../../src/core/eraser';

it('normalizes stored and manual eraser sizes to bounded screen diameters', () => {
  expect(normalizeEraserSize(NaN)).toBe(20); expect(normalizeEraserSize(Infinity)).toBe(20);
  expect(normalizeEraserSize(-5)).toBe(4); expect(normalizeEraserSize(999)).toBe(120);
  expect(normalizeEraserSize(41)).toBe(42); expect(normalizeEraserSize(40)).toBe(40);
});

it('handles pixel, line and page wheel units and leaves zero or invalid deltas unchanged', () => {
  expect(wheelEraserSize(20, -100)).toBe(22); expect(wheelEraserSize(20, 100)).toBe(18);
  expect(wheelEraserSize(20, -.5)).toBe(22); expect(wheelEraserSize(20, -3, 1)).toBe(22);
  expect(wheelEraserSize(20, -1, 2)).toBe(36);
  expect(wheelEraserSize(20, 0)).toBe(20); expect(wheelEraserSize(20, NaN)).toBe(20);
  expect(wheelEraserSize(20, -100000)).toBe(120); expect(wheelEraserSize(20, 100000)).toBe(4);
});

it('uses the same screen diameter for the preview and world-space erasure at every zoom', () => {
  for (const zoom of [.01, .25, 1, 2, 20]) expect(eraserRadius(40, zoom) * 2 * zoom).toBe(40);
});
