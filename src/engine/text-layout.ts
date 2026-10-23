import type { BoardElement } from '../core/model';
import { normalizeBounds } from '../core/geometry';

export const CANVAS_FONT = '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
export const textFont = (el: BoardElement): string => `${el.kind === 'text' && el.fontSize >= 32 ? '600' : '400'} ${el.fontSize}px ${CANVAS_FONT}`;
export const textLeading = (el: BoardElement): number => el.fontSize * 1.55;

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    let line = '';
    for (const character of paragraph) {
      if (line && ctx.measureText(line + character).width > maxWidth) { lines.push(line); line = ''; }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}

export function textLayout(ctx: CanvasRenderingContext2D, el: BoardElement, text = el.text) {
  const b = normalizeBounds(el), padding = el.kind === 'text' ? 0 : el.kind === 'note' ? 22 : 16;
  const width = el.kind === 'text' ? b.w || 1000 : Math.max(10, b.w - padding * 2), leading = textLeading(el);
  const centered = el.kind !== 'text' && el.kind !== 'note';
  ctx.font = textFont(el);
  const lines = wrapText(ctx, text, width);
  return { x: b.x + padding, y: b.y + padding + (centered ? Math.max(0, (b.h - padding * 2 - lines.length * leading) / 2) : 0), width, leading, lines, padding, centered };
}

const editorOffsets = new Map<string, number>();

/** Match the browser's line-box baseline to Canvas's existing top baseline. */
export function editorTextOffset(ctx: CanvasRenderingContext2D, el: BoardElement): number {
  const font = textFont(el), leading = textLeading(el), key = `${font}/${leading}`;
  const cached = editorOffsets.get(key);
  if (cached !== undefined) return cached;
  ctx.save(); ctx.font = font;
  ctx.textBaseline = 'top'; const top = ctx.measureText('M').actualBoundingBoxAscent;
  ctx.textBaseline = 'alphabetic'; const baseline = ctx.measureText('M').actualBoundingBoxAscent;
  ctx.restore();
  const probe = document.createElement('span'), marker = document.createElement('span');
  Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre', font, lineHeight: `${leading}px` });
  Object.assign(marker.style, { display: 'inline-block', width: '0', height: '0', verticalAlign: 'baseline' });
  probe.append('M', marker); document.body.append(probe);
  const browserBaseline = marker.getBoundingClientRect().top - probe.getBoundingClientRect().top;
  probe.remove();
  const offset = el.fontSize * .12 + baseline - top - browserBaseline;
  editorOffsets.set(key, offset);
  return offset;
}
