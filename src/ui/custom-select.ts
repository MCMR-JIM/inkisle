import { icon } from './icons';

export interface SelectOption { value: number; label: string }

/** A select-only combobox: focus stays on the trigger while the listbox opens. */
export class CustomSelect {
  private list: HTMLDivElement;
  private label: HTMLSpanElement;
  private options: SelectOption[];
  private current: number;
  private active = 0;
  private search = '';
  private searchTime = 0;

  constructor(private trigger: HTMLButtonElement, options: SelectOption[], value: number, private onChange: (value: number) => void) {
    this.options = options.slice(); this.current = value;
    trigger.type = 'button'; trigger.classList.add('custom-select');
    trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
    this.label = document.createElement('span');
    trigger.append(this.label); trigger.insertAdjacentHTML('beforeend', icon('chevron', 13));
    this.list = document.createElement('div');
    this.list.id = `${trigger.id}-options`; this.list.className = 'select-options'; this.list.hidden = true;
    this.list.setAttribute('role', 'listbox'); this.list.setAttribute('aria-label', trigger.getAttribute('aria-label') ?? '选项');
    trigger.setAttribute('aria-controls', this.list.id);
    document.body.append(this.list);
    trigger.addEventListener('click', () => { if (this.isOpen) this.close(); else this.open(); });
    trigger.addEventListener('keydown', event => this.keydown(event));
    trigger.addEventListener('blur', () => this.close());
    this.list.addEventListener('pointerdown', event => event.preventDefault());
    this.list.addEventListener('click', event => {
      const index = (event.target as HTMLElement).closest<HTMLElement>('[data-option]')?.dataset.option;
      if (index !== undefined) this.choose(+index, false);
    });
    this.list.addEventListener('pointermove', event => {
      const index = (event.target as HTMLElement).closest<HTMLElement>('[data-option]')?.dataset.option;
      if (index !== undefined && this.active !== +index) { this.active = +index; this.updateActive(); }
    });
    document.addEventListener('pointerdown', event => {
      if (!trigger.contains(event.target as Node) && !this.list.contains(event.target as Node)) this.close();
    });
    window.addEventListener('resize', () => this.close());
    document.addEventListener('scroll', event => { if (event.target !== this.list) this.close(); }, true);
    this.setValue(value);
  }

  private get isOpen(): boolean { return !this.list.hidden; }

  setValue(value: number): void {
    if (!this.options.some(option => option.value === value)) {
      this.options.push({ value, label: `${Math.round(value)} px` });
      this.options.sort((a, b) => a.value - b.value);
    }
    this.current = value;
    this.trigger.value = String(value);
    this.label.textContent = this.options.find(option => option.value === value)!.label;
    if (this.isOpen) this.render();
  }

  close(): void {
    this.list.hidden = true; this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.removeAttribute('aria-activedescendant'); this.search = '';
  }

  private open(offset = 0): void {
    this.active = Math.max(0, Math.min(this.options.length - 1, this.options.findIndex(option => option.value === this.current) + offset));
    this.render(); this.list.hidden = false;
    const rect = this.trigger.getBoundingClientRect();
    const width = Math.max(108, rect.width), height = Math.min(this.list.scrollHeight, 260, window.innerHeight - 20);
    this.list.style.width = `${width}px`; this.list.style.maxHeight = `${Math.max(48, height)}px`;
    this.list.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`;
    this.list.style.top = `${Math.max(8, rect.bottom + height + 6 <= window.innerHeight - 8 ? rect.bottom + 6 : rect.top - height - 6)}px`;
    this.trigger.setAttribute('aria-expanded', 'true'); this.updateActive();
  }

  private render(): void {
    this.list.replaceChildren();
    this.options.forEach((option, index) => {
      const item = document.createElement('div'); item.id = `${this.list.id}-${index}`; item.className = 'select-option';
      item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.value === this.current));
      item.dataset.option = String(index); item.textContent = option.label;
      item.insertAdjacentHTML('beforeend', icon('check', 13)); this.list.append(item);
    });
    this.updateActive();
  }

  private updateActive(): void {
    [...this.list.children].forEach((item, index) => item.classList.toggle('highlighted', index === this.active));
    const active = this.list.children[this.active] as HTMLElement | undefined;
    if (active && this.isOpen) {
      this.trigger.setAttribute('aria-activedescendant', active.id); active.scrollIntoView({ block: 'nearest' });
    }
  }

  private choose(index: number, keyboard = true): void {
    const option = this.options[index]; if (!option) return;
    const changed = option.value !== this.current;
    this.setValue(option.value); this.close();
    if (keyboard) this.trigger.focus({ preventScroll: true }); else this.trigger.blur();
    if (changed) this.onChange(option.value);
  }

  private keydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey) return;
    // These keys belong to the combobox, never to the whiteboard underneath.
    event.stopPropagation();
    if (event.key === 'Tab') { this.close(); return; }
    if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (!this.isOpen) {
        this.open(event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0);
        if (event.key === 'Home') this.active = 0;
        if (event.key === 'End') this.active = this.options.length - 1;
      } else if (event.key === 'Enter' || event.key === ' ') { this.choose(this.active); return; }
      else if (event.key === 'Home') this.active = 0;
      else if (event.key === 'End') this.active = this.options.length - 1;
      else this.active = Math.max(0, Math.min(this.options.length - 1, this.active + (event.key === 'ArrowDown' ? 1 : -1)));
      this.updateActive(); return;
    }
    if (event.key.length === 1 && /[\d.]/.test(event.key)) {
      event.preventDefault();
      if (!this.isOpen) this.open();
      this.search = performance.now() - this.searchTime > 700 ? event.key : this.search + event.key;
      this.searchTime = performance.now();
      const index = this.options.findIndex(option => option.label.startsWith(this.search));
      if (index !== -1) { this.active = index; this.updateActive(); }
    }
  }
}
