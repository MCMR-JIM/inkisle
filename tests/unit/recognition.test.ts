import { describe, expect, it } from 'vitest';
import { recognizeShape } from '../../src/core/recognition';
import { createElement, type Point } from '../../src/core/model';
import { elementPaths, polygonPoints } from '../../src/core/paths';
import { hitTest } from '../../src/core/geometry';
import { decodeDocument, encodeDocument } from '../../src/core/codec';
import { createDocument } from '../../src/core/model';
import { resizeFromCorner, objectFrame } from '../../src/core/selection-frame';
import { cutElement } from '../../src/core/cut';
import { eraseAt } from '../../src/core/erasure';
import { worldPoint } from '../../src/core/transforms';

function polygonTrace(vertices: Point[], noise = 0): Point[] {
  return vertices.flatMap((a, index) => {
    const b = vertices[(index + 1) % vertices.length];
    return Array.from({ length: 40 }, (_, j) => ({
      x: a.x + (b.x - a.x) * j / 40 + Math.sin(j * 2.3 + index) * noise,
      y: a.y + (b.y - a.y) * j / 40 + Math.cos(j * 1.7 + index) * noise,
    }));
  }).concat([vertices[0]]);
}

function ellipseTrace(rx: number, ry: number, rotation = 0, noise = 0): Point[] {
  return Array.from({ length: 161 }, (_, i) => {
    const angle = i / 160 * Math.PI * 2, x = rx * Math.cos(angle), y = ry * Math.sin(angle);
    return { x: 300 + x * Math.cos(rotation) - y * Math.sin(rotation) + Math.sin(i * 1.8) * noise, y: 350 + x * Math.sin(rotation) + y * Math.cos(rotation) + Math.cos(i * 2.1) * noise };
  });
}

describe('rectangle variants', () => {
  it('makes ordinary rectangles sharp and reserves rounding for rounded rectangles', () => {
    const rect = createElement('rect', { w: 180, h: 100 });
    expect(rect.radius).toBe(0);
    expect(elementPaths(rect).strokes[0].points).toHaveLength(4);
    const rounded = createElement('roundrect', { w: 180, h: 100 });
    expect(rounded.radius).toBeGreaterThan(0);
    expect(elementPaths(rounded).strokes[0].points.length).toBeGreaterThan(4);
  });
});

