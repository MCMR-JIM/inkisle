import { describe, expect, it } from 'vitest';
import { createElement } from '../../src/core/model';
import { containsBounds, elementBounds, hitTest, screenToWorld, simplifyPoints, worldToScreen, zoomAt } from '../../src/core/geometry';
import { SpatialIndex } from '../../src/core/spatial';
import { Scene } from '../../src/core/scene';

describe('geometry', () => {
  it('preserves the world point under the pointer when zooming', () => {
    const camera = { x: 240, y: -100, zoom: 0.8 };
    const pointer = { x: 321, y: 209 };
    const before = screenToWorld(pointer, camera);
    const next = zoomAt(camera, pointer, 2.4);
    expect(screenToWorld(pointer, next)).toEqual(before);
    expect(worldToScreen(before, next)).toEqual(pointer);
  });

  it('normalizes reversed shapes and includes stroke width', () => {
    const shape = createElement('rect', { x: 50, y: 60, w: -100, h: -80, strokeWidth: 4 });
    expect(elementBounds(shape)).toEqual({ x: -52, y: -22, w: 104, h: 84 });
  });

  it('hits the real line rather than its bounding rectangle', () => {
    const line = createElement('line', { x: 0, y: 0, w: 100, h: 100 });
    expect(hitTest(line, { x: 50, y: 52 }, 4)).toBe(true);
    expect(hitTest(line, { x: 10, y: 90 }, 4)).toBe(false);
  });

  it('requires full containment including the outline, accepting reversed marquees and exact edges', () => {
    const shape = createElement('rect', { x: 100, y: 200, w: 200, h: 120, strokeWidth: 4 });
    const bounds = elementBounds(shape);
    expect(containsBounds({ x: 90, y: 190, w: 150, h: 150 }, bounds)).toBe(false);
    expect(containsBounds({ x: 100, y: 200, w: 200, h: 120 }, bounds)).toBe(false);
    expect(containsBounds(bounds, bounds)).toBe(true);
    expect(containsBounds({ x: 310, y: 330, w: -220, h: -140 }, bounds)).toBe(true);
    const rotated = elementBounds({ ...shape, rotation: Math.PI / 4 });
    expect(containsBounds({ x: 99, y: 199, w: 202, h: 122 }, rotated)).toBe(false);
    expect(containsBounds(rotated, rotated)).toBe(true);
    expect(containsBounds({ x: 0, y: 0, w: 100, h: 100 }, { x: 10, y: 50, w: 80, h: 0 })).toBe(true);
    expect(containsBounds({ x: 0, y: 0, w: 100, h: 100 }, { x: 10, y: 50, w: 91, h: 0 })).toBe(false);
  });

  it('simplifies straight pen samples without losing the endpoints', () => {
    const points = Array.from({ length: 100 }, (_, i) => ({ x: i, y: i, pressure: 0.5 }));
    expect(simplifyPoints(points, 0.8)).toEqual([points[0], points[99]]);
  });
});

describe('spatial index', () => {
  it('finds negative-coordinate objects and removes obsolete cells on a move', () => {
    const index = new SpatialIndex(128);
    index.set('a', { x: -260, y: -140, w: 60, h: 40 });
    expect(index.query({ x: -250, y: -150, w: 80, h: 80 })).toEqual(new Set(['a']));
    index.set('a', { x: 800, y: 800, w: 10, h: 10 });
    expect(index.query({ x: -250, y: -150, w: 80, h: 80 }).size).toBe(0);
    expect(index.query({ x: 795, y: 795, w: 20, h: 20 })).toEqual(new Set(['a']));
  });

  it('handles enormous objects without allocating millions of grid cells', () => {
    const index = new SpatialIndex(128);
    index.set('huge', { x: -1e6, y: -1e6, w: 2e6, h: 2e6 });
    expect(index.query({ x: 9000, y: 9000, w: 10, h: 10 })).toEqual(new Set(['huge']));
    index.delete('huge');
    expect(index.query({ x: 0, y: 0, w: 10, h: 10 }).size).toBe(0);
  });
});

