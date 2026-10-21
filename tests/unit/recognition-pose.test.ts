import { describe, expect, it } from 'vitest';
import { roundedRectangleTrace, sampledEllipse } from '../fixtures/recognition-traces';
import { recognizeShape, type RecognizedShape } from '../../src/core/recognition';
import { createDocument, createElement, type Point } from '../../src/core/model';
import { worldPoint } from '../../src/core/transforms';
import { objectFrame, selectionFrame } from '../../src/core/selection-frame';
import { decodeDocument, encodeDocument } from '../../src/core/codec';

const axisAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle)) > Math.PI / 2
  ? Math.atan2(Math.sin(angle), Math.cos(angle)) - Math.PI
  : Math.atan2(Math.sin(angle), Math.cos(angle)) < -Math.PI / 2
    ? Math.atan2(Math.sin(angle), Math.cos(angle)) + Math.PI : Math.atan2(Math.sin(angle), Math.cos(angle));
const rectangleAngle = (angle: number) => {
  let result = axisAngle(angle);
  if (result > Math.PI / 4) result -= Math.PI / 2;
  if (result < -Math.PI / 4) result += Math.PI / 2;
  return result;
};

function worldVertices(shape: RecognizedShape): Point[] {
  const element = createElement(shape.kind, shape);
  return shape.vertices!.map(point => worldPoint(element, point));
}

describe('rounded hand-drawn rectangle recognition', () => {
  it.each([.12, .25, .38, .45])('straightens four-sided loops even with corner radius %s of their short side', ratio => {
    for (const rotation of [0, .28, -.38, .95]) {
      const result = recognizeShape(roundedRectangleTrace(260, 150, 150 * ratio, rotation, 1.3))!;
      expect(result.kind, `radius ${ratio}, rotation ${rotation}`).toBe('rect');
      expect(Math.max(result.w, result.h)).toBeCloseTo(260, -1);
      expect(Math.min(result.w, result.h)).toBeCloseTo(150, -1);
      expect(result.rotation).toBeCloseTo(rectangleAngle(rotation), 1);
    }
  });

  it('recognizes a near-square with rounded turns as a square rather than a circle', () => {
    const result = recognizeShape(roundedRectangleTrace(200, 192, 55, -.27, 1.5))!;
    expect(result.kind).toBe('rect'); expect(result.regular).toBe(true);
    expect(result.w).toBeCloseTo(result.h, 7);
  });

  it('retains rectangles with four gently bowed sides and rounded transitions', () => {
    const result = recognizeShape(sampledEllipse(140, 85, .31, 4, 1.2))!;
    expect(result.kind).toBe('rect');
    expect(result.rotation).toBeCloseTo(.31, 1);
  });

  it('does not turn genuine smooth circles and ellipses into rectangles', () => {
    for (const dimensions of [[100, 100], [140, 75], [170, 40], [75, 140]]) for (const rotation of [0, .31, -.7, 1.2]) {
      const shape = recognizeShape(sampledEllipse(dimensions[0], dimensions[1], rotation, 2, 1.2))!;
      expect(shape.kind, `${dimensions}, angle ${rotation}`).toBe('ellipse');
    }
  });

  it('still identifies uneven, noisy ellipse loops that are not mathematically perfect', () => {
    for (const rotation of [-.42, .68]) for (const exponent of [1.8, 2, 2.3]) {
      const shape = recognizeShape(sampledEllipse(130, 75, rotation, exponent, 3))!;
      expect(shape.kind, `ellipse exponent ${exponent}, angle ${rotation}`).toBe('ellipse');
    }
    expect(recognizeShape(sampledEllipse(100, 97, .6, 2, 4))!.kind).toBe('ellipse');
  });
});

