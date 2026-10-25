import { describe, expect, it } from 'vitest';
import { captureBounds, rectangleRegion } from '../../src/core/capture';

describe('capture region coordinates', () => {
  it('preserves the world extent for reversed drags and concave polygons', () => {
    expect(captureBounds(rectangleRegion({ x: 300, y: 100 }, { x: -40, y: -20 }))).toEqual({ x: -40, y: -20, w: 340, h: 120 });
    const concave = [{ x: 1e8, y: 1e8 }, { x: 1e8 + 30, y: 1e8 }, { x: 1e8 + 10, y: 1e8 + 10 }, { x: 1e8, y: 1e8 + 30 }];
    expect(captureBounds(concave)).toEqual({ x: 1e8, y: 1e8, w: 30, h: 30 });
    expect(captureBounds([...concave].reverse())).toEqual(captureBounds(concave));
  });
  it('rejects incomplete, degenerate, non-finite and excessive vertex lists', () => {
    for (const points of [[], [{ x: 0, y: 0 }, { x: 10, y: 10 }], rectangleRegion({ x: 0, y: 0 }, { x: 0, y: 50 }), [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], rectangleRegion({ x: 0, y: 0 }, { x: Infinity, y: 1 }), Array.from({ length: 513 }, (_, x) => ({ x, y: x % 2 }))]) expect(captureBounds(points)).toBeNull();
  });
});
