import { SHORTCUTS, ShortcutMap, shortcutFromEvent, shortcutLabel } from '../core/shortcuts';

/** The displayed shortcut list and runtime dispatch share one source of truth. */
export class ShortcutSettings {
  private recording: string | null = null;
  private status: HTMLElement;
  private list: HTMLElement;
  private suppressActivation = false;

  constructor(private dialog: HTMLDialogElement, private shortcuts: ShortcutMap, private onChange: () => void) {
    this.status = dialog.querySelector('#shortcut-status')!; this.list = dialog.querySelector('#shortcut-list')!;
    this.list.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-shortcut]');
      if (!button) return;
      this.recording = button.dataset.shortcut!; this.render();
      this.status.textContent = '请按新的组合键，Esc 取消，Backspace 清除';
      this.list.querySelector<HTMLElement>(`[data-shortcut="${this.recording}"]`)?.focus();
    });
    dialog.querySelector('#reset-shortcuts')!.addEventListener('click', () => { this.shortcuts.reset(); this.recording = null; this.onChange(); this.render(); this.status.textContent = '已恢复全部默认快捷键'; });
    dialog.addEventListener('keydown', event => {
      if (!this.recording) return;
      this.suppressActivation = event.key === 'Enter' || event.key === ' ';
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') { this.recording = null; this.render(); this.status.textContent = '已取消修改'; return; }
      const chord = event.key === 'Backspace' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey ? '' : shortcutFromEvent(event);
      if (chord === null) return;
      const error = this.shortcuts.set(this.recording, chord);
      this.recording = null; this.render();
      if (error) this.status.textContent = error;
      else { this.status.textContent = '快捷键已保存到本机'; this.onChange(); }
    });
    dialog.addEventListener('keyup', event => {
      if (this.suppressActivation) { event.preventDefault(); event.stopPropagation(); this.suppressActivation = false; }
    });
    dialog.addEventListener('close', () => { this.recording = null; this.render(); });
    this.render();
  }

  open(): void { this.recording = null; this.status.textContent = '点击右侧键位，按下新的组合键即可修改'; this.render(); if (!this.dialog.open) this.dialog.showModal(); }

  private render(): void {
    const active = (document.activeElement as HTMLElement | null)?.dataset.shortcut;
    this.list.replaceChildren();
    for (const item of SHORTCUTS) {
      const row = document.createElement('div'); row.className = 'shortcut-item';
      const label = document.createElement('span'); label.textContent = item.label;
      const button = document.createElement('button'); button.type = 'button'; button.dataset.shortcut = item.id; button.className = 'shortcut-key';
      button.textContent = this.recording === item.id ? '按下新键位…' : shortcutLabel(this.shortcuts.get(item.id));
      button.setAttribute('aria-label', `修改${item.label}快捷键`); button.classList.toggle('recording', this.recording === item.id);
      row.append(label, button); this.list.append(row);
    }
    if (active) this.list.querySelector<HTMLElement>(`[data-shortcut="${active}"]`)?.focus({ preventScroll: true });
  }
}
