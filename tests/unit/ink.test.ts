import { describe, expect, it } from 'vitest';
import { PressureSampler } from '../../src/core/pressure';
import { hitInk, inkSVG, simplifyInk, smoothInk } from '../../src/core/ink';
import { createDocument, createElement } from '../../src/core/model';
import { decodeDocument, encodeDocument } from '../../src/core/codec';
import { hitTest } from '../../src/core/geometry';
import { eraseAt } from '../../src/core/erasure';
import { cutElement } from '../../src/core/cut';
import { transformPath } from '../../src/core/paths';

describe('pressure input', () => {
  it('uses actual pen pressure including zero independently of drawing speed', () => {
    const a = new PressureSampler('pen', { x: 0, y: 0, time: 0, pressure: 0 });
    const b = new PressureSampler('pen', { x: 0, y: 0, time: 0, pressure: 0 });
    expect(a.value).toBe(0);
    const pressure = a.next({ x: 5, y: 0, time: 30, pressure: .9 });
    expect(pressure).toBeGreaterThan(.7);
    expect(pressure).toBeLessThan(.9);
    expect(b.next({ x: 500, y: 0, time: 30, pressure: .9 })).toBe(pressure);
    expect(a.next({ x: 5, y: 0, time: 60, pressure: 0 })).toBeLessThan(.1);
  });

  it('makes slow mouse strokes thicker than fast strokes and bounds timestamp anomalies', () => {
    const slow = new PressureSampler('mouse', { x: 0, y: 0, time: 0 });
    const fast = new PressureSampler('mouse', { x: 0, y: 0, time: 0 });
    for (let i = 1; i <= 20; i++) {
      slow.next({ x: i * 2, y: 0, time: i * 20 });
      fast.next({ x: i * 40, y: 0, time: i * 20 });
    }
    expect(slow.value - fast.value).toBeGreaterThan(.25);
    const previous = fast.value;
    expect(fast.next({ x: 900, y: 0, time: 400 })).toBe(previous);
    expect(fast.next({ x: 1000, y: 0, time: 399 })).toBe(previous);
    expect(fast.next({ x: 1000, y: 0, time: 420 })).toBeGreaterThanOrEqual(0);
    expect(fast.value).toBeLessThanOrEqual(1);
  });
});

describe('shared variable-width ink geometry', () => {
  it('preserves pressure peaks on a geometrically straight stroke during simplification', () => {
    const source = [{ x: 0, y: 0, pressure: .1 }, { x: 50, y: 0, pressure: 1 }, { x: 100, y: 0, pressure: .1 }];
    expect(simplifyInk(source, 1)).toEqual(source);
    expect(simplifyInk(source.map(p => ({ ...p, pressure: .5 })), 1)).toHaveLength(2);
    const smooth = smoothInk(source);
    expect(smooth.length).toBeGreaterThan(3);
    expect(Math.max(...smooth.map(p => p.pressure!))).toBeGreaterThan(.65);
    expect(smooth.every(p => Number.isFinite(p.x) && Number.isFinite(p.pressure))).toBe(true);
  });

  it('hits actual varying widths rather than the maximum width along the entire stroke', () => {
    const points = [{ x: 0, y: 0, pressure: 0 }, { x: 100, y: 0, pressure: 1 }];
    expect(hitInk(points, { x: 5, y: 3 }, 10, 0)).toBe(false);
    expect(hitInk(points, { x: 95, y: 3 }, 10, 0)).toBe(true);
    expect(hitInk(points, { x: 5, y: 3 }, 10, 2)).toBe(true);
    expect(hitInk([{ x: 0, y: 0, pressure: 0 }], { x: 1, y: 0 }, 10, 0)).toBe(true);
  });

  it('shares dash gaps and safely represents single points and reversals in SVG geometry', () => {
    const points = [{ x: 0, y: 0, pressure: 1 }, { x: 40, y: 0, pressure: 1 }];
    expect(hitInk(points, { x: 11, y: 0 }, 2, 0, true)).toBe(false);
    expect(hitInk(points, { x: 16, y: 0 }, 2, 0, true)).toBe(true);
    for (const samples of [[], [points[0]], [points[0], points[0]], [...points, points[0]]]) {
      const svg = inkSVG(samples, 7);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      if (samples.length) expect(svg).toContain('A');
    }
  });

  it('retains the visible overshoot of a collinear quadratic hairpin', () => {
    const centerline = smoothInk([{ x: 0, y: 0, pressure: .5 }, { x: 100, y: 0, pressure: .5 }, { x: 0, y: 0, pressure: .5 }]);
    expect(Math.max(...centerline.map(p => p.x))).toBeGreaterThan(66);
    expect(Math.max(...centerline.map(p => p.x))).toBeLessThan(67);
  });
});

