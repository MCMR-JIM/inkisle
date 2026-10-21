import { describe, expect, it } from 'vitest';
import { createElement, type BoardElement } from '../../src/core/model';
import { objectFrame, objectRotationHandle, resizeFromCorner, selectionFrame, selectionPadding, type CornerHandle } from '../../src/core/selection-frame';
import { localPoint } from '../../src/core/transforms';

const opposite: Record<CornerHandle, CornerHandle> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' };

describe('shared selection frame geometry', () => {
  it('uses one rotated rectangle for the dashed sides and all four handles', () => {
    const el = createElement('rect', { x: 400, y: 300, w: 240, h: 140, rotation: Math.PI / 6 });
    const frame = objectFrame(el);
    expect(Object.keys(frame.corners)).toEqual(['nw', 'ne', 'sw', 'se']);
    const { nw, ne, sw, se } = frame.corners;
    expect(Math.hypot(ne.x - nw.x, ne.y - nw.y)).toBeCloseTo(240);
    expect(Math.hypot(sw.x - nw.x, sw.y - nw.y)).toBeCloseTo(140);
    expect(nw.x + se.x).toBeCloseTo(ne.x + sw.x);
    expect(nw.y + se.y).toBeCloseTo(ne.y + sw.y);
  });

  it.each(['nw', 'ne', 'sw', 'se'] as const)('keeps the %s corner on the pointer and the opposite corner fixed after rotation', handle => {
    const el = createElement('rect', { x: 420, y: 330, w: 240, h: 140, rotation: Math.PI / 4 });
    const before = objectFrame(el).corners;
    const target = { x: before[handle].x + (handle.includes('w') ? -45 : 45), y: before[handle].y + (handle.includes('n') ? -25 : 25) };
    const result = resizeFromCorner(el, handle, target, false);
    const after = objectFrame(result).corners;
    expect(after[handle].x).toBeCloseTo(target.x, 8);
    expect(after[handle].y).toBeCloseTo(target.y, 8);
    expect(after[opposite[handle]].x).toBeCloseTo(before[opposite[handle]].x, 8);
    expect(after[opposite[handle]].y).toBeCloseTo(before[opposite[handle]].y, 8);
    expect(result.rotation).toBe(el.rotation);
  });

  it('keeps Shift resizing proportional and preserves the fixed anchor', () => {
    const el = createElement('rect', { x: 400, y: 300, w: 200, h: 100, rotation: .6 });
    const before = objectFrame(el).corners;
    const result = resizeFromCorner(el, 'se', { x: before.se.x + 70, y: before.se.y + 50 }, true);
    expect(Math.abs(result.w / result.h)).toBeCloseTo(2, 8);
    expect(objectFrame(result).corners.nw.x).toBeCloseTo(before.nw.x, 8);
    expect(objectFrame(result).corners.nw.y).toBeCloseTo(before.nw.y, 8);
  });

  it('uses actual pen bounds and handles reversed-size objects', () => {
    const objects: BoardElement[] = [
      createElement('pen', { x: 400, y: 300, rotation: .8, points: [{ x: 30, y: -20 }, { x: 180, y: 70 }] }),
      createElement('rect', { x: 640, y: 440, w: -240, h: -140, rotation: -.7 }),
    ];
    for (const el of objects) {
      const before = objectFrame(el).corners;
      const target = { x: before.se.x + 80, y: before.se.y + 60 };
      const result = resizeFromCorner(el, 'se', target, false);
      expect(objectFrame(result).corners.se.x).toBeCloseTo(target.x, 7);
      expect(objectFrame(result).corners.se.y).toBeCloseTo(target.y, 7);
      expect(objectFrame(result).corners.nw.x).toBeCloseTo(before.nw.x, 7);
      expect(objectFrame(result).corners.nw.y).toBeCloseTo(before.nw.y, 7);
    }
  });

  it.each([.5, 1, 2, 4])('leaves five screen pixels outside the visible stroke at zoom %s', zoom => {
    const el = createElement('rect', { x: 400, y: 300, w: 240, h: 140, rotation: .6, strokeWidth: 7 });
    const frame = selectionFrame(el, zoom);
    const nw = localPoint(el, frame.corners.nw), se = localPoint(el, frame.corners.se);
    expect((-nw.x - el.strokeWidth / 2) * zoom).toBeCloseTo(5, 8);
    expect((-nw.y - el.strokeWidth / 2) * zoom).toBeCloseTo(5, 8);
    expect((se.x - el.w - el.strokeWidth / 2) * zoom).toBeCloseTo(5, 8);
    expect((se.y - el.h - el.strokeWidth / 2) * zoom).toBeCloseTo(5, 8);
  });

  it.each(['nw', 'ne', 'sw', 'se'] as const)('padded %s handle follows the pointer without moving its opposite anchor', handle => {
    const el = createElement('rect', { x: 400, y: 320, w: 240, h: 140, rotation: .6, strokeWidth: 7 });
    const zoom = 1.6, before = selectionFrame(el, zoom).corners;
    const target = { x: before[handle].x + (handle.includes('w') ? -45 : 45), y: before[handle].y + (handle.includes('n') ? -25 : 25) };
    const result = resizeFromCorner(el, handle, target, false, selectionPadding(el, zoom));
    const after = selectionFrame(result, zoom).corners;
    expect(after[handle].x).toBeCloseTo(target.x, 8);
    expect(after[handle].y).toBeCloseTo(target.y, 8);
    expect(after[opposite[handle]].x).toBeCloseTo(before[opposite[handle]].x, 8);
    expect(after[opposite[handle]].y).toBeCloseTo(before[opposite[handle]].y, 8);
  });

  it('does not jump when a padded corner is clicked without moving', () => {
    const el = createElement('rect', { x: 420, y: 300, w: 180, h: 140, rotation: -.8 });
    const zoom = .75, corner = selectionFrame(el, zoom).corners.se;
    const result = resizeFromCorner(el, 'se', corner, false, selectionPadding(el, zoom));
    expect(result.x).toBeCloseTo(el.x, 8); expect(result.y).toBeCloseTo(el.y, 8);
    expect(result.w).toBeCloseTo(el.w, 8); expect(result.h).toBeCloseTo(el.h, 8);
  });

  it('starts the rotation stem on the expanded top side and keeps its screen length stable', () => {
    const el = createElement('rect', { x: 400, y: 300, w: 200, h: 100, rotation: .4 });
    for (const zoom of [.5, 1, 2]) {
      const { nw, ne } = selectionFrame(el, zoom).corners;
      const { start, handle } = objectRotationHandle(el, zoom);
      expect(start.x).toBeCloseTo((nw.x + ne.x) / 2, 8);
      expect(start.y).toBeCloseTo((nw.y + ne.y) / 2, 8);
      expect(Math.hypot(start.x - handle.x, start.y - handle.y) * zoom).toBeCloseTo(28, 8);
    }
  });

  it('preserves proportions with Shift when dragging an expanded control', () => {
    const el = createElement('rect', { x: 400, y: 300, w: 240, h: 140, rotation: .6 });
    const zoom = .5, before = selectionFrame(el, zoom).corners;
    const next = resizeFromCorner(el, 'nw', { x: before.nw.x - 100, y: before.nw.y - 50 }, true, selectionPadding(el, zoom));
    expect(next.w / next.h).toBeCloseTo(el.w / el.h, 8);
    expect(selectionFrame(next, zoom).corners.se.x).toBeCloseTo(before.se.x, 8);
    expect(selectionFrame(next, zoom).corners.se.y).toBeCloseTo(before.se.y, 8);
  });

  it('keeps the padded frame attached to rotated pen and negative-size geometry', () => {
    const elements = [
      createElement('pen', { x: 400, y: 300, rotation: .8, points: [{ x: 30, y: -20 }, { x: 180, y: 70 }] }),
      createElement('rect', { x: 640, y: 440, w: -240, h: -140, rotation: -.7 }),
    ];
    for (const el of elements) {
      const zoom = 2, before = selectionFrame(el, zoom).corners;
      const target = { x: before.se.x + 80, y: before.se.y + 60 };
      const next = resizeFromCorner(el, 'se', target, false, selectionPadding(el, zoom));
      const after = selectionFrame(next, zoom).corners;
      expect(after.se.x).toBeCloseTo(target.x, 8); expect(after.se.y).toBeCloseTo(target.y, 8);
      expect(after.nw.x).toBeCloseTo(before.nw.x, 8); expect(after.nw.y).toBeCloseTo(before.nw.y, 8);
    }
  });
});
