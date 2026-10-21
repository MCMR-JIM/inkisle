import { describe, expect, it } from 'vitest';
import { recognizeShape } from '../../src/core/recognition';
import { sampledEllipse, skewedRectangleTrace } from '../fixtures/recognition-traces';

describe('imperfect diagonal rectangular gestures', () => {
  it.each([-.9, -.5, .35, .62, Math.PI / 4, 1.05])('finds four sides despite parallel skew, rounded turns and rotation %s', rotation => {
    const result = recognizeShape(skewedRectangleTrace({ rotation }))!;
    expect(result.kind).toBe('rect');
    expect(result.regular).toBe(false);
    expect(Math.abs(result.rotation)).toBeLessThanOrEqual(Math.PI / 4 + 1e-8);
    expect(Math.max(result.w, result.h) / Math.min(result.w, result.h)).toBeGreaterThan(1.25);
    expect(result.w * result.h).toBeGreaterThan(270 * 170 * .75);
    expect(result.w * result.h).toBeLessThan(270 * 170 * 1.5);
  });

  it.each([-.4, .35, .55])('corrects a slanted quadrilateral with shear %s into a rectangle rather than an ellipse', shear => {
    const result = recognizeShape(skewedRectangleTrace({ shear, rotation: .68, taper: 0, bow: 2, radius: 32 }))!;
    expect(result.kind).toBe('rect');
  });

  it('recognizes uneven perspective sides and rounded corners as a four-sided gesture', () => {
    for (const taper of [-.18, .18]) {
      const result = recognizeShape(skewedRectangleTrace({ shear: .15, taper, rotation: .7, radius: 40, bow: 7, noise: 1.8 }))!;
      expect(result.kind).toBe('rect');
    }
  });

  it('tolerates a short missing closing segment and either tracing direction', () => {
    const points = skewedRectangleTrace({ rotation: .67, shear: .3, radius: 35 });
    for (const trace of [points.slice(0, -7), points.slice().reverse()]) expect(recognizeShape(trace)!.kind).toBe('rect');
  });

  it('keeps near-square four-sided intent regular despite diagonal hand skew', () => {
    const result = recognizeShape(skewedRectangleTrace({ width: 210, height: 200, radius: 40, rotation: .65, shear: .2, taper: .04, bow: 3 }))!;
    expect(result.kind).toBe('rect'); expect(result.regular).toBe(true);
    expect(result.w).toBeCloseTo(result.h, 7);
  });

  it('does not label smooth slanted ellipses as rectangles just because their long sides look flat', () => {
    for (const [rx, ry] of [[140, 85], [200, 45], [85, 140]]) {
      const source = sampledEllipse(rx, ry, 0, 2, .7, { x: 0, y: 0 });
      for (const shear of [-.35, .4]) {
        const rotation = .65;
        const points = source.map(p => ({
          x: 450 + (p.x + shear * p.y) * Math.cos(rotation) - p.y * Math.sin(rotation),
          y: 400 + (p.x + shear * p.y) * Math.sin(rotation) + p.y * Math.cos(rotation),
        }));
        expect(recognizeShape(points)!.kind).toBe('ellipse');
      }
    }
  });

  it('keeps four-sided classification independent of orientation, scale and loop starting point', () => {
    for (let index = 0; index < 12; index++) {
      const rotation = -.7 + index * .13, source = skewedRectangleTrace({ rotation, shear: .3, radius: 36 });
      const points = [...source.slice(27), ...source.slice(0, 28)];
      for (const scale of [.4, 2]) {
        const result = recognizeShape(points.map(p => ({ x: (p.x - 450) * scale + 800, y: (p.y - 400) * scale + 600 })), scale * 8)!;
        expect(result.kind, `angle ${rotation}, scale ${scale}`).toBe('rect');
      }
    }
  });
});
