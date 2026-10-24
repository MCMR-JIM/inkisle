import { describe, expect, it } from 'vitest';
import { createDocument, createElement } from '../../src/core/model';
import { alignmentChanges, cloneGroupPaths, groupChanges, selectionUnits, ungroupChanges } from '../../src/core/groups';
import { Scene } from '../../src/core/scene';
import { decodeDocument, encodeDocument } from '../../src/core/codec';
import { layerChanges } from '../../src/core/layers';

const rect = (id: string, x: number, y = 0) => createElement('rect', { id, x, y, w: 40, h: 30, strokeWidth: 0 });

describe('nested groups', () => {
  it('groups groups, edits children and ungroups one level without changing geometry', () => {
    const scene = new Scene([rect('a', 10), rect('b', 100), rect('c', 220)]);
    scene.apply(groupChanges(scene.elements, new Set(['a', 'b'])));
    const inner = scene.get('a')!.groupPath![0];
    scene.apply(groupChanges(scene.elements, new Set(['a', 'b', 'c'])));
    const outer = scene.get('a')!.groupPath![0];
    expect(scene.get('a')!.groupPath).toEqual([outer, inner]);
    expect(selectionUnits(scene.elements)).toHaveLength(1);
    expect(selectionUnits(scene.elements, [outer])).toHaveLength(2);
    scene.apply([{ id: 'a', after: { ...scene.get('a')!, rotation: .4 } }]);
    scene.apply(ungroupChanges(scene.elements, new Set(['a', 'b', 'c'])));
    expect(scene.get('a')!.groupPath).toEqual([inner]);
    expect(scene.get('c')!.groupPath).toBeUndefined();
    expect(scene.get('a')!.rotation).toBe(.4);
    scene.undo(); expect(scene.get('a')!.groupPath).toEqual([outer, inner]);
    scene.redo(); expect(scene.get('a')!.groupPath).toEqual([inner]);
  });

  it('does not group a partial or locked selection', () => {
    const a = { ...rect('a', 0), groupPath: ['g'] }, b = { ...rect('b', 100), groupPath: ['g'] };
    expect(groupChanges([a, b, rect('c', 200)], new Set(['a', 'c']))).toEqual([]);
    expect(groupChanges([a, { ...b, locked: true }, rect('c', 200)], new Set(['a', 'b', 'c']))).toEqual([]);
  });

  it('creates independent nested identities for duplicate and paste into a group', () => {
    const input = [{ ...rect('a', 0), groupPath: ['outer', 'inner'] }, { ...rect('b', 100), groupPath: ['outer', 'inner'] }];
    const copy = cloneGroupPaths(input, ['target'], 1);
    expect(copy[0].groupPath![0]).toBe('target');
    expect(copy[0].groupPath![1]).not.toBe('inner');
    expect(copy[1].groupPath).toEqual(copy[0].groupPath);
    expect(cloneGroupPaths(input)[0].groupPath![0]).not.toBe('outer');
  });

  it('makes a nonconsecutive group contiguous and reorders it as a single sibling', () => {
    const scene = new Scene(['a', 'b', 'c', 'd'].map((id, order) => ({ ...rect(id, order * 100), order })));
    scene.apply(groupChanges(scene.elements, new Set(['a', 'c'])));
    expect(scene.elements.map(el => el.id)).toEqual(['b', 'a', 'c', 'd']);
    scene.apply(layerChanges(scene.elements, new Set(['a', 'c']), 'forward'));
    expect(scene.elements.map(el => el.id)).toEqual(['b', 'd', 'a', 'c']);
    const group = scene.get('a')!.groupPath!;
    scene.apply(layerChanges(scene.elements, new Set(['a']), 'forward', group));
    expect(scene.elements.map(el => el.id)).toEqual(['b', 'd', 'c', 'a']);
    scene.undo(); scene.undo(); scene.undo();
    expect(scene.elements.map(el => el.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(scene.get('a')!.groupPath).toBeUndefined();
  });

  it('round-trips ancestry and rejects cycles, inconsistent parents and excessive depth', () => {
    const doc = createDocument(); doc.elements = [{ ...rect('a', 0), groupPath: ['outer', 'inner'] }];
    expect(decodeDocument(encodeDocument(doc)).elements[0].groupPath).toEqual(['outer', 'inner']);
    for (const path of [['g', 'g'], Array.from({ length: 33 }, (_, i) => `${i}`), ['']]) {
      expect(() => encodeDocument({ ...doc, elements: [{ ...rect('a', 0), groupPath: path }] })).toThrow();
    }
    expect(() => encodeDocument({ ...doc, elements: [...doc.elements, { ...rect('b', 0), groupPath: ['inner'] }] })).toThrow();
  });
});

describe('alignment and spacing', () => {
  it('aligns whole groups and preserves their child spacing and locked objects', () => {
    const a = { ...rect('a', 20, 20), groupPath: ['g'] }, b = { ...rect('b', 90, 40), groupPath: ['g'] };
    const scene = new Scene([a, b, rect('c', 250, 150), { ...rect('locked', 400, 300), locked: true }]);
    scene.apply(alignmentChanges(scene.elements, new Set(['a', 'b', 'c', 'locked']), 'bottom'));
    expect(scene.get('b')!.y - scene.get('a')!.y).toBe(20);
    expect(scene.get('b')!.y).toBe(150);
    expect(scene.get('locked')!.y).toBe(300);
  });

  it('distributes gaps while keeping the first and last units anchored', () => {
    const scene = new Scene([rect('a', 0), rect('b', 70), rect('c', 300)]);
    scene.apply(alignmentChanges(scene.elements, new Set(['a', 'b', 'c']), 'horizontal'));
    expect(scene.get('a')!.x).toBe(0); expect(scene.get('b')!.x).toBe(150); expect(scene.get('c')!.x).toBe(300);
    scene.undo(); expect(scene.get('b')!.x).toBe(70);
  });
});
