import { describe, expect, it } from 'vitest';
import { createDocument, createElement } from '../../src/core/model';
import { createPaper, paperAssignments, paperPositions, rotatePaperChanges } from '../../src/core/paper';
import { elementBounds, intersects } from '../../src/core/geometry';
import { worldPoint, rotationCenter, rotatePoint } from '../../src/core/transforms';
import { encodeDocument, decodeDocument } from '../../src/core/codec';
import { Scene } from '../../src/core/scene';

describe('paper orientation', () => {
  it('rotates a sheet and its nested annotations together and restores them with undo', () => {
    const pages = paperPositions([createPaper(0, 0, 'a'.repeat(64), 1), createPaper()], 'double', { x: 0, y: 0 });
    const page = pages[0], ink = createElement('pen', { x: page.x + 40, y: page.y + 50, w: 90, h: 70, rotation: .2, points: [{ x: 0, y: 0 }, { x: 90, y: 70 }], groupPath: ['outer', 'inner'] });
    const scene = new Scene([...pages, ink]); scene.apply(rotatePaperChanges(scene.elements, page.id, 1, 'double'), 'Rotate');
    const turned = scene.get(page.id)!, moved = scene.get(ink.id)!;
    expect([turned.w, turned.h, turned.paper!.sourceRotation]).toEqual([page.h, page.w, 90]);
    const before = worldPoint(ink, ink.points[1]), expected = rotatePoint(before, rotationCenter(page), Math.PI / 2);
    expected.x += rotationCenter(turned).x - rotationCenter(page).x; expected.y += rotationCenter(turned).y - rotationCenter(page).y;
    expect(worldPoint(moved, moved.points[1]).x).toBeCloseTo(expected.x); expect(worldPoint(moved, moved.points[1]).y).toBeCloseTo(expected.y);
    expect(moved.groupPath).toEqual(ink.groupPath); expect(moved.points).toEqual(ink.points);
    expect(paperAssignments(scene.elements).overflow).toHaveLength(0);
    expect(intersects(elementBounds(turned), elementBounds(scene.get(pages[1].id)!))).toBe(false);
    scene.undo(); expect(scene.elements).toEqual([...pages, ink]); scene.redo(); expect(scene.get(page.id)!.paper!.sourceRotation).toBe(90);
  });

  it('wraps rotation and preserves non-overlapping continuous frames in either layout', () => {
    for (const layout of ['single', 'double'] as const) {
      const pages = paperPositions(Array.from({ length: 5 }, () => createPaper(0, 0, 'a'.repeat(64), 1)), layout, { x: -500, y: -900 });
      const scene = new Scene(pages);
      for (let turn = 0; turn < 4; turn++) {
        scene.apply(rotatePaperChanges(scene.elements, pages[0].id, -1, layout), 'Rotate');
        for (let i = 0; i < scene.elements.length; i++) for (let j = i + 1; j < scene.elements.length; j++) expect(intersects(elementBounds(scene.elements[i]), elementBounds(scene.elements[j]))).toBe(false);
      }
      expect(scene.get(pages[0].id)!.w).toBe(pages[0].w); expect(scene.get(pages[0].id)!.paper!.sourceRotation).toBe(0);
    }
  });

  it('rejects ambiguous overflow ownership and invalid persisted orientations', () => {
    const page = createPaper(0, 0, 'a'.repeat(64), 1), outside = createElement('rect', { x: -1000, y: -1000, w: 20, h: 20 });
    expect(() => rotatePaperChanges([page, outside], page.id, 1, 'single')).toThrow(/超出/);
    const doc = createDocument(); doc.elements = [page];
    for (const rotation of [0, 90, 180, 270]) { page.paper!.sourceRotation = rotation; expect(decodeDocument(encodeDocument(doc))).toEqual(doc); }
    for (const rotation of [-90, 45, 360, NaN]) { page.paper!.sourceRotation = rotation; expect(() => encodeDocument(doc)).toThrow(); }
  });
});
