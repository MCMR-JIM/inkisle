import { icon } from './icons';

export interface SelectOption<T extends string | number = number> { value: T; label: string; disabled?: boolean }
interface SelectSettings<T> {
  placement?: 'auto' | 'up';
  anchor?: HTMLElement;
  showChevron?: boolean;
  align?: 'start' | 'center';
  formatValue?: (value: T) => string;
  customValues?: boolean;
}

/** A select-only combobox: focus stays on the trigger while the listbox opens. */
export class CustomSelect<T extends string | number = number> {
  private static closeOpen?: () => void;
  private closeSelf = () => this.close();
  private list: HTMLDivElement;
  private label: HTMLSpanElement;
  private options: SelectOption<T>[];
  private current: T;
  private active = 0;
  private search = '';
  private searchTime = 0;

  constructor(private trigger: HTMLButtonElement, options: SelectOption<T>[], value: T, private onChange: (value: T) => void, private settings: SelectSettings<T> = {}) {
    this.options = options.map(option => ({ ...option })); this.current = value;
    trigger.type = 'button'; trigger.classList.add('custom-select');
    trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
    this.label = document.createElement('span');
    trigger.replaceChildren(this.label);
    if (settings.showChevron !== false) trigger.insertAdjacentHTML('beforeend', icon('chevron', 13));
    this.list = document.createElement('div');
    this.list.id = `${trigger.id}-options`; this.list.className = 'select-options'; this.list.hidden = true;
    this.list.dataset.align = settings.align ?? 'start';
    this.list.setAttribute('role', 'listbox'); this.list.setAttribute('aria-label', trigger.getAttribute('aria-label') ?? '选项');
    trigger.setAttribute('aria-controls', this.list.id);
    // A modal makes body-level menus inert. Keep each menu in its trigger's
    // dialog while retaining viewport positioning and the common styles.
    const dialog = trigger.closest('dialog');
    (dialog ?? document.body).append(this.list);
    dialog?.addEventListener('close', () => this.close());
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
      if (index !== undefined && !this.options[+index]?.disabled && this.active !== +index) { this.active = +index; this.updateActive(); }
    });
    document.addEventListener('pointerdown', event => {
      if (!trigger.contains(event.target as Node) && !this.list.contains(event.target as Node)) this.close();
    });
    window.addEventListener('resize', () => this.close());
    document.addEventListener('scroll', event => { if (event.target !== this.list) this.close(); }, true);
    this.setValue(value);
  }

  private get isOpen(): boolean { return !this.list.hidden; }
  get value(): T { return this.current; }

  setValue(value: T): void {
    const label = this.options.find(option => option.value === value)?.label ?? this.settings.formatValue?.(value) ?? String(value);
    if (this.settings.customValues !== false && !this.options.some(option => option.value === value)) {
      this.options.push({ value, label });
      if (typeof value === 'number') this.options.sort((a, b) => Number(a.value) - Number(b.value));
    }
    this.current = value;
    this.trigger.value = String(value);
    this.label.textContent = label;
    if (this.isOpen) this.render();
  }

  close(): void {
    if (CustomSelect.closeOpen === this.closeSelf) CustomSelect.closeOpen = undefined;
    this.list.hidden = true; this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.removeAttribute('aria-activedescendant'); this.search = '';
  }

  setDisabled(disabled: boolean): void {
    this.trigger.disabled = disabled;
    if (disabled) this.close();
  }

  setOptionDisabled(value: T, disabled: boolean): void {
    const option = this.options.find(option => option.value === value);
    if (!option) return;
    option.disabled = disabled;
    if (this.isOpen) this.render();
  }

  private enabledIndex(index: number, direction = 1): number {
    for (let i = index; i >= 0 && i < this.options.length; i += direction) if (!this.options[i].disabled) return i;
    return this.active;
  }

  private open(offset = 0): void {
    if (this.trigger.disabled) return;
    CustomSelect.closeOpen?.(); CustomSelect.closeOpen = this.closeSelf;
    this.active = Math.max(0, Math.min(this.options.length - 1, this.options.findIndex(option => option.value === this.current) + offset));
    this.active = this.enabledIndex(this.active, offset < 0 ? -1 : 1);
    this.render(); this.list.hidden = false;
    const rect = (this.settings.anchor ?? this.trigger).getBoundingClientRect();
    const width = Math.min(window.innerWidth - 16, rect.width);
    this.list.style.width = `${width}px`; this.list.style.maxHeight = 'none';
    this.list.style.fontSize = getComputedStyle(this.trigger).fontSize;
    const desiredHeight = Math.min(this.list.getBoundingClientRect().height, 260);
    const above = Math.max(0, rect.top - 14), below = Math.max(0, window.innerHeight - rect.bottom - 14);
    const up = this.settings.placement === 'up' ? above > 0 : desiredHeight > below && above > below;
    const height = Math.min(desiredHeight, up ? above : below);
    this.list.style.maxHeight = `${height}px`; this.list.dataset.placement = up ? 'up' : 'down';
    this.list.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`;
    this.list.style.top = `${up ? rect.top - height - 6 : rect.bottom + 6}px`;
    this.trigger.setAttribute('aria-expanded', 'true'); this.updateActive();
  }

  private render(): void {
    this.list.replaceChildren();
    this.options.forEach((option, index) => {
      const item = document.createElement('div'); item.id = `${this.list.id}-${index}`; item.className = 'select-option';
      item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.value === this.current));
      if (option.disabled) item.setAttribute('aria-disabled', 'true');
      item.dataset.option = String(index); item.dataset.value = String(option.value); item.textContent = option.label;
      item.insertAdjacentHTML('beforeend', icon('check', 13)); this.list.append(item);
    });
    this.updateActive();
  }

  private updateActive(): void {
    [...this.list.children].forEach((item, index) => item.classList.toggle('highlighted', index === this.active));
    const active = this.list.children[this.active] as HTMLElement | undefined;
    if (active && this.isOpen) {
      this.trigger.setAttribute('aria-activedescendant', active.id);
      // Scroll the menu only; scrollIntoView can move a containing modal and
      // close its menu through the outside-scroll handler.
      if (active.offsetTop < this.list.scrollTop) this.list.scrollTop = active.offsetTop;
      else if (active.offsetTop + active.offsetHeight > this.list.scrollTop + this.list.clientHeight) this.list.scrollTop = active.offsetTop + active.offsetHeight - this.list.clientHeight;
    }
  }

  private choose(index: number, keyboard = true): void {
    const option = this.options[index]; if (!option || option.disabled) return;
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
        if (event.key === 'Home') this.active = this.enabledIndex(0);
        if (event.key === 'End') this.active = this.enabledIndex(this.options.length - 1, -1);
      } else if (event.key === 'Enter' || event.key === ' ') { this.choose(this.active); return; }
      else if (event.key === 'Home') this.active = this.enabledIndex(0);
      else if (event.key === 'End') this.active = this.enabledIndex(this.options.length - 1, -1);
      else this.active = this.enabledIndex(this.active + (event.key === 'ArrowDown' ? 1 : -1), event.key === 'ArrowDown' ? 1 : -1);
      this.updateActive(); return;
    }
    if (event.key.length === 1 && !event.altKey && !event.isComposing) {
      event.preventDefault();
      if (!this.isOpen) this.open();
      this.search = performance.now() - this.searchTime > 700 ? event.key : this.search + event.key;
      this.searchTime = performance.now();
      const index = this.options.findIndex(option => !option.disabled && option.label.toLocaleLowerCase().startsWith(this.search.toLocaleLowerCase()));
      if (index !== -1) { this.active = index; this.updateActive(); }
    }
  }
}
