import { compareElements, type BoardElement, type Bounds, type Change } from './model';
import { unionBounds } from './geometry';
import { rankChanges } from './ranks';

export interface SelectionUnit { id: string; group: boolean; elements: BoardElement[]; bounds: Bounds }
export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'horizontal' | 'vertical';

export function inScope(element: BoardElement, scope: string[]): boolean {
  return scope.every((id, i) => element.groupPath?.[i] === id);
}

/** A group is a selection unit; its children remain ordinary, independently editable elements. */
export function selectionUnits(elements: BoardElement[], scope: string[] = []): SelectionUnit[] {
  const units = new Map<string, SelectionUnit>();
  for (const element of elements) {
    if (!inScope(element, scope)) continue;
    const group = element.groupPath?.[scope.length];
    const key = group ? `group:${group}` : `element:${element.id}`;
    let unit = units.get(key);
    if (!unit) { unit = { id: group ?? element.id, group: !!group, elements: [], bounds: element }; units.set(key, unit); }
    unit.elements.push(element);
  }
  for (const unit of units.values()) unit.bounds = unionBounds(unit.elements)!;
  return [...units.values()];
}

export function selectedUnits(elements: BoardElement[], selected: Set<string>, scope: string[] = []): SelectionUnit[] {
  return selectionUnits(elements, scope).filter(unit => unit.elements.some(el => selected.has(el.id)));
}

export function groupChanges(elements: BoardElement[], selected: Set<string>, scope: string[] = []): Change[] {
  const units = selectedUnits(elements, selected, scope);
  if (units.length < 2 || units.some(unit => unit.elements.some(el => el.locked || !selected.has(el.id)))) return [];
  if (units.some(unit => unit.elements.some(el => (el.groupPath?.length ?? 0) >= 32))) return [];
  const id = crypto.randomUUID();
  const changes: Change[] = units.flatMap(unit => unit.elements.map(el => ({ id: el.id, after: { ...el, groupPath: [...scope, id, ...(el.groupPath?.slice(scope.length) ?? [])] } })));
  const ordered = elements.slice().sort(compareElements), ids = new Set(changes.map(change => change.id));
  const last = ordered.reduce((last, el, index) => ids.has(el.id) ? index : last, -1);
  const target = [...ordered.slice(0, last + 1).filter(el => !ids.has(el.id)), ...ordered.filter(el => ids.has(el.id)), ...ordered.slice(last + 1)];
  const merged = new Map(changes.map(change => [change.id, change]));
  for (const change of rankChanges(ordered, target)) merged.set(change.id, { id: change.id, after: { ...(merged.get(change.id)?.after ?? change.after!), order: change.after!.order, orderPath: change.after!.orderPath } });
  return [...merged.values()];
}

export function ungroupChanges(elements: BoardElement[], selected: Set<string>, scope: string[] = []): Change[] {
  return selectedUnits(elements, selected, scope).filter(unit => unit.group && !unit.elements.some(el => el.locked)).flatMap(unit => unit.elements.map(el => {
    const path = [...scope, ...el.groupPath!.slice(scope.length + 1)];
    return { id: el.id, after: { ...el, groupPath: path.length ? path : undefined } };
  }));
}

/** Fresh group IDs prevent a copied group from joining the original or another paste. */
export function cloneGroupPaths(elements: BoardElement[], scope: string[] = [], sourceDepth = 0): BoardElement[] {
  const groups = new Map<string, string>();
  return elements.map(el => {
    const path = [...scope, ...(el.groupPath?.slice(sourceDepth) ?? []).map(id => {
      if (!groups.has(id)) groups.set(id, crypto.randomUUID());
      return groups.get(id)!;
    })];
    return { ...el, groupPath: path.length ? path : undefined };
  });
}

export function alignmentChanges(elements: BoardElement[], selected: Set<string>, action: Alignment, scope: string[] = []): Change[] {
  const units = selectedUnits(elements, selected, scope).filter(unit => !unit.elements.some(el => el.locked));
  const distribute = action === 'horizontal' || action === 'vertical';
  if (units.length < (distribute ? 3 : 2)) return [];
  const all = unionBounds(units.flatMap(unit => unit.elements))!;
  let position = 0, gap = 0;
  const horizontal = action === 'horizontal';
  if (distribute) {
    units.sort((a, b) => horizontal ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y);
    position = horizontal ? units[0].bounds.x : units[0].bounds.y;
    const end = units.at(-1)!.bounds;
    const length = (horizontal ? end.x + end.w : end.y + end.h) - position;
    gap = (length - units.reduce((sum, unit) => sum + (horizontal ? unit.bounds.w : unit.bounds.h), 0)) / (units.length - 1);
  }
  return units.flatMap(unit => {
    const b = unit.bounds;
    const dx = action === 'left' ? all.x - b.x : action === 'center' ? all.x + all.w / 2 - b.x - b.w / 2 : action === 'right' ? all.x + all.w - b.x - b.w : horizontal ? position - b.x : 0;
    const dy = action === 'top' ? all.y - b.y : action === 'middle' ? all.y + all.h / 2 - b.y - b.h / 2 : action === 'bottom' ? all.y + all.h - b.y - b.h : action === 'vertical' ? position - b.y : 0;
    if (distribute) position += (horizontal ? b.w : b.h) + gap;
    return Math.abs(dx) + Math.abs(dy) < 1e-8 ? [] : unit.elements.map(el => ({ id: el.id, after: { ...el, x: el.x + dx, y: el.y + dy } }));
  });
}
