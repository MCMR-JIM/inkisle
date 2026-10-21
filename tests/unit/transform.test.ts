import { describe, expect, it } from 'vitest';
import { createElement } from '../../src/core/model';
import { lineEndpointAt, lineEndpoints, lineRotationHandle, withLineEndpoints, arrowHeadKinds } from '../../src/core/linear';
import { localPoint, rotationCenter, snapLineEndpoint, snapRotation, worldPoint } from '../../src/core/transforms';

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

  it('places the rotation control on the upper near-zero side regardless of endpoint order', () => {
    for (const angle of [-.6, 0, .6, Math.PI / 2, 2.7]) {
      const start = { x: 400, y: 400 }, end = { x: start.x + 220 * Math.cos(angle), y: start.y + 220 * Math.sin(angle) };
      const forward = createElement('arrow', { x: start.x, y: start.y, w: end.x - start.x, h: end.y - start.y });
      const backward = withLineEndpoints(forward, end, start);
      const a = lineRotationHandle(forward), b = lineRotationHandle(backward);
      expect(a.handle.x).toBeCloseTo(b.handle.x, 8); expect(a.handle.y).toBeCloseTo(b.handle.y, 8);
      expect(a.handle.y).toBeLessThanOrEqual(a.midpoint.y + 1e-8);
    }
    const line = createElement('line', { x: 100, y: 200, w: 240 });
    expect(lineRotationHandle(line).handle.y).toBeLessThan(200);
  });

  it('keeps the line rotation stem 28 screen pixels long at different zooms', () => {
    const line = createElement('bidirectional-arrow', { x: 400, y: 400, w: -200, h: 80, rotation: .4 });
    for (const zoom of [.01, .5, 1, 8, 20]) {
      const { midpoint, handle } = lineRotationHandle(line, zoom);
      expect(Math.hypot(handle.x - midpoint.x, handle.y - midpoint.y) * zoom).toBeCloseTo(28, 8);
    }
  });
});
