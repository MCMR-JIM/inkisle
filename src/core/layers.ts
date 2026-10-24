import { compareElements, type BoardElement, type Change } from './model';
import { selectionUnits, inScope } from './groups';
import { rankChanges } from './ranks';

export type LayerAction = 'forward' | 'backward' | 'front' | 'back';

/** Produce one order transaction for a selected run, preserving relative order. */
export function layerChanges(elements: BoardElement[], selected: Set<string>, action: LayerAction, scope: string[] = []): Change[] {
  const ordered = elements.slice().sort(compareElements);
  if (ordered.some(el => el.groupPath?.length)) {
    const units = selectionUnits(ordered, scope).map(unit => ({ ...unit, id: `${unit.group ? 'group' : 'element'}:${unit.id}` }));
    const ids = new Set(units.filter(unit => unit.elements.some(el => selected.has(el.id)) && !unit.elements.some(el => el.locked)).map(unit => unit.id));
    if (!ids.size) return [];
    const chosen = units.filter(unit => ids.has(unit.id));
    const target = action === 'front' ? [...units.filter(unit => !ids.has(unit.id)), ...chosen]
      : action === 'back' ? [...chosen, ...units.filter(unit => !ids.has(unit.id))] : step(units, ids, action === 'forward' ? 1 : -1);
    if (target.every((unit, i) => unit.id === units[i].id)) return [];
    const scoped = target.flatMap(unit => unit.elements);
    let index = 0;
    return rankChanges(ordered, ordered.map(el => inScope(el, scope) ? scoped[index++] : el));
  }
  const chosen = ordered.filter(el => selected.has(el.id) && !el.locked);
  if (!chosen.length) return [];
  const ids = new Set(chosen.map(el => el.id));
  const target = action === 'front' ? [...ordered.filter(el => !ids.has(el.id)), ...chosen]
    : action === 'back' ? [...chosen, ...ordered.filter(el => !ids.has(el.id))]
    : step(ordered, ids, action === 'forward' ? 1 : -1);
  return rankChanges(ordered, target);
}

function step<T extends { id: string }>(items: T[], selected: Set<string>, direction: 1 | -1): T[] {
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
