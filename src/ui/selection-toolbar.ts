import type { Renderer } from '../engine/renderer';
import { placeToolbar, positionContextToolbar } from './context-toolbar';

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
    const best = positionContextToolbar(r, this.bar, bounds);
    if (!best) { this.close(); return; }
    const width = this.bar.offsetWidth, height = this.bar.offsetHeight, margin = 12;
    if (!this.menu.hidden) {
      const mw = this.menu.offsetWidth, mh = this.menu.offsetHeight;
      const below = best.y + height + 6;
      placeToolbar(this.menu, Math.max(margin, Math.min(r.width - mw - margin, best.x + width - mw)), below + mh <= r.height - margin ? below : Math.max(margin, best.y - mh - 6));
    }
  }
}
