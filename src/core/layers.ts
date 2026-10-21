import { compareElements, type BoardElement, type Change } from './model';

export type LayerAction = 'forward' | 'backward' | 'front' | 'back';

/** Produce one order transaction for a selected run, preserving relative order. */
export function layerChanges(elements: BoardElement[], selected: Set<string>, action: LayerAction): Change[] {
  const ordered = elements.slice().sort(compareElements);
  const chosen = ordered.filter(el => selected.has(el.id) && !el.locked);
  if (!chosen.length) return [];
  const ids = new Set(chosen.map(el => el.id));
  const target = action === 'front' ? [...ordered.filter(el => !ids.has(el.id)), ...chosen]
    : action === 'back' ? [...chosen, ...ordered.filter(el => !ids.has(el.id))]
    : step(ordered, ids, action === 'forward' ? 1 : -1);
  if (target.every((el, index) => el.id === ordered[index]?.id)) return [];
  const unique = ordered.every((el, index) => !index || compareElements(ordered[index - 1], el) < 0);
  return target.flatMap((el, index) => {
    const slot = ordered[index];
    if (unique && compareElements(el, slot) === 0) return [];
    // Permute existing exact ranks, including split paths. Legacy duplicate
    // ranks are normalized only when a real reorder needs distinct positions.
    return [{ id: el.id, after: { ...el, order: unique ? slot.order : index, orderPath: unique ? slot.orderPath : undefined } }];
  });
}

function step(items: BoardElement[], selected: Set<string>, direction: 1 | -1): BoardElement[] {
  const result = items.slice();
  if (direction > 0) for (let i = result.length - 2; i >= 0; i--) {
    if (!selected.has(result[i].id) || selected.has(result[i + 1].id)) continue;
    [result[i], result[i + 1]] = [result[i + 1], result[i]];
  }
  if (direction < 0) for (let i = 1; i < result.length; i++) {
    if (!selected.has(result[i].id) || selected.has(result[i - 1].id)) continue;
    [result[i], result[i - 1]] = [result[i - 1], result[i]];
  }
  return result;
}
