import { icon } from './icons';

type Attributes = Record<string, string | number | true>;
interface Option {
  type: 'option'; label: string; icon?: string; endIcon?: string; ariaLabel?: string;
  shortcut?: string; tooltip?: string; attributes?: Attributes;
}
interface Switch {
  type: 'switch'; id: string; label: string; labelId?: string; checked: boolean; tooltip?: string;
}
interface Range {
  type: 'range'; id: string; label: string; min: number; max: number; value: number; step?: number; unit?: string;
}
export type FloatingBarItem = Option | Switch | Range | { type: 'separator' } | { type: 'group'; items: FloatingBarItem[] };
export interface FloatingBarConfig {
  id: string; label: string; items: FloatingBarItem[]; className?: string;
  role?: 'menu' | 'toolbar' | 'group'; layout?: 'compact' | 'grid';
  attributes?: Attributes; contentAfter?: string; spaceActivates?: boolean;
}

const escape = (value: string | number): string => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attributes = (values: Attributes = {}): string => Object.entries(values).map(([key, value]) => value === true ? key : `${key}="${escape(value)}"`).join(' ');

export function toggleSwitchMarkup(id: string, labelId: string, checked: boolean, tooltip: string): string {
  return `<button id="${escape(id)}" class="toggle-switch" type="button" role="switch" aria-checked="${checked}" aria-labelledby="${escape(labelId)}" data-tooltip="${escape(tooltip)}"><span></span></button>`;
}

function itemMarkup(item: FloatingBarItem): string {
  if (item.type === 'group') return `<div class="floating-bar-group">${item.items.map(itemMarkup).join('')}</div>`;
  if (item.type === 'separator') return barSeparatorMarkup();
  if (item.type === 'switch') {
    const labelId = item.labelId ?? `${item.id}-label`;
    return `<div class="floating-bar-control"><label id="${escape(labelId)}" for="${escape(item.id)}">${escape(item.label)}</label>${toggleSwitchMarkup(item.id, labelId, item.checked, item.tooltip ?? item.label)}</div>`;
  }
  if (item.type === 'range') {
    const value = `${item.value}${item.unit ? ` ${item.unit}` : ''}`;
    return `<div class="floating-bar-range"><div class="floating-bar-range-heading"><label for="${escape(item.id)}">${escape(item.label)}</label><output id="${escape(item.id)}-value" for="${escape(item.id)}">${escape(value)}</output></div><input type="range" id="${escape(item.id)}" min="${item.min}" max="${item.max}" step="${item.step ?? 1}" value="${item.value}" data-range-input data-unit="${escape(item.unit ?? '')}" aria-valuetext="${escape(value)}" /></div>`;
  }
  return `<button type="button" class="floating-bar-option" aria-label="${escape(item.ariaLabel ?? item.label)}" data-tooltip="${escape(item.tooltip ?? item.label + (item.shortcut ? `  ${item.shortcut}` : ''))}" ${attributes(item.attributes)}>${item.icon ? icon(item.icon, 19) : ''}<span>${escape(item.label)}</span>${item.endIcon ? icon(item.endIcon, 14) : ''}${item.shortcut ? `<kbd>${escape(item.shortcut)}</kbd>` : ''}</button>`;
}

/** Shared frame, arbitrary options and trailing controls; anchoring stays with the caller. */
export function floatingBarMarkup(bar: FloatingBarConfig): string {
  return `<div id="${escape(bar.id)}" class="floating-bar panel ${escape(bar.className ?? '')}${bar.layout ? ` floating-bar--${bar.layout}` : ''}" data-floating-bar data-space-activates="${!!bar.spaceActivates}" role="${bar.role ?? 'toolbar'}" aria-label="${escape(bar.label)}" ${attributes(bar.attributes)} hidden>${bar.items.map(itemMarkup).join('')}${bar.contentAfter ?? ''}</div>`;
}

export function barSeparatorMarkup(): string { return '<span class="bar-separator" aria-hidden="true"></span>'; }

/** Programmatic changes (for example wheel input) share the slider's readout. */
export function setRangeValue(input: HTMLInputElement, value: number): void {
  input.value = String(value);
  const text = `${input.value}${input.dataset.unit ? ` ${input.dataset.unit}` : ''}`;
  input.setAttribute('aria-valuetext', text);
  const output = input.closest('.floating-bar-range')?.querySelector('output');
  if (output) output.value = text;
}

export function bindFloatingBars(root: HTMLElement, anchor?: HTMLElement): void {
  root.addEventListener('input', event => {
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-range-input]')) setRangeValue(event.target, event.target.valueAsNumber);
  });
  root.addEventListener('keydown', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('.floating-bar-option');
    const bar = button?.closest<HTMLElement>('[data-floating-bar]');
    if (button && !button.disabled && (event.key === 'Enter' || (event.key === ' ' && bar?.dataset.spaceActivates === 'true'))) {
      event.preventDefault(); event.stopPropagation(); button.click();
    }
  });
  if (anchor) {
    const bars = [...anchor.querySelectorAll<HTMLElement>('[data-floating-bar]')];
    const update = () => {
      root.style.setProperty('--floating-anchor-height', `${anchor.offsetHeight}px`);
      root.style.setProperty('--floating-options-height', `${Math.max(0, ...bars.filter(bar => !bar.hidden).map(bar => bar.offsetHeight))}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(anchor); bars.forEach(bar => observer.observe(bar)); update();
  }
}
