import { expect, it } from 'vitest';
import { createElement } from '../../src/core/model';
import { Scene } from '../../src/core/scene';

it('removes the original when only a different fragment survives, including a late result after undo', () => {
  for (const late of [false, true]) {
    const original = createElement('line', { w: 200, h: 0 }), source = { ...original, erasures: [{ points: [{ x: 10, y: 0 }], radiusX: 20, radiusY: 20 }] };
    const survivor = createElement('line', { x: 100, w: 100, h: 0 });
    const scene = new Scene([original]), transaction = scene.apply([{ id: original.id, after: source }])!;
    if (late) scene.undo();
    scene.refine(transaction, [{ source, parts: [survivor] }]);
    if (late) { expect(scene.elements).toEqual([original]); scene.redo(); }
    expect(scene.elements).toEqual([survivor]); expect(scene.get(original.id)).toBeUndefined();
    scene.undo(); expect(scene.elements).toEqual([original]);
    scene.redo(); expect(scene.elements).toEqual([survivor]);
  }
});