describe('offline trajectory recognition', () => {
  it('recognizes an arbitrary scalene triangle without making it equilateral', () => {
    const vertices = [{ x: 150, y: 100 }, { x: 400, y: 130 }, { x: 180, y: 290 }];
    const result = recognizeShape(polygonTrace(vertices, 1.2))!;
    expect(result.kind).toBe('triangle'); expect(result.regular).toBe(false);
    expect(result.vertices).toHaveLength(3);
    const element = createElement('triangle', result);
    const world = result.vertices!.map(p => worldPoint(element, p));
    for (const vertex of vertices) expect(Math.min(...world.map(p => Math.hypot(vertex.x - p.x, vertex.y - p.y)))).toBeLessThan(8);
  });

  it('snaps a near-equilateral triangle to exactly equal side lengths', () => {
    const vertices = [{ x: 250, y: 120 }, { x: 356, y: 295 }, { x: 150, y: 301 }];
    const result = recognizeShape(polygonTrace(vertices, 1))!;
    expect(result.kind).toBe('triangle'); expect(result.regular).toBe(true);
    const sides = result.vertices!.map((p, i, list) => Math.hypot(p.x - list[(i + 1) % 3].x, p.y - list[(i + 1) % 3].y));
    expect(Math.max(...sides) - Math.min(...sides)).toBeLessThan(1e-6);
  });

  it.each([0, .35, .92, -1.1])('recognizes a noisy rectangle rotated by %s radians', rotation => {
    const base = [{ x: -120, y: -65 }, { x: 120, y: -65 }, { x: 120, y: 65 }, { x: -120, y: 65 }];
    const vertices = base.map(p => ({ x: 400 + p.x * Math.cos(rotation) - p.y * Math.sin(rotation), y: 350 + p.x * Math.sin(rotation) + p.y * Math.cos(rotation) }));
    const result = recognizeShape(polygonTrace(vertices, 1.4))!;
    expect(result.kind).toBe('rect'); expect(result.regular).toBe(false);
    expect(Math.max(result.w, result.h)).toBeCloseTo(240, -1);
    expect(Math.min(result.w, result.h)).toBeCloseTo(130, -1);
  });

  it('recognizes a closed rectangle begun halfway along an edge and snaps a near-square', () => {
    const input = polygonTrace([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 290 }, { x: 100, y: 290 }], 1);
    const trace = [...input.slice(18, -1), ...input.slice(0, 19)];
    const result = recognizeShape(trace)!;
    expect(result.kind).toBe('rect'); expect(result.regular).toBe(true);
    expect(result.w).toBeCloseTo(result.h, 8);
  });

  it.each([0, .4, 1.2])('fits a rotated ellipse at %s radians without forcing it circular', rotation => {
    const result = recognizeShape(ellipseTrace(130, 65, rotation, 1.5))!;
    expect(result.kind).toBe('ellipse'); expect(result.regular).toBe(false);
    expect(Math.max(result.w, result.h)).toBeCloseTo(260, -1);
    expect(Math.min(result.w, result.h)).toBeCloseTo(130, -1);
  });

  it('snaps a near-circle, tolerates a small closing gap and reverse drawing direction', () => {
    const result = recognizeShape(ellipseTrace(100, 95, .7, 1).slice(0, -5).reverse())!;
    expect(result.kind).toBe('ellipse'); expect(result.regular).toBe(true);
    expect(result.w).toBeCloseTo(result.h, 8);
  });

  it('always produces one of the three valid shapes for unsupported, open, crossed or tiny trajectories', () => {
    const unsupported = [
      polygonTrace(polygonPoints(200, 200, 100, 100, 5)),
      polygonTrace([{ x: 100, y: 100 }, { x: 320, y: 100 }, { x: 260, y: 270 }, { x: 130, y: 250 }]),
      ellipseTrace(100, 70).slice(0, 95),
      [{ x: 100, y: 100 }, { x: 100, y: 100 }],
      polygonTrace([{ x: 100, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }, { x: 300, y: 100 }]),
      [...ellipseTrace(100, 60), ...ellipseTrace(100, 60)],
    ];
    for (const points of unsupported) {
      const result = recognizeShape(points)!;
      expect(result).not.toBeNull();
      expect(['triangle', 'rect', 'ellipse']).toContain(result.kind);
      expect([result.x, result.y, result.w, result.h, result.rotation].every(Number.isFinite)).toBe(true);
      expect(result.w).toBeGreaterThan(0); expect(result.h).toBeGreaterThan(0);
    }
  });

  it('is scale-independent and bounds recognition work for dense input', () => {
    const points = polygonTrace([{ x: 10, y: 10 }, { x: 210, y: 10 }, { x: 210, y: 110 }, { x: 10, y: 110 }], .7);
    for (const scale of [.1, 10]) {
      const result = recognizeShape(points.map(p => ({ x: p.x * scale, y: p.y * scale })), 8 * scale)!;
      expect(result.kind).toBe('rect');
    }
  });

  it('is independent of drawing direction and loop start for supported shapes', () => {
    const cases = [
      { kind: 'triangle', points: polygonTrace([{ x: 100, y: 100 }, { x: 370, y: 140 }, { x: 130, y: 290 }], 1.3) },
      { kind: 'rect', points: polygonTrace([{ x: 100, y: 100 }, { x: 350, y: 100 }, { x: 350, y: 240 }, { x: 100, y: 240 }], 1.3) },
      { kind: 'ellipse', points: ellipseTrace(130, 75, .6, 1.3) },
    ];
    for (const sample of cases) for (const offset of [0, 17, 43, 80]) {
      const open = sample.points.slice(0, -1), loop = [...open.slice(offset), ...open.slice(0, offset + 1)];
      expect(recognizeShape(loop)?.kind, `${sample.kind}, offset ${offset}`).toBe(sample.kind);
      expect(recognizeShape(loop.reverse())?.kind, `${sample.kind}, reversed ${offset}`).toBe(sample.kind);
    }
  });

  it('converts five-point stars, repeated backtracking and skewed quadrilaterals instead of keeping ink', () => {
    const polygon = polygonPoints(220, 220, 100, 100, 5);
    const star = [polygon[0], polygon[2], polygon[4], polygon[1], polygon[3]];
    for (const sample of [
      polygonTrace(star),
      polygonTrace([{ x: 100, y: 100 }, { x: 340, y: 100 }, { x: 400, y: 260 }, { x: 160, y: 260 }]),
      [...polygonTrace([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 100, y: 200 }]), ...polygonTrace([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 100, y: 200 }]).reverse()],
    ]) expect(['triangle', 'rect', 'ellipse']).toContain(recognizeShape(sample)!.kind);
  });

  it('straightens rough triangle sides while preserving the scalene outline', () => {
    const vertices = [{ x: 120, y: 110 }, { x: 410, y: 150 }, { x: 160, y: 300 }];
    const points = polygonTrace(vertices).map((p, i) => ({ x: p.x + Math.sin(i / 40 * Math.PI) * 7, y: p.y + Math.sin(i / 40 * Math.PI) * 9 }));
    const result = recognizeShape(points)!;
    expect(result.kind).toBe('triangle'); expect(result.vertices).toHaveLength(3); expect(result.regular).toBe(false);
  });

  it('completes three rough sides into a true rectangle rather than treating the gap as a failure', () => {
    const points = polygonTrace([{ x: 100, y: 100 }, { x: 360, y: 111 }, { x: 350, y: 260 }, { x: 93, y: 250 }], 3).slice(0, 119);
    const result = recognizeShape(points)!;
    expect(result.kind).toBe('rect'); expect(result.regular).toBe(false);
    expect(Math.max(result.w, result.h) / Math.min(result.w, result.h)).toBeGreaterThan(1.4);
  });

  it('fits a nearly complete open elliptical arc and fixes a lopsided circle', () => {
    const ellipse = recognizeShape(ellipseTrace(130, 65, .6, 4).slice(0, 135))!;
    expect(ellipse.kind).toBe('ellipse'); expect(ellipse.regular).toBe(false);
    const circle = recognizeShape(ellipseTrace(100, 96, 0, 5).slice(0, 145))!;
    expect(circle.kind).toBe('ellipse'); expect(circle.regular).toBe(true);
    expect(circle.w).toBeCloseTo(circle.h, 8);
  });

  it('creates a small valid circle even for a click or a zero-length trajectory', () => {
    for (const points of [[{ x: 50, y: 60 }], Array.from({ length: 40 }, () => ({ x: 50, y: 60 }))]) {
      const result = recognizeShape(points)!;
      expect(result.kind).toBe('ellipse'); expect(result.w).toBeGreaterThan(0);
      expect(result.w).toBeCloseTo(result.h, 8); expect(result.regular).toBe(true);
    }
    expect(recognizeShape([])).toBeNull();
    expect(recognizeShape([{ x: NaN, y: 0 }])).toBeNull();
  });

  it('bounds the fit to uniform samples even for a very dense recorded trajectory', () => {
    const trace = Array.from({ length: 20001 }, (_, i) => ({ x: 300 + 130 * Math.cos(i / 20000 * Math.PI * 2), y: 350 + 70 * Math.sin(i / 20000 * Math.PI * 2) }));
    const result = recognizeShape(trace)!;
    expect(result.kind).toBe('ellipse');
    expect(result.w).toBeCloseTo(260, 0); expect(result.h).toBeCloseTo(140, 0);
  });
});

