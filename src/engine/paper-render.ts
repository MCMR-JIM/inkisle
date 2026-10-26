import type { BoardElement } from '../core/model';
type Painter = (ctx: CanvasRenderingContext2D, page: BoardElement, zoom: number, request: boolean) => void;
export interface PaperDiagnostics { cachedBytes: number; cachedPages: number; pendingPages: number; budget: number }
interface PaperRenderer { paint: Painter; reset(): void; diagnostics(): PaperDiagnostics }
let renderer: PaperRenderer | null = null;
let allowRequests = true;
export function setPaperRenderer(value: PaperRenderer): void { renderer = value; }
export function paperDiagnostics(): PaperDiagnostics | null { return renderer?.diagnostics() ?? null; }
export function resetPaperResources(): void { renderer?.reset(); }
export function paintPaper(ctx: CanvasRenderingContext2D, page: BoardElement, zoom: number): void { renderer?.paint(ctx, page, zoom, allowRequests); }
export function withoutPaperRequests(action: () => void): void {
  const previous = allowRequests; allowRequests = false;
  try { action(); } finally { allowRequests = previous; }
}
export async function preparePaper(page: BoardElement, zoom: number): Promise<void> {
  if (page.paper?.sourceId) await (await import('./pdf')).preparePage(page, zoom);
}
