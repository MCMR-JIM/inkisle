export type ElementKind = 'pen' | 'rect' | 'roundrect' | 'ellipse' | 'diamond' | 'triangle' | 'pentagon' | 'hexagon' | 'arrow' | 'bidirectional-arrow' | 'line' | 'text' | 'note' | 'image' | 'path';
export type Tool = Exclude<ElementKind, 'path'> | 'select' | 'hand' | 'eraser' | 'recognize';
export interface Point { x: number; y: number; pressure?: number }
export interface Bounds { x: number; y: number; w: number; h: number }
export interface Camera { x: number; y: number; zoom: number }
/** Element-local swept ellipses. Separate radii preserve non-uniform resizing. */
export interface Erasure { points: Point[]; radiusX: number; radiusY: number }
export interface StrokePath { points: Point[]; closed: boolean; pressureEnabled?: boolean }
export interface PathLabel extends Bounds { text: string }
export interface PathGeometry { fills: Point[][]; strokes: StrokePath[]; label?: PathLabel }

export interface BoardElement extends Bounds {
  id: string;
  kind: ElementKind;
  order: number;
  orderPath?: number[];
  rotation: number;
  /** Initial side of a line's rotation stem, retained when editing endpoints. */
  rotationHandleSide?: 1 | -1;
  stroke: string;
  fill: string;
  /** Selected fill retained while the rendered fill is transparent. */
  fillColor?: string;
  strokeWidth: number;
  opacity: number;
  fontSize: number;
  text: string;
  points: Point[];
  /** Explicit opt-in: legacy pressure samples still render at their old width. */
  pressureEnabled?: boolean;
  radius: number;
  dash: boolean;
  locked: boolean;
  src?: string;
  erasures?: Erasure[];
  path?: PathGeometry;
  /** Optional local vertices for a recognized scalene triangle. */
  vertices?: Point[];
  /** Stable group ancestry, ordered from the outermost to the innermost group. */
  groupPath?: string[];
}

export interface BoardDocument {
  id: string;
  title: string;
  created: number;
  updated: number;
  camera: Camera;
  background: string;
  elements: BoardElement[];
}

export interface Change { id: string; after: BoardElement | null }
export interface BoardMeta {
  id: string;
  title: string;
  created: number;
  updated: number;
  elementCount: number;
  thumbnail?: string;
}

let sequence = 0;
/** Two rows of five preset colors; custom colors live in the palette control. */
export const COLORS = ['#283e36', '#748477', '#e28165', '#d9ae52', '#639bba', '#9180b8', '#e27ca0', '#64a69a', '#a58265', '#ffffff'];
export const FILLS = ['#e9ece8', '#e6eee5', '#f8e3dc', '#faefc9', '#deedf5', '#eae3f5', '#f8e4ed', '#ddf0ea', '#eee4d9', '#ffffff'];

export function createElement(kind: ElementKind, overrides: Partial<BoardElement> = {}): BoardElement {
  return {
    id: crypto.randomUUID(), kind, order: Date.now() * 1000 + (sequence++ % 1000), rotation: 0,
    x: 0, y: 0, w: 0, h: 0,
    stroke: '#283e36', fill: kind === 'note' ? '#faefc9' : 'transparent',
    strokeWidth: 2, opacity: 1, fontSize: kind === 'note' ? 20 : 24,
    text: '', points: [], radius: kind === 'rect' ? 0 : 12, dash: false, locked: false,
    ...overrides,
  };
}

export function createDocument(title = '未命名画板'): BoardDocument {
  const now = Date.now();
  return {
    id: crypto.randomUUID(), title, created: now, updated: now,
    camera: { x: 0, y: 0, zoom: 1 }, background: '#f8f9f6', elements: [],
  };
}

export function isEmptyUntitled(doc: Pick<BoardDocument, 'title' | 'elements'>): boolean {
  return doc.elements.length === 0 && (!doc.title.trim() || doc.title.trim() === '未命名画板');
}

/** A split inherits its parent's layer, with exact lexicographic child ranks. */
export function compareElements(a: BoardElement, b: BoardElement): number {
  if (a.order !== b.order) return a.order - b.order;
  const ap = a.orderPath ?? [], bp = b.orderPath ?? [];
  for (let i = 0; i < Math.min(ap.length, bp.length); i++) if (ap[i] !== bp[i]) return ap[i] - bp[i];
  return ap.length - bp.length;
}