describe('recognized shape canonical orientation', () => {
  it.each([.28, -.28, .96, -1.1, 2.82])('uses the rectangle edge nearest horizontal as its local x axis (%s)', rotation => {
    const result = recognizeShape(roundedRectangleTrace(250, 140, 4, rotation, .2))!;
    expect(result.kind).toBe('rect');
    expect(result.rotation).toBeCloseTo(rectangleAngle(rotation), 2);
    expect(Math.abs(result.rotation)).toBeLessThanOrEqual(Math.PI / 4 + 1e-8);
    const frame = objectFrame(createElement('rect', result));
    expect(Math.atan2(frame.corners.ne.y - frame.corners.nw.y, frame.corners.ne.x - frame.corners.nw.x)).toBeCloseTo(result.rotation, 7);
  });

  it.each([-.35, .42, 1.22, 2.8, -2.7])('uses the major ellipse axis with the direction closest to zero (%s)', rotation => {
    const result = recognizeShape(sampledEllipse(140, 65, rotation, 2, .2))!;
    expect(result.kind).toBe('ellipse'); expect(result.w).toBeGreaterThan(result.h);
    expect(result.rotation).toBeCloseTo(axisAngle(rotation), 2);
    expect(Math.abs(result.rotation)).toBeLessThanOrEqual(Math.PI / 2 + 1e-8);
  });

  it('treats a vertical major axis as vertical and circles as having no direction', () => {
    const tall = recognizeShape(sampledEllipse(65, 140))!;
    expect(tall.w).toBeGreaterThan(tall.h); expect(Math.abs(tall.rotation)).toBeCloseTo(Math.PI / 2, 2);
    const circle = recognizeShape(sampledEllipse(100, 96, 1.2, 2, 1))!;
    expect(circle.kind).toBe('ellipse'); expect(circle.rotation).toBe(0); expect(circle.w).toBeCloseTo(circle.h, 7);
  });

  it('expresses a scalene triangle relative to its near-horizontal base without changing its world vertices', () => {
    const angle = -.24, center = { x: 450, y: 400 };
    const original = [{ x: -125, y: 75 }, { x: 125, y: 75 }, { x: -70, y: -90 }].map(point => ({ x: center.x + point.x * Math.cos(angle) - point.y * Math.sin(angle), y: center.y + point.x * Math.sin(angle) + point.y * Math.cos(angle) }));
    const trace = original.flatMap((a, i) => {
      const b = original[(i + 1) % 3];
      return Array.from({ length: 40 }, (_, j) => ({ x: a.x + (b.x - a.x) * j / 40, y: a.y + (b.y - a.y) * j / 40 }));
    }).concat([original[0]]);
    const result = recognizeShape(trace)!;
    expect(result.kind).toBe('triangle'); expect(result.regular).toBe(false); expect(result.rotation).toBeCloseTo(angle, 2);
    const vertices = worldVertices(result);
    for (const point of original) expect(Math.min(...vertices.map(p => Math.hypot(p.x - point.x, p.y - point.y)))).toBeLessThan(5);
    const localBase = result.vertices!.some((point, i, list) => Math.abs(point.y - list[(i + 1) % 3].y) < 1e-6);
    expect(localBase).toBe(true);
    const frame = selectionFrame(createElement('triangle', result), 1);
    expect(Math.atan2(frame.corners.ne.y - frame.corners.nw.y, frame.corners.ne.x - frame.corners.nw.x)).toBeCloseTo(angle, 2);
    const aligned = createElement('triangle', { ...result, rotation: 0 });
    const alignedVertices = result.vertices!.map(p => worldPoint(aligned, p));
    expect(alignedVertices.some((point, i, list) => Math.abs(point.y - list[(i + 1) % 3].y) < 1e-6)).toBe(true);
    const doc = createDocument(); doc.elements = [createElement('triangle', result)];
    expect(decodeDocument(encodeDocument(doc))).toEqual(doc);
  });

  it.each([.6, 1.3, -1.15, 2.7])('chooses the nearest horizontal triangle side for either tracing direction (%s)', rotation => {
    const points = [{ x: -140, y: 75 }, { x: 140, y: 75 }, { x: -65, y: -95 }].map(p => ({ x: 450 + p.x * Math.cos(rotation) - p.y * Math.sin(rotation), y: 400 + p.x * Math.sin(rotation) + p.y * Math.cos(rotation) }));
    const trace = points.flatMap((a, i) => {
      const b = points[(i + 1) % 3]; return Array.from({ length: 40 }, (_, j) => ({ x: a.x + (b.x - a.x) * j / 40, y: a.y + (b.y - a.y) * j / 40 }));
    }).concat([points[0]]);
    const expected = points.map((a, i) => axisAngle(Math.atan2(points[(i + 1) % 3].y - a.y, points[(i + 1) % 3].x - a.x))).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
    for (const input of [trace, trace.slice().reverse()]) {
      const result = recognizeShape(input)!;
      expect(result.kind).toBe('triangle'); expect(Math.abs(result.rotation - expected)).toBeLessThan(.015);
      expect(result.vertices!.some((p, i, list) => Math.abs(p.y - list[(i + 1) % 3].y) < 1e-6)).toBe(true);
      for (const p of points) expect(Math.min(...worldVertices(result).map(q => Math.hypot(q.x - p.x, q.y - p.y)))).toBeLessThan(5);
    }
  });
});
