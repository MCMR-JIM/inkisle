import { describe, expect, it } from 'vitest';
import { createDocument, createElement } from '../../src/core/model';
import { hitTest } from '../../src/core/geometry';
import { eraseAt, scaleErasures } from '../../src/core/erasure';
import { Scene } from '../../src/core/scene';
import { decodeDocument, encodeDocument } from '../../src/core/codec';

describe('local erasure masks', () => {
  it('cuts only the touched area, retains the object and lets hits pass through the hole', () => {
    const el = createElement('rect', { x: 100, y: 200, w: 200, h: 100, fill: '#e6eee5' });
    const erased = eraseAt(el, [{ x: 160, y: 180 }, { x: 160, y: 320 }], 12)!;
    expect(erased.id).toBe(el.id);
    expect(hitTest(erased, { x: 160, y: 250 }, 0)).toBe(false);
    expect(hitTest(erased, { x: 200, y: 250 }, 0)).toBe(true);
    expect(el.erasures).toBeUndefined();
  });

  it('sweeps continuously between sparse input samples and respects locked objects', () => {
    const el = createElement('line', { x: 100, y: 200, w: 200, h: 0 });
    const erased = eraseAt(el, [{ x: 200, y: 100 }, { x: 200, y: 300 }], 10)!;
    expect(hitTest(erased, { x: 200, y: 200 }, 0)).toBe(false);
    expect(hitTest(erased, { x: 140, y: 200 }, 0)).toBe(true);
    expect(eraseAt({ ...el, locked: true }, [{ x: 200, y: 200 }], 10)).toBeNull();
    expect(eraseAt(el, [{ x: 900, y: 900 }], 10)).toBeNull();
  });

  it('stores local coordinates and scales holes with the object in each axis', () => {
    const el = createElement('rect', { x: 100, y: 200, w: 200, h: 100, fill: '#e6eee5' });
    const erased = eraseAt(el, [{ x: 150, y: 240 }], 10)!;
    const moved = { ...erased, x: 400, y: 500 };
    expect(hitTest(moved, { x: 450, y: 540 }, 0)).toBe(false);
    const resized = { ...moved, w: 400, h: 50, erasures: scaleErasures(moved.erasures, 2, .5) };
    expect(hitTest(resized, { x: 500, y: 520 }, 0)).toBe(false);
    expect(hitTest(resized, { x: 500, y: 530 }, 0)).toBe(true);
  });

  it('restores one eraser gesture with undo and preserves masks in source files', () => {
    const el = createElement('note', { x: 0, y: 0, w: 200, h: 100 });
    const erased = eraseAt(el, [{ x: 100, y: 50 }], 12)!;
    const scene = new Scene([el]);
    scene.apply([{ id: el.id, after: erased }], '局部擦除');
    scene.undo(); expect(scene.get(el.id)?.erasures).toBeUndefined();
    scene.redo(); expect(hitTest(scene.get(el.id)!, { x: 100, y: 50 }, 0)).toBe(false);
    const doc = createDocument(); doc.elements = scene.elements;
    expect(decodeDocument(encodeDocument(doc)).elements[0].erasures).toEqual(erased.erasures);
    doc.elements[0] = { ...erased, erasures: [{ points: [{ x: 0, y: 0 }], radiusX: -1, radiusY: 10 }] };
    expect(() => encodeDocument(doc)).toThrow(/格式/);
  });
});
