import type { Bounds } from '../core/model';
import type { Renderer } from '../engine/renderer';

interface Rect { x: number; y: number; width: number; height: number }

function overlap(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

export function positionContextToolbar(r: Renderer, bar: HTMLElement, bounds: Bounds): Rect | null {
  const { x, y, zoom } = r.state.camera;
  const left = Math.max(0, bounds.x * zoom + x), top = Math.max(0, bounds.y * zoom + y);
  const right = Math.min(r.width, (bounds.x + bounds.w) * zoom + x), bottom = Math.min(r.height, (bounds.y + bounds.h) * zoom + y);
  if (right < left || bottom < top) { bar.hidden = true; return null; }
  bar.hidden = false;
  const width = bar.offsetWidth, height = bar.offsetHeight, margin = 12;
  const blockers = [...document.querySelectorAll<HTMLElement>('.app-header, .toolbar, .tool-submenu:not([hidden]), #properties:not([hidden]), #expand-properties:not([hidden]), #group-navigation:not([hidden]), .bottom-left, .bottom-right, #pdf-navigation:not([hidden])')].filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect());
  const clamp = (candidate: { x: number; y: number }): Rect => ({ x: Math.max(margin, Math.min(r.width - width - margin, candidate.x)), y: Math.max(margin, Math.min(r.height - height - margin, candidate.y)), width, height });
  const center = (left + right - width) / 2;
  const candidates = [clamp({ x: center, y: top - height - 14 }), clamp({ x: center, y: bottom + 14 }), clamp({ x: right + 14, y: (top + bottom - height) / 2 }), clamp({ x: left - width - 14, y: (top + bottom - height) / 2 })];
  const selection = { x: left, y: top, width: right - left, height: bottom - top };
  const score = (candidate: Rect): number => blockers.reduce((sum, rect) => sum + overlap(candidate, rect), 0) * 10 + overlap(candidate, selection);
  const best = candidates.reduce((best, candidate) => score(candidate) < score(best) ? candidate : best);
  placeToolbar(bar, best.x, best.y);
  return best;
}

export function placeToolbar(element: HTMLElement, x: number, y: number): void {
  const left = `${Math.round(x)}px`, top = `${Math.round(y)}px`;
  if (element.style.left !== left) element.style.left = left;
  if (element.style.top !== top) element.style.top = top;
}
