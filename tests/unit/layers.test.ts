import { describe, expect, it } from 'vitest';
import { compareElements, createElement, type BoardElement } from '../../src/core/model';
import { layerChanges, type LayerAction } from '../../src/core/layers';
import { Scene } from '../../src/core/scene';

const objects = () => ['a', 'b', 'c', 'd', 'e'].map((id, order) => createElement('rect', { id, order, x: order * 100, w: 80, h: 80 }));
function moved(elements: BoardElement[], selected: string[], action: LayerAction): string[] {
  const scene = new Scene(elements); scene.apply(layerChanges(elements, new Set(selected), action)); return scene.elements.map(el => el.id);
}

describe('stable layer actions', () => {
  it('moves one object exactly one adjacent slot in both directions', () => {
    expect(moved(objects(), ['c'], 'forward')).toEqual(['a', 'b', 'd', 'c', 'e']);
    expect(moved(objects(), ['c'], 'backward')).toEqual(['a', 'c', 'b', 'd', 'e']);
  });

  it('moves selected runs together while preserving their relative order', () => {
    expect(moved(objects(), ['c', 'b'], 'forward')).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(moved(objects(), ['c', 'b'], 'backward')).toEqual(['b', 'c', 'a', 'd', 'e']);
    expect(moved(objects(), ['d', 'b'], 'forward')).toEqual(['a', 'c', 'b', 'e', 'd']);
    expect(moved(objects(), ['d', 'b'], 'backward')).toEqual(['b', 'a', 'd', 'c', 'e']);
    expect(moved(objects(), ['e', 'd'], 'forward')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('sends selection to an end without changing either selected or unselected relative order', () => {
    expect(moved(objects(), ['d', 'b'], 'front')).toEqual(['a', 'c', 'e', 'b', 'd']);
    expect(moved(objects(), ['d', 'b'], 'back')).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('does not create history for boundary/no-selection actions and ignores locked selected objects', () => {
    for (const [selection, action] of [[['a'], 'back'], [['a'], 'backward'], [['e'], 'front'], [['e'], 'forward'], [[], 'front']] as const) {
      expect(layerChanges(objects(), new Set(selection), action)).toEqual([]);
    }
    const elements = objects(); elements[2] = { ...elements[2], locked: true };
    expect(layerChanges(elements, new Set(['c']), 'front')).toEqual([]);
    expect(moved(elements, ['b', 'c'], 'forward')).toEqual(['a', 'c', 'b', 'd', 'e']);
  });

  it('handles split order paths and large timestamps without fractional rank precision loss', () => {
    const elements = objects().map((el, i) => ({ ...el, order: 1792000000000000, orderPath: [i] }));
    const before = structuredClone(elements);
    const changes = layerChanges(elements, new Set(['b', 'c']), 'forward');
    const scene = new Scene(elements); scene.apply(changes, '上移一层');
    expect(scene.elements.map(el => el.id)).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(scene.elements.every((el, i, list) => !i || compareElements(list[i - 1], el) < 0)).toBe(true);
    expect(new Set(changes.map(c => c.id)).size).toBe(changes.length);
    expect(elements).toEqual(before);
    scene.undo(); expect(scene.elements).toEqual(before);
    scene.redo(); expect(scene.elements.map(el => el.id)).toEqual(['a', 'd', 'b', 'c', 'e']);
  });

  it('normalizes duplicate legacy order ranks only when an actual move needs unique slots', () => {
    const elements = objects().map(el => ({ ...el, order: 10 }));
    expect(moved(elements, ['a'], 'forward')).toEqual(['b', 'a', 'c', 'd', 'e']);
    expect(layerChanges(elements, new Set(['e']), 'front')).toEqual([]);
  });

  it('uses the complete lexicographic split rank and returns only the reordered exact slots', () => {
    const elements = objects().map((el, i) => ({ ...el, order: 1792000000000000, orderPath: [[0, 0], [0, 1], [0, 2], [1], [2]][i] }));
    const shuffled = [elements[3], elements[2], elements[0], elements[4], elements[1]];
    const changes = layerChanges(shuffled, new Set(['b']), 'forward');
    expect(changes.map(change => change.id).sort()).toEqual(['b', 'c']);
    expect(changes.find(change => change.id === 'b')!.after!.orderPath).toEqual([0, 2]);
    expect(changes.find(change => change.id === 'c')!.after!.orderPath).toEqual([0, 1]);
    expect(moved(shuffled, ['b'], 'forward')).toEqual(['a', 'c', 'b', 'd', 'e']);
  });
});