describe('pressure persistence and editing', () => {
  const points = [{ x: 0, y: 0, pressure: 0 }, { x: 200, y: 0, pressure: 1 }];

  it('round-trips the explicit new ink flag and rejects malformed flags and path pressures', () => {
    const doc = createDocument();
    doc.elements = [createElement('pen', { pressureEnabled: true, points })];
    expect(decodeDocument(encodeDocument(doc))).toEqual(doc);
    (doc.elements[0] as unknown as { pressureEnabled: string }).pressureEnabled = 'true';
    expect(() => encodeDocument(doc)).toThrow(/格式/);
    doc.elements = [createElement('path', { path: { fills: [], strokes: [{ pressureEnabled: true, closed: false, points: [{ x: 0, y: 0, pressure: 2 }] }] } })];
    expect(() => encodeDocument(doc)).toThrow(/格式/);
  });

  it('uses actual pressure for new ink while old pressure samples remain equal width', () => {
    const pen = createElement('pen', { pressureEnabled: true, points, strokeWidth: 10 });
    expect(hitTest(pen, { x: 5, y: 3 }, 0)).toBe(false);
    expect(hitTest(pen, { x: 195, y: 3 }, 0)).toBe(true);
    expect(hitTest({ ...pen, pressureEnabled: undefined }, { x: 5, y: 3 }, 0)).toBe(true);
  });

  it('interpolates pressure at eraser cuts and keeps widths on separate fragments', () => {
    const pen = createElement('pen', { x: 100, y: 200, pressureEnabled: true, points, strokeWidth: 10 });
    const parts = cutElement(eraseAt(pen, [{ x: 200, y: 180 }, { x: 200, y: 220 }], 10)!);
    expect(parts).toHaveLength(2);
    const left = parts[0].path!.strokes[0], right = parts[1].path!.strokes[0];
    expect(left.pressureEnabled).toBe(true); expect(right.pressureEnabled).toBe(true);
    expect(left.points.at(-1)!.pressure).toBeCloseTo(.45);
    expect(right.points[0].pressure).toBeCloseTo(.55);
    expect(parts.some(part => hitTest(part, { x: 105, y: 203 }, 0))).toBe(false);
    expect(parts.some(part => hitTest(part, { x: 295, y: 203 }, 0))).toBe(true);
    expect(parts.some(part => hitTest(part, { x: 200, y: 200 }, 0))).toBe(false);
  });

  it('retains pressure samples when transforming cut paths', () => {
    const path = transformPath({ fills: [], strokes: [{ pressureEnabled: true, points, closed: false }] }, 2, 3)!;
    expect(path.strokes[0].pressureEnabled).toBe(true);
    expect(path.strokes[0].points).toEqual([{ x: 0, y: 0, pressure: 0 }, { x: 400, y: 0, pressure: 1 }]);
  });

  it('keeps disabled pressure explicitly editable on cut fragments', () => {
    const pen = createElement('pen', { pressureEnabled: false, points, strokeWidth: 10 });
    const parts = cutElement(eraseAt(pen, [{ x: 100, y: -20 }, { x: 100, y: 20 }], 10)!);
    expect(parts).toHaveLength(2);
    expect(parts.every(part => part.path!.strokes.every(stroke => stroke.pressureEnabled === false))).toBe(true);
  });
});
