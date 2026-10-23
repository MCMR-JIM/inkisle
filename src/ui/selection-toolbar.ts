import type { Renderer } from '../engine/renderer';

interface Rect { x: number; y: number; width: number; height: number }

function overlap(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

/** Context commands stay near the selection and outside the existing style panel. */
export class SelectionToolbar {
  private bar = document.querySelector<HTMLElement>('#selection-toolbar')!;
  private trigger = document.querySelector<HTMLButtonElement>('#alignment-trigger')!;
  private menu = document.querySelector<HTMLElement>('#alignment-controls')!;

  constructor(private renderer: Renderer) {
    this.trigger.addEventListener('click', () => {
      this.menu.hidden = !this.menu.hidden;
      this.trigger.setAttribute('aria-expanded', String(!this.menu.hidden));
      this.update();
    });
    this.menu.addEventListener('click', event => { if ((event.target as Element).closest('button')) this.close(); });
    this.bar.addEventListener('keydown', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button');
      if (button && !button.disabled && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); button.click(); }
    });
    document.addEventListener('pointerdown', event => { if (!this.bar.contains(event.target as Node)) this.close(); }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !this.menu.hidden) { event.preventDefault(); event.stopPropagation(); this.close(); this.trigger.focus(); }
    }, true);
  }

  private close(): void { this.menu.hidden = true; this.trigger.setAttribute('aria-expanded', 'false'); }

  update(): void {
    if (this.trigger.hidden) this.close();
    const r = this.renderer, bounds = r.selectionBounds();
    const actionable = [...this.bar.querySelectorAll<HTMLButtonElement>(':scope > button')].some(button => !button.hidden);
    if (!bounds || !actionable || r.state.tool !== 'select' || r.state.marquee || r.state.preview.length) {
      this.bar.hidden = true; this.close(); return;
    }
    const { x, y, zoom } = r.state.camera;
    const left = Math.max(0, bounds.x * zoom + x), top = Math.max(0, bounds.y * zoom + y);
    const right = Math.min(r.width, (bounds.x + bounds.w) * zoom + x), bottom = Math.min(r.height, (bounds.y + bounds.h) * zoom + y);
    if (right < left || bottom < top) { this.bar.hidden = true; this.close(); return; }
    this.bar.hidden = false;
    const width = this.bar.offsetWidth, height = this.bar.offsetHeight, margin = 12;
    const blockers = [...document.querySelectorAll<HTMLElement>('.app-header, .toolbar, .tool-submenu:not([hidden]), #properties:not([hidden]), #expand-properties:not([hidden]), #group-navigation:not([hidden]), .bottom-left, .bottom-right')].filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect());
    const clamp = (candidate: { x: number; y: number }): Rect => ({ x: Math.max(margin, Math.min(r.width - width - margin, candidate.x)), y: Math.max(margin, Math.min(r.height - height - margin, candidate.y)), width, height });
    const center = (left + right - width) / 2;
    const candidates = [clamp({ x: center, y: top - height - 14 }), clamp({ x: center, y: bottom + 14 }), clamp({ x: right + 14, y: (top + bottom - height) / 2 }), clamp({ x: left - width - 14, y: (top + bottom - height) / 2 })];
    const selection = { x: left, y: top, width: right - left, height: bottom - top };
    const score = (candidate: Rect): number => blockers.reduce((sum, rect) => sum + overlap(candidate, rect), 0) * 10 + overlap(candidate, selection);
    const best = candidates.reduce((best, candidate) => score(candidate) < score(best) ? candidate : best);
    this.place(this.bar, best.x, best.y);
    if (!this.menu.hidden) {
      const mw = this.menu.offsetWidth, mh = this.menu.offsetHeight;
      const below = best.y + height + 6;
      this.place(this.menu, Math.max(margin, Math.min(r.width - mw - margin, best.x + width - mw)), below + mh <= r.height - margin ? below : Math.max(margin, best.y - mh - 6));
    }
  }

  private place(element: HTMLElement, x: number, y: number): void {
    const left = `${Math.round(x)}px`, top = `${Math.round(y)}px`;
    if (element.style.left !== left) element.style.left = left;
    if (element.style.top !== top) element.style.top = top;
  }
}
