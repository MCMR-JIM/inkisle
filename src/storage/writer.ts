import { isEmptyUntitled, type BoardDocument, type Change } from '../core/model';
import type { Repository, MetadataPatch } from './repository';

export type SaveState = 'draft' | 'saving' | 'saved' | 'error';

/** Serializes durable commits. A failed batch is retained ahead of newer changes. */
export class Writer {
  private changes: Change[] = [];
  private patch: MetadataPatch = {};
  private timer = 0;
  private running: Promise<boolean> | null = null;
  private commands = 0;
  private stopped = false;
  private metadataDirty = false;
  lastWriteMs = 0;

  constructor(private repo: Repository, private getDocument: () => BoardDocument, private onState: (state: SaveState, error?: unknown) => void, private persisted = true) {}

  get pending(): boolean { return !!(this.changes.length || this.metadataDirty || this.running); }
  get stored(): boolean { return this.persisted; }

  enqueue(changes: Change[], patch: MetadataPatch = {}, delay = 180): void {
    if (this.stopped) return;
    this.changes.push(...changes);
    Object.assign(this.patch, patch);
    this.metadataDirty = true;
    this.onState('saving');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { void this.flush(); }, delay);
  }

  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }

  private async drain(): Promise<boolean> {
    while (this.changes.length || this.metadataDirty) {
      const batch = this.changes;
      const patch = this.patch;
      this.changes = []; this.patch = {}; this.metadataDirty = false;
      const snapshot = this.getDocument();
      try {
        const start = performance.now();
        if (isEmptyUntitled(snapshot)) {
          if (this.persisted) await this.repo.remove(snapshot.id, true);
          this.persisted = false; this.commands = 0;
        } else if (!this.persisted) {
          // The first meaningful edit is a full snapshot, including all edits
          // that were batched while the board was only in memory.
          await this.repo.create(snapshot);
          this.persisted = true;
        } else {
          await this.repo.append(snapshot.id, batch, { elementCount: snapshot.elements.length, ...patch });
          this.commands++;
        }
        this.lastWriteMs = performance.now() - start;
        if (this.commands >= 64) {
          await this.repo.compact(snapshot);
          this.commands = 0;
        }
      } catch (error) {
        this.changes = [...batch, ...this.changes];
        this.patch = { ...patch, ...this.patch }; this.metadataDirty = true;
        this.onState('error', error);
        return false;
      }
    }
    this.onState(this.persisted ? 'saved' : 'draft');
    return true;
  }

  stop(): void { this.stopped = true; clearTimeout(this.timer); }
}
