import { describe, expect, it } from 'vitest';
import { createDocument, createElement } from '../../src/core/model';
import { decodeDocument, encodeDocument, validateDocument } from '../../src/core/codec';
import { lineEndpointAt, lineEndpoints, lineHandleSide, lineRotationHandle, withLineEndpoints, arrowHeadKinds } from '../../src/core/linear';
import { localPoint, rotatePoint, rotationCenter, snapLineEndpoint, snapRotation, worldPoint } from '../../src/core/transforms';

describe('object transforms', () => {
  it('round-trips a rotated local point', () => {
    const el = createElement('rect', { x: 100, y: 80, w: 200, h: 100, rotation: Math.PI / 4 });
    const point = { x: 50, y: 20 };
    const result = localPoint(el, worldPoint(el, point));
    expect(result.x).toBeCloseTo(point.x, 8); expect(result.y).toBeCloseTo(point.y, 8);
  });

  it('uses the unrotated object center as the rotation pivot', () => {
    const el = createElement('rect', { x: 100, y: 80, w: 200, h: 100, rotation: Math.PI / 3 });
    expect(rotationCenter(el)).toEqual({ x: 200, y: 130 });
  });

  it('snaps rotation to 15 degrees and endpoint direction to 45 degrees', () => {
    expect(snapRotation(Math.PI / 15)).toBeCloseTo(Math.PI / 12);
    const snapped = snapLineEndpoint({ x: 0, y: 0 }, { x: 40, y: 30 });
    expect(snapped.x).toBeCloseTo(Math.hypot(40, 30) / Math.sqrt(2), 8);
    expect(snapped.y).toBeCloseTo(snapped.x, 8);
  });
});

describe('linear endpoint semantics', () => {
  it('edits only the requested endpoint and preserves arrow metadata', () => {
    const arrow = createElement('arrow', { x: 10, y: 20, w: 80, h: 30, rotation: 0 });
    const next = withLineEndpoints(arrow, { x: 15, y: 25 }, lineEndpoints(arrow).end);
    const endpoints = lineEndpoints(next);
    expect(endpoints.start).toEqual({ x: 15, y: 25 });
    expect(endpoints.end).toEqual({ x: 90, y: 50 });
    expect(arrowHeadKinds(next)).toEqual({ start: false, end: true });
  });

  it('hits screen-space endpoint candidates before the line body', () => {
    const line = createElement('line', { x: 10, y: 20, w: 80, h: 30 });
    expect(lineEndpointAt(line, { x: 10, y: 20 }, 8)).toBe('start');
    expect(lineEndpointAt(line, { x: 90, y: 50 }, 8)).toBe('end');
  });

  it('initially places the rotation control on the upper near-zero side regardless of drawing direction', () => {
    for (const angle of [-.6, 0, .6, Math.PI / 2, 2.7]) {
      const start = { x: 400, y: 400 }, end = { x: start.x + 220 * Math.cos(angle), y: start.y + 220 * Math.sin(angle) };
      const forward = createElement('arrow', { x: start.x, y: start.y, w: end.x - start.x, h: end.y - start.y });
      const backward = createElement('arrow', { x: end.x, y: end.y, w: start.x - end.x, h: start.y - end.y });
      const a = lineRotationHandle(forward), b = lineRotationHandle(backward);
      expect(a.handle.x).toBeCloseTo(b.handle.x, 8); expect(a.handle.y).toBeCloseTo(b.handle.y, 8);
      expect(a.handle.y).toBeLessThanOrEqual(a.midpoint.y + 1e-8);
    }
    const line = createElement('line', { x: 100, y: 200, w: 240 });
    expect(lineRotationHandle(line).handle.y).toBeLessThan(200);
  });

  it('keeps the initial stem attached through a full turn, including both vertical crossings', () => {
    for (const w of [-220, 220]) {
      const line = createElement('arrow', { x: 400, y: 300, w, h: 80 });
      line.rotationHandleSide = lineHandleSide(line);
      const initial = lineRotationHandle(line);
      for (let degree = -360; degree <= 360; degree++) {
        const rotation = degree * Math.PI / 180, next = lineRotationHandle({ ...line, rotation });
        const expected = rotatePoint(initial.handle, initial.midpoint, rotation);
        expect(next.handle.x).toBeCloseTo(expected.x, 8); expect(next.handle.y).toBeCloseTo(expected.y, 8);
      }
      expect(lineRotationHandle({ ...line, rotation: Math.PI }).handle.y).toBeGreaterThan(initial.midpoint.y);
    }
  });

  it('retains its initial side when endpoint edits reset the rotation or cross the vertical axis', () => {
    const line = createElement('line', { x: 400, y: 300, w: 220, h: 0, rotation: Math.PI });
    const next = withLineEndpoints(line, lineEndpoints(line).start, lineEndpoints(line).end);
    expect(next.rotationHandleSide).toBe(1);
    expect(lineRotationHandle(next).handle.y).toBeCloseTo(lineRotationHandle(line).handle.y, 8);
    const before = withLineEndpoints(line, { x: 400, y: 300 }, { x: 401, y: 500 });
    const after = withLineEndpoints(before, { x: 400, y: 300 }, { x: 399, y: 500 });
    expect(Math.hypot(lineRotationHandle(after).handle.x - lineRotationHandle(before).handle.x, lineRotationHandle(after).handle.y - lineRotationHandle(before).handle.y)).toBeLessThan(2);
  });

  it('keeps the line rotation stem 28 screen pixels long at different zooms', () => {
    const line = createElement('bidirectional-arrow', { x: 400, y: 400, w: -200, h: 80, rotation: .4 });
    for (const zoom of [.01, .5, 1, 8, 20]) {
      const { midpoint, handle } = lineRotationHandle(line, zoom);
      expect(Math.hypot(handle.x - midpoint.x, handle.y - midpoint.y) * zoom).toBeCloseTo(28, 8);
    }
  });

  it('round-trips the initial handle side and rejects invalid side values', () => {
    const doc = createDocument(), line = createElement('arrow', { w: -200, h: 80, rotation: Math.PI, rotationHandleSide: -1 });
    doc.elements = [line];
    expect(decodeDocument(encodeDocument(doc)).elements[0].rotationHandleSide).toBe(-1);
    for (const rotationHandleSide of [0, 2, 'upper', null]) {
      expect(() => validateDocument({ ...doc, elements: [{ ...line, rotationHandleSide }] })).toThrow();
    }
  });
});
