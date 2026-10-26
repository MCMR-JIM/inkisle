import { createElement, type BoardDocument, type BoardElement, type Bounds, type Change, type PageLayout } from './model';
import { containsBounds, elementBounds, unionBounds } from './geometry';
import { selectionUnits } from './groups';
import { normalizeAngle, rotatePoint, rotationCenter } from './transforms';

export type PaperLayout = Exclude<PageLayout, 'infinite'>;
export const PAPER_GAP = 40;
let paperSequence = 0;
export const paperPages = (elements: BoardElement[]): BoardElement[] => elements.filter(el => el.kind === 'paper');

/** Geometry follows undo/redo; metadata retains a layout with fewer than two sheets. */
export function documentPaperLayout(doc: Pick<BoardDocument, 'elements' | 'paperLayout'>): PageLayout {
  const pages = paperPages(doc.elements);
  if (pages.length > 1) return pages.some(page => Math.abs(elementBounds(page).x - elementBounds(pages[0]).x) > 1) ? 'double' : 'single';
  return pages.length ? doc.paperLayout === 'double' ? 'double' : 'single' : doc.paperLayout ?? 'infinite';
}

export function appendPaperChanges(elements: BoardElement[], added: BoardElement[], layout: PaperLayout): Change[] {
  const pages = paperPages(elements);
  const content = unionBounds(elements);
  const origin = pages.length ? { x: Math.min(...pages.map(p => elementBounds(p).x)), y: Math.min(...pages.map(p => elementBounds(p).y)) } : content ? { x: content.x, y: content.y + content.h + PAPER_GAP } : { x: 300, y: 120 };
  const placed = paperPositions([...pages, ...added], layout, origin);
  const unchanged = pages.every((p, i) => Math.abs(p.x - placed[i].x) < .01 && Math.abs(p.y - placed[i].y) < .01);
  const next = unchanged ? placed.slice(pages.length) : paperPositions(added, layout, { x: origin.x, y: Math.max(...pages.map(p => { const b = elementBounds(p); return b.y + b.h; })) + PAPER_GAP });
  return next.map(after => ({ id: after.id, after }));
}

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

export function paperRotation(degrees: number): number { return ((degrees % 360) + 360) % 360; }

/** Rotate paper and its owned annotations together, then restore disjoint page frames. */
export function rotatePaperChanges(elements: BoardElement[], id: string, direction: -1 | 1, layout: PaperLayout): Change[] {
  const page = paperPages(elements).find(p => p.id === id); if (!page) return [];
  const { owners, overflow } = paperAssignments(elements);
  if (overflow.length) throw new Error('有对象超出纸张外框，请移回或删除后再旋转页面');
  const angle = direction * Math.PI / 2, center = rotationCenter(page);
  const turned = elements.map(el => {
    if (el.id === id) return { ...el, w: el.h, h: el.w, paper: { ...el.paper!, ...(el.paper?.sourceId ? { sourceRotation: paperRotation((el.paper.sourceRotation ?? 0) + direction * 90) } : {}) } };
    if (owners.get(el.id)?.id !== id) return el;
    const own = rotationCenter(el), moved = rotatePoint(own, center, angle);
    return { ...el, x: el.x + moved.x - own.x + (page.h - page.w) / 2, y: el.y + moved.y - own.y + (page.w - page.h) / 2, rotation: normalizeAngle(el.rotation + angle) };
  });
  const pages = paperPages(elements), origin = { x: Math.min(...pages.map(p => elementBounds(p).x)), y: Math.min(...pages.map(p => elementBounds(p).y)) };
  const before = new Map(turned.map(el => [el.id, el]));
  const positioned = new Map(paperPositions(paperPages(turned), layout, origin).map(p => [p.id, p]));
  return turned.flatMap((el, i) => {
    const owner = owners.get(el.id), paper = positioned.get(el.id);
    const after = paper ?? (owner ? { ...el, x: el.x + positioned.get(owner.id)!.x - before.get(owner.id)!.x, y: el.y + positioned.get(owner.id)!.y - before.get(owner.id)!.y } : el);
    const original = elements[i];
    return after.x === original.x && after.y === original.y && after.w === original.w && after.h === original.h && after.rotation === original.rotation && after.paper?.sourceRotation === original.paper?.sourceRotation ? [] : [{ id: el.id, after }];
  });
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
