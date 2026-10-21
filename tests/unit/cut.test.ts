import { describe, expect, it } from 'vitest';
import { compareElements, createDocument, createElement, type BoardElement, type Point } from '../../src/core/model';
import { eraseAt } from '../../src/core/erasure';
import { cutElement } from '../../src/core/cut';
import { elementBounds, hitTest } from '../../src/core/geometry';
import { decodeDocument, encodeDocument } from '../../src/core/codec';
import { worldPoint } from '../../src/core/transforms';

function cut(el: BoardElement, points: Point[], radius = 10): BoardElement[] {
  return cutElement(eraseAt(el, points, radius)!, .15);
}

describe('line and outline geometry cutting', () => {
  it('opens an unfilled rectangle after erasing one edge, then splits after a second disconnected gap', () => {
    const rect = createElement('rect', { x: 100, y: 200, w: 200, h: 100 });
    const first = cut(rect, [{ x: 200, y: 185 }, { x: 200, y: 215 }]);
    expect(first).toHaveLength(1); expect(first[0].kind).toBe('path');
    expect(first[0].path!.strokes).toHaveLength(1);
    expect(first[0].path!.strokes[0].closed).toBe(false);
    const second = cut(first[0], [{ x: 200, y: 285 }, { x: 200, y: 315 }]);
    expect(second).toHaveLength(2);
    expect(second.every(el => el.kind === 'path' && el.path!.strokes.every(stroke => !stroke.closed))).toBe(true);
  });

  it.each([.4, Math.PI / 2, -.7])('cuts rotated unfilled rectangle borders at their actual visible positions (%s)', rotation => {
    const rect = createElement('rect', { x: 300, y: 200, w: 240, h: 160, rotation });
    const sweep = [{ x: 120, y: -30 }, { x: 120, y: 190 }].map(p => worldPoint(rect, p));
    const erased = eraseAt(rect, sweep, 10)!;
    const hole = worldPoint(rect, { x: 120, y: 0 });
    expect(hitTest(erased, hole, 0)).toBe(false);
    const parts = cutElement(erased);
    expect(parts).toHaveLength(2);
    for (const point of [{ x: 0, y: 80 }, { x: 240, y: 80 }, { x: 35, y: 0 }, { x: 205, y: 160 }]) {
      expect(parts.filter(part => hitTest(part, worldPoint(rect, point), 0))).toHaveLength(1);
    }
    for (const point of [{ x: 120, y: 0 }, { x: 120, y: 160 }]) {
      expect(parts.some(part => hitTest(part, worldPoint(rect, point), 0))).toBe(false);
    }
  });

  it('splits a rotated filled rectangle without shifting its fragments', () => {
    const rect = createElement('rect', { x: 300, y: 200, w: 240, h: 160, rotation: .6, fill: '#e6eee5' });
    const parts = cut(rect, [{ x: 120, y: -30 }, { x: 120, y: 190 }].map(p => worldPoint(rect, p)));
    expect(parts).toHaveLength(2);
    expect(parts.some(part => hitTest(part, worldPoint(rect, { x: 120, y: 80 }), 0))).toBe(false);
    for (const point of [{ x: 50, y: 80 }, { x: 190, y: 80 }]) expect(parts.filter(part => hitTest(part, worldPoint(rect, point), 0))).toHaveLength(1);
  });

  it('keeps rotated negative-size outline fragments in place and allows repeated erasure', () => {
    const rect = createElement('rect', { x: 540, y: 360, w: -240, h: -160, rotation: -.5 });
    const first = cut(rect, [{ x: -120, y: -180 }, { x: -120, y: -140 }].map(p => worldPoint(rect, p)));
    expect(first).toHaveLength(1); expect(first[0].kind).toBe('path');
    const next = cut(first[0], [{ x: -120, y: -20 }, { x: -120, y: 20 }].map(p => worldPoint(rect, p)));
    expect(next).toHaveLength(2);
    for (const point of [{ x: -240, y: -80 }, { x: 0, y: -80 }]) {
      expect(next.filter(part => hitTest(part, worldPoint(rect, point), 0))).toHaveLength(1);
    }
    expect(next.some(part => hitTest(part, worldPoint(rect, { x: -120, y: 0 }), 0))).toBe(false);
  });
  it('splits a line into two independently bounded objects at analytic intersection points', () => {
    const el = createElement('line', { x: 100, y: 200, w: 200, h: 0 });
    const parts = cut(el, [{ x: 200, y: 180 }, { x: 200, y: 220 }]);
    expect(parts).toHaveLength(2);
    expect(new Set(parts.map(p => p.id)).size).toBe(2);
    expect(elementBounds(parts[0]).x + elementBounds(parts[0]).w).toBeLessThanOrEqual(191.2);
    expect(elementBounds(parts[1]).x).toBeGreaterThanOrEqual(208.8);
    expect(parts.some(p => hitTest(p, { x: 200, y: 200 }, 0))).toBe(false);
    expect(parts[0].stroke).toBe(el.stroke);
  });

  it('cuts three fragments, removes fully covered lines and keeps negative-direction lines', () => {
    let el = createElement('line', { x: 300, y: 200, w: -200, h: 0 });
    el = eraseAt(el, [{ x: 160, y: 200 }], 10)!;
    el = eraseAt(el, [{ x: 240, y: 200 }], 10)!;
    expect(cutElement(el)).toHaveLength(3);
    expect(cut(createElement('line', { w: 10, h: 0 }), [{ x: 5, y: 0 }], 30)).toHaveLength(0);
  });

  it('turns a cut unfilled rectangle into two open contours rather than two rectangles', () => {
    const el = createElement('rect', { x: 100, y: 200, w: 200, h: 100, radius: 0 });
    const parts = cut(el, [{ x: 200, y: 170 }, { x: 200, y: 330 }]);
    expect(parts).toHaveLength(2);
    expect(parts.every(p => p.kind === 'path' && !p.path?.fills.length)).toBe(true);
    expect(parts.every(p => p.path?.strokes.every(stroke => !stroke.closed))).toBe(true);
    expect(parts.some(p => hitTest(p, { x: 100, y: 250 }, 0))).toBe(true);
    expect(parts.some(p => hitTest(p, { x: 150, y: 250 }, 0))).toBe(false);
  });

  it('cuts the rendered smooth pen path without reconnecting across the hole', () => {
    const pen = createElement('pen', { x: 100, y: 200, points: [{ x: 0, y: 20 }, { x: 70, y: 0 }, { x: 130, y: 60 }, { x: 200, y: 20 }] });
    const parts = cut(pen, [{ x: 200, y: 100 }, { x: 200, y: 400 }]);
    expect(parts).toHaveLength(2);
    expect(parts.every(p => p.kind === 'path' && p.path!.strokes[0].points.length >= 2)).toBe(true);
    expect(parts.some(p => hitTest(p, { x: 200, y: 230 }, 0))).toBe(false);
  });

  it('preserves the existing arrowhead on its tip component only and never invents a new head', () => {
    const arrow = createElement('arrow', { x: 100, y: 200, w: 200, h: 0 });
    const parts = cut(arrow, [{ x: 200, y: 180 }, { x: 200, y: 220 }]);
    expect(parts).toHaveLength(2);
    const left = parts.find(p => elementBounds(p).x < 150)!;
    const right = parts.find(p => elementBounds(p).x > 190)!;
    expect(left.kind).not.toBe('arrow');
    expect(left.path?.strokes).toHaveLength(1);
    expect(right.path!.strokes.length).toBeGreaterThan(1);
    expect(elementBounds(right).x + elementBounds(right).w).toBeCloseTo(301, 1);
  });
});