describe('scene history', () => {
  it('makes a multi-element change one undoable transaction and clears redo after a new edit', () => {
    const a = createElement('rect', { id: 'a' });
    const b = createElement('note', { id: 'b' });
    const scene = new Scene([a, b]);
    scene.apply([{ id: 'a', after: { ...a, x: 200 } }, { id: 'b', after: null }], '移动并删除');
    expect(scene.get('a')?.x).toBe(200);
    expect(scene.get('b')).toBeUndefined();
    scene.undo();
    expect(scene.get('a')?.x).toBe(a.x);
    expect(scene.elements.map(e => e.id)).toEqual(['a', 'b']);
    scene.redo();
    expect(scene.get('b')).toBeUndefined();
    scene.undo();
    scene.apply([{ id: 'b', after: { ...b, text: '新的想法' } }], '编辑');
    expect(scene.canRedo).toBe(false);
  });

  it('updates its spatial index on undo and emits persistence patches for undo', () => {
    const a = createElement('rect', { id: 'a', x: 0, y: 0, w: 40, h: 40 });
    const scene = new Scene([a]);
    const events: string[] = [];
    scene.subscribe(changes => events.push(changes.map(c => c.id).join(',')));
    scene.apply([{ id: 'a', after: { ...a, x: 1000 } }], '移动');
    expect(scene.query({ x: -5, y: -5, w: 50, h: 50 })).toHaveLength(0);
    scene.undo();
    expect(scene.query({ x: -5, y: -5, w: 50, h: 50 })).toHaveLength(1);
    expect(events).toEqual(['a', 'a']);
  });

  it('folds background splitting into its original gesture without adding a second undo step', () => {
    const original = createElement('line', { id: 'a', w: 200 });
    const scene = new Scene([original]);
    const masked = { ...original, erasures: [{ points: [{ x: 100, y: 0 }], radiusX: 10, radiusY: 10 }] };
    const transaction = scene.apply([{ id: 'a', after: masked }], '擦除')!;
    const a = { ...original, w: 90 }, b = { ...original, id: 'b', x: 110, w: 90 };
    scene.refine(transaction, [{ source: masked, parts: [a, b] }]);
    expect(scene.size).toBe(2);
    scene.undo(); expect(scene.elements).toEqual([original]); expect(scene.canUndo).toBe(false);
    scene.redo(); expect(scene.elements).toEqual([a, b]);
  });

  it('drops stale background results after undo or a later edit instead of resurrecting geometry', () => {
    const original = createElement('line', { id: 'a', w: 200 });
    const scene = new Scene([original]);
    const masked = { ...original, w: 190 };
    const transaction = scene.apply([{ id: 'a', after: masked }], '擦除')!;
    scene.undo();
    scene.refine(transaction, [{ source: masked, parts: [] }]);
    expect(scene.get('a')).toBe(original);
    scene.redo();
    const moved = { ...masked, y: 100 }; scene.apply([{ id: 'a', after: moved }], '移动');
    scene.refine(transaction, [{ source: masked, parts: [] }]);
    expect(scene.get('a')).toBe(moved);
  });

  it('can finish background geometry while undone and uses the finished fragments on redo', () => {
    const original = createElement('line', { id: 'a', w: 200 });
    const scene = new Scene([original]);
    const masked = { ...original, w: 190 };
    const transaction = scene.apply([{ id: 'a', after: masked }], '擦除')!;
    scene.undo();
    const parts = [{ ...original, w: 90 }, { ...original, id: 'b', x: 110, w: 90 }];
    scene.refine(transaction, [{ source: masked, parts }]);
    expect(scene.elements).toEqual([original]);
    scene.redo(); expect(scene.elements).toEqual(parts);
    scene.undo(); expect(scene.elements).toEqual([original]);
  });
});
