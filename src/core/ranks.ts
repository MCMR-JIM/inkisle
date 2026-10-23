import { compareElements, type BoardElement, type Change } from './model';

/** Permute exact ranks; normalize legacy duplicates only when order changes. */
export function rankChanges(ordered: BoardElement[], target: BoardElement[]): Change[] {
  if (target.every((el, index) => el.id === ordered[index]?.id)) return [];
  const unique = ordered.every((el, index) => !index || compareElements(ordered[index - 1], el) < 0);
  return target.flatMap((el, index) => {
    const slot = ordered[index];
    if (unique && compareElements(el, slot) === 0) return [];
    return [{ id: el.id, after: { ...el, order: unique ? slot.order : index, orderPath: unique ? slot.orderPath : undefined } }];
  });
}