describe('filled shape difference and topology', () => {
  it('splits a filled rectangle only when the erase corridor crosses it completely', () => {
    const rect = createElement('rect', { x: 100, y: 200, w: 200, h: 100, radius: 0, fill: '#e6eee5' });
    const through = cut(rect, [{ x: 200, y: 180 }, { x: 200, y: 320 }]);
    expect(through).toHaveLength(2);
    expect(through.every(p => p.kind === 'path' && p.path!.fills.length === 1)).toBe(true);
    expect(through.some(p => hitTest(p, { x: 150, y: 250 }, 0))).toBe(true);
    expect(through.some(p => hitTest(p, { x: 250, y: 250 }, 0))).toBe(true);
    expect(through.some(p => hitTest(p, { x: 200, y: 250 }, 0))).toBe(false);
    expect(cut(rect, [{ x: 200, y: 180 }, { x: 200, y: 250 }])).toHaveLength(1);
  });

  it('retains an interior hole inside one object and can later split it again', () => {
    const rect = createElement('rect', { x: 100, y: 200, w: 200, h: 100, fill: '#e6eee5' });
    const [hole] = cut(rect, [{ x: 200, y: 250 }], 15);
    expect(hole.path?.fills).toHaveLength(2);
    expect(hitTest(hole, { x: 200, y: 250 }, 0)).toBe(false);
    expect(hitTest(hole, { x: 160, y: 250 }, 0)).toBe(true);
    expect(cut(hole, [{ x: 200, y: 180 }, { x: 200, y: 320 }])).toHaveLength(2);
  });

  it('keeps a filled shape caption clipped to each fragment at its original layout position', () => {
    const rect = createElement('rect', { x: 100, y: 200, w: 200, h: 100, fill: '#e6eee5', text: '独立片段' });
    const parts = cut(rect, [{ x: 200, y: 180 }, { x: 200, y: 320 }]);
    expect(parts).toHaveLength(2);
    expect(parts.every(part => part.path?.label?.text === '独立片段')).toBe(true);
    for (const part of parts) expect(part.x + part.path!.label!.x).toBeCloseTo(116, 8);
  });

  it('handles overlapping eraser sweeps as a union and creates four connected regions', () => {
    let rect = createElement('rect', { w: 200, h: 200, radius: 0, fill: '#e6eee5' });
    rect = eraseAt(rect, [{ x: 100, y: -20 }, { x: 100, y: 220 }], 10)!;
    rect = eraseAt(rect, [{ x: -20, y: 100 }, { x: 220, y: 100 }], 10)!;
    const parts = cutElement(rect);
    expect(parts).toHaveLength(4);
    for (const p of [{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 50, y: 150 }, { x: 150, y: 150 }]) {
      expect(parts.filter(part => hitTest(part, p, 0))).toHaveLength(1);
    }
    expect(parts.some(part => hitTest(part, { x: 100, y: 100 }, 0))).toBe(false);
  });

  it('cuts ellipses and diamonds, removes completely covered regions and preserves untouched objects', () => {
    for (const kind of ['ellipse', 'diamond'] as const) {
      const shape = createElement(kind, { x: 0, y: 0, w: 200, h: 100, fill: '#e6eee5' });
      expect(cut(shape, [{ x: 100, y: -20 }, { x: 100, y: 120 }])).toHaveLength(2);
      expect(cut(shape, [{ x: 100, y: 50 }], 200)).toHaveLength(0);
      const untouched = eraseAt(shape, [{ x: 1, y: 1 }], 1)!;
      expect(cutElement(untouched)[0].kind).toBe(kind);
    }
  });

  it('round-trips path holes and stroke fragments and rejects malformed path geometry', () => {
    const doc = createDocument();
    doc.elements = cut(createElement('rect', { w: 200, h: 100, fill: '#e6eee5' }), [{ x: 100, y: 50 }]);
    expect(decodeDocument(encodeDocument(doc))).toEqual(doc);
    doc.elements[0] = { ...doc.elements[0], path: { fills: [[{ x: NaN, y: 0 }]], strokes: [] } };
    expect(() => encodeDocument(doc)).toThrow(/格式/);
  });

  it('keeps text, notes and images as editable masked objects', () => {
    for (const kind of ['text', 'note', 'image'] as const) {
      const element = createElement(kind, { w: 200, h: 100, text: '保留原文' });
      const result = cut(element, [{ x: 100, y: -20 }, { x: 100, y: 120 }]);
      expect(result).toHaveLength(1); expect(result[0].kind).toBe(kind);
      expect(result[0].erasures).toBeDefined();
    }
  });

  it('preserves parent layer order exactly across repeated splits at large timestamps', () => {
    const source = createElement('rect', { w: 300, h: 200, fill: '#e6eee5', order: 1792000000000000 });
    const first = cut(source, [{ x: 100, y: -20 }, { x: 100, y: 220 }]);
    const second = cut(first[1], [{ x: 200, y: -20 }, { x: 200, y: 220 }]);
    const above = createElement('rect', { order: source.order + 1 });
    const sorted = [above, second[1], first[0], second[0]].sort(compareElements);
    expect(sorted.map(el => el.id)).toEqual([first[0].id, second[0].id, second[1].id, above.id]);
    expect(sorted.slice(0, 3).every(el => el.order === source.order)).toBe(true);
  });

  it('matches the original material minus arbitrary overlapping sweeps on a deterministic point grid', () => {
    let seed = 137;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
    for (let sample = 0; sample < 24; sample++) {
      let shape = createElement(sample % 2 ? 'ellipse' : 'rect', { w: 200, h: 120, fill: '#e6eee5', strokeWidth: 0, radius: 12 });
      for (let i = 0; i < 5; i++) {
        const start = { x: random() * 240 - 20, y: random() * 160 - 20 };
        shape = eraseAt(shape, [start, { x: random() * 240 - 20, y: random() * 160 - 20 }], 5 + random() * 12) ?? shape;
      }
      const fragments = cutElement(shape, .08);
      for (let x = 6; x < 200; x += 13) for (let y = 7; y < 120; y += 13) {
        const p = { x, y };
        expect(fragments.some(fragment => hitTest(fragment, p, 0)), `sample ${sample}, point ${x},${y}`).toBe(hitTest(shape, p, 0));
      }
    }
  });
});
