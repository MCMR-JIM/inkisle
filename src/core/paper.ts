import { createElement, type BoardElement, type Bounds, type Change } from './model';
import { containsBounds, elementBounds } from './geometry';
import { selectionUnits } from './groups';

export type PaperLayout = 'single' | 'double';
export const PAPER_GAP = 40;
let paperSequence = 0;
export const paperPages = (elements: BoardElement[]): BoardElement[] => elements.filter(el => el.kind === 'paper');

export function createPaper(x = 0, y = 0, sourceId?: string, sourcePage?: number): BoardElement {
  return createElement('paper', { x, y, w: 595.28, h: 841.89, order: -1e15 + Date.now() * 100 + paperSequence++, locked: true, strokeWidth: 0, fill: '#ffffff', paper: { margin: 96, ...(sourceId ? { sourceId, sourcePage } : {}) } });
}

/** Grouped content must also fit in one page; never tear a cross-page group apart. */
export function paperAssignments(elements: BoardElement[]): { owners: Map<string, BoardElement>; overflow: BoardElement[] } {
  const pages = paperPages(elements), owners = new Map<string, BoardElement>(), overflow: BoardElement[] = [];
  for (const unit of selectionUnits(elements.filter(el => el.kind !== 'paper'))) {
    const owner = pages.find(page => containsBounds(elementBounds(page), unit.bounds));
    for (const element of unit.elements) if (owner) owners.set(element.id, owner); else overflow.push(element);
  }
  return { owners, overflow };
}

export function paperPositions(pages: BoardElement[], layout: PaperLayout, origin: { x: number; y: number }): BoardElement[] {
  const columns = layout === 'double' ? 2 : 1;
  const widths = Array.from({ length: columns }, (_, col) => Math.max(0, ...pages.filter((_, i) => i % columns === col).map(page => elementBounds(page).w)));
  let rowY = origin.y;
  return pages.map((page, i) => {
    const col = i % columns;
    if (!col && i) rowY += Math.max(...pages.slice(i - columns, i).map(page => elementBounds(page).h)) + PAPER_GAP;
    const x = origin.x + widths.slice(0, col).reduce((sum, w) => sum + w + PAPER_GAP, 0);
    return { ...page, x: x + page.paper!.margin, y: rowY + page.paper!.margin };
  });
}

export function paperLayoutChanges(elements: BoardElement[], layout: PaperLayout): Change[] {
  const pages = paperPages(elements);
  if (!pages.length) return [];
  const { owners, overflow } = paperAssignments(elements);
  if (overflow.length) throw new Error(`${overflow.length} 个对象超出纸张外框，请移回或删除后再切换布局`);
  const origin = { x: Math.min(...pages.map(p => elementBounds(p).x)), y: Math.min(...pages.map(p => elementBounds(p).y)) };
  const positioned = new Map(paperPositions(pages, layout, origin).map(p => [p.id, p]));
  return elements.flatMap(el => {
    const owner = owners.get(el.id), paper = positioned.get(el.id);
    const after = paper ?? (owner ? { ...el, x: el.x + positioned.get(owner.id)!.x - owner.x, y: el.y + positioned.get(owner.id)!.y - owner.y } : el);
    return after.x === el.x && after.y === el.y ? [] : [{ id: el.id, after }];
  });
}

export function fitPaperSource(page: BoardElement, width: number, height: number): Bounds {
  const scale = Math.min(page.w / width, page.h / height);
  return { x: page.x + (page.w - width * scale) / 2, y: page.y + (page.h - height * scale) / 2, w: width * scale, h: height * scale };
}

export function parsePageRange(value: string, count: number, limit = 5000): number[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 5000) throw new Error('PDF 页数超过支持范围');
  const selected = new Set<number>();
  for (const chunk of (value.trim() || `1-${count}`).replaceAll('，', ',').split(',')) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(chunk.trim());
    if (!match) throw new Error('请输入页码，例如 1-5,8');
    const first = Number(match[1]), last = Number(match[2] ?? match[1]);
    if (first < 1 || last < first || last > count) throw new Error(`页码须在 1–${count} 之间`);
    for (let i = first; i <= last; i++) { selected.add(i); if (selected.size > limit) throw new Error(`一次最多处理 ${limit} 页，请分批选择页码`); }
  }
  return [...selected].sort((a, b) => a - b);
}