it('preserves arbitrary triangle geometry through resize, hit testing and file round trips', () => {
  const el = createElement('triangle', { x: 100, y: 100, w: 200, h: 150, vertices: [{ x: 0, y: 0 }, { x: 200, y: 20 }, { x: 40, y: 150 }] });
  expect(hitTest(el, { x: 280, y: 230 }, 0)).toBe(false);
  expect(hitTest(el, { x: 150, y: 150 }, 0)).toBe(true);
  const frame = objectFrame(el), resized = resizeFromCorner(el, 'se', { x: frame.corners.se.x + 100, y: frame.corners.se.y + 75 }, false);
  expect(resized.vertices![1]).toEqual({ x: 300, y: 30 });
  const doc = createDocument(); doc.elements = [resized];
  expect(decodeDocument(encodeDocument(doc))).toEqual(doc);
  doc.elements[0].vertices = [{ x: NaN, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 3 }];
  expect(() => encodeDocument(doc)).toThrow(/格式/);
});

it('cuts a recognized arbitrary triangle using its actual boundary', () => {
  const el = createElement('triangle', { x: 100, y: 100, w: 200, h: 150, fill: '#e6eee5', vertices: [{ x: 0, y: 0 }, { x: 200, y: 20 }, { x: 40, y: 150 }] });
  const erased = eraseAt(el, [{ x: 190, y: 70 }, { x: 190, y: 290 }], 8)!;
  const parts = cutElement(erased);
  expect(parts).toHaveLength(2);
  expect(parts.every(part => part.vertices === undefined)).toBe(true);
  expect(parts.some(part => hitTest(part, { x: 280, y: 230 }, 0))).toBe(false);
  expect(parts.some(part => hitTest(part, { x: 150, y: 150 }, 0))).toBe(true);
});
