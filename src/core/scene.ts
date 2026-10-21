import { compareElements, type BoardElement, type Bounds, type Change } from './model';
import { elementBounds } from './geometry';
import { SpatialIndex } from './spatial';

export interface Transaction { before: Change[]; after: Change[]; label: string }
type Listener = (changes: Change[], label: string) => void;

export class Scene {
  private items = new Map<string, BoardElement>();
  private index = new SpatialIndex();
  private listeners = new Set<Listener>();
  private past: Transaction[] = [];
  private future: Transaction[] = [];
  private sorted: BoardElement[] | null = null;
  revision = 0;

  constructor(elements: BoardElement[] = []) {
    for (const el of elements) {
      this.items.set(el.id, el);
      this.index.set(el.id, elementBounds(el));
    }
  }

  get size(): number { return this.items.size; }
  get elements(): BoardElement[] {
    return this.sorted ??= [...this.items.values()].sort(compareElements);
  }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get(id: string): BoardElement | undefined { return this.items.get(id); }

  query(bounds: Bounds): BoardElement[] {
    return [...this.index.query(bounds)].map(id => this.items.get(id)!).sort(compareElements);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  apply(changes: Change[], label = '编辑'): Transaction | undefined {
    if (!changes.length) return;
    const before = changes.map(c => ({ id: c.id, after: this.items.get(c.id) ?? null }));
    const transaction = { before, after: changes, label };
    this.past.push(transaction);
    if (this.past.length > 120) this.past.shift();
    this.future = [];
    this.write(changes, label);
    return transaction;
  }

  /** Fold asynchronous geometry back into its original gesture, never a later edit. */
  refine(transaction: Transaction, replacements: { source: BoardElement; parts: BoardElement[] }[]): void {
    const undone = this.future.includes(transaction);
    if (!undone && !this.past.includes(transaction)) return;
    const changes: Change[] = [];
    const updates = new Map<string, Change[]>();
    for (const { source, parts } of replacements) {
      if (!undone && this.items.get(source.id) !== source) continue;
      const next: Change[] = parts.length ? parts.map(after => ({ id: after.id, after })) : [{ id: source.id, after: null }];
      changes.push(...next); updates.set(source.id, next);
      for (const part of parts) if (part.id !== source.id) transaction.before.push({ id: part.id, after: null });
    }
    if (!changes.length) return;
    transaction.after = transaction.after.flatMap(change => updates.get(change.id) ?? [change]);
    if (!undone) this.write(changes, transaction.label);
  }

  undo(): void {
    const entry = this.past.pop();
    if (!entry) return;
    this.future.push(entry);
    this.write(entry.before, `撤销${entry.label}`);
  }

  redo(): void {
    const entry = this.future.pop();
    if (!entry) return;
    this.past.push(entry);
    this.write(entry.after, `重做${entry.label}`);
  }

  private write(changes: Change[], label: string): void {
    for (const { id, after } of changes) {
      if (after) {
        this.items.set(id, after);
        this.index.set(id, elementBounds(after));
      } else { this.items.delete(id); this.index.delete(id); }
    }
    this.sorted = null;
    this.revision++;
    for (const listener of this.listeners) listener(changes, label);
  }
}
