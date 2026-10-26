import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { BoardDocument, BoardElement } from '../core/model';
import { elementBounds, intersects, unionBounds } from '../core/geometry';
import { createPaper, fitPaperSource, paperPages, paperPositions, parsePageRange } from '../core/paper';
export { parsePageRange } from '../core/paper';
import { pdfAssets, MAX_PDF_BYTES } from '../storage/assets';
import { setPaperRenderer } from './paper-render';
import { drawElement, preloadImages } from './draw';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const resources = `${import.meta.env.BASE_URL}pdf-resources/`;
const CACHE_BYTES = 48 * 1024 * 1024;
interface Preview { canvas: HTMLCanvasElement; width: number; height: number; bytes: number }
const cache = new Map<string, Preview>();
const pending = new Map<string, Promise<Preview>>();
const failures = new Map<string, string>();
let cachedBytes = 0, sequence = Promise.resolve(), invalidate = () => {}, generation = 0;
let documentId = '', documentPromise: Promise<pdfjs.PDFDocumentProxy> | null = null;
let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null;

function enqueue<T>(action: () => Promise<T>): Promise<T> {
  const result = sequence.then(action);
  sequence = result.then(() => {}, () => {});
  return result;
}

async function openPdf(id: string): Promise<pdfjs.PDFDocumentProxy> {
  if (documentId === id && documentPromise) return documentPromise;
  if (loadingTask) await loadingTask.destroy().catch(() => {});
  documentId = id;
  const token = generation;
  documentPromise = (async () => {
    const data = new Uint8Array(await (await pdfAssets.get(id)).arrayBuffer());
    if (token !== generation) throw new Error('画板已切换');
    const task = loadingTask = pdfjs.getDocument({ data, cMapUrl: `${resources}cmaps/`, cMapPacked: true, standardFontDataUrl: `${resources}standard_fonts/`, wasmUrl: `${resources}wasm/`, iccUrl: `${resources}iccs/`, maxImageSize: -1, canvasMaxAreaInBytes: 16000000 });
    try { return await task.promise; }
    catch (error) { await task.destroy(); throw error; }
  })();
  return documentPromise;
}

export function activatePdf(invalidator: () => void): void {
  generation++; invalidate = invalidator;
  const old = loadingTask; loadingTask = null; documentId = ''; documentPromise = null;
  if (old) void old.destroy().catch(() => {});
  for (const value of cache.values()) { value.canvas.width = 0; value.canvas.height = 0; }
  cache.clear(); failures.clear(); pending.clear(); cachedBytes = 0;
  setPaperRenderer({ paint, reset: () => activatePdf(() => {}), diagnostics: pdfDiagnostics });
}

function keyFor(page: BoardElement, zoom: number): string {
  const width = Math.max(64, Math.min(2048, 2 ** Math.ceil(Math.log2(Math.max(1, page.w * zoom)))));
  return `${page.paper!.sourceId}:${page.paper!.sourcePage}:${width}`;
}

async function renderPage(page: BoardElement, width: number): Promise<Preview> {
  const doc = await openPdf(page.paper!.sourceId!);
  const pdfPage = await doc.getPage(page.paper!.sourcePage!);
  const natural = pdfPage.getViewport({ scale: 1 });
  const scale = Math.min(width / natural.width, 2048 / Math.max(natural.width, natural.height), Math.sqrt(1500000 / (natural.width * natural.height)));
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
  try { await pdfPage.render({ canvas, viewport }).promise; }
  catch (error) { canvas.width = canvas.height = 0; throw error; }
  finally { pdfPage.cleanup(); }
  return { canvas, width: natural.width, height: natural.height, bytes: canvas.width * canvas.height * 4 };
}

function requestPage(page: BoardElement, zoom: number): Promise<Preview> {
  const key = keyFor(page, zoom), hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return Promise.resolve(hit); }
  if (pending.has(key)) return pending.get(key)!;
  const token = generation;
  const result = enqueue(async () => {
    if (token !== generation) throw new Error('画板已切换');
    const value = await renderPage(page, Number(key.split(':').at(-1)));
    if (token !== generation) { value.canvas.width = value.canvas.height = 0; throw new Error('画板已切换'); }
    while (cachedBytes + value.bytes > CACHE_BYTES && cache.size) {
      const oldest = cache.keys().next().value!, old = cache.get(oldest)!;
      cache.delete(oldest); cachedBytes -= old.bytes; old.canvas.width = old.canvas.height = 0;
    }
    cache.set(key, value); cachedBytes += value.bytes; failures.delete(key); return value;
  });
  pending.set(key, result);
  void result.then(() => { if (token === generation) invalidate(); }, error => { if (token === generation) { failures.set(key, error instanceof Error ? error.message : 'PDF 页加载失败'); invalidate(); } }).finally(() => { if (pending.get(key) === result) pending.delete(key); });
  return result;
}

function paint(ctx: CanvasRenderingContext2D, page: BoardElement, zoom: number, request: boolean): void {
  if (!page.paper?.sourceId) return;
  const ratio = Math.max(1, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1), key = keyFor(page, zoom * ratio);
  const match = cache.get(key) ?? [...cache.entries()].find(([k]) => k.startsWith(`${page.paper!.sourceId}:${page.paper!.sourcePage}:`))?.[1];
  if (match) {
    const b = fitPaperSource(page, match.width, match.height); ctx.drawImage(match.canvas, b.x, b.y, b.w, b.h);
    if (cache.has(key)) { cache.delete(key); cache.set(key, match); }
  } else {
    ctx.fillStyle = '#748477'; ctx.font = '14px sans-serif';
    ctx.fillText(failures.has(key) ? `第 ${page.paper.sourcePage} 页加载失败` : `第 ${page.paper.sourcePage} 页`, page.x + 16, page.y + 28);
  }
  if (request && !cache.has(key) && !failures.has(key)) void requestPage(page, zoom * ratio).catch(() => {});
}
export async function preparePage(page: BoardElement, zoom = 1): Promise<void> {
  if (page.paper?.sourceId) await requestPage(page, zoom * Math.max(1, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
}

export function pdfDiagnostics(): { cachedBytes: number; cachedPages: number; pendingPages: number; budget: number } {
  return { cachedBytes, cachedPages: cache.size, pendingPages: pending.size, budget: CACHE_BYTES };
}

export async function inspectPdf(file: File): Promise<{ id: string; count: number }> {
  if (file.size > MAX_PDF_BYTES) throw new Error('PDF 超过 32 MB，请先拆分文档');
  const id = await pdfAssets.put(file);
  try { return await enqueue(async () => { const doc = await openPdf(id); if (doc.numPages > 5000) throw new Error('PDF 超过 5000 页，请先拆分文档'); return { id, count: doc.numPages }; }); }
  catch (error) { documentId = ''; documentPromise = null; throw new Error(error instanceof Error && error.name === 'PasswordException' ? 'PDF 需要密码，请先解锁后导入' : `PDF 无法打开：${error instanceof Error ? error.message : String(error)}`); }
}

export function importedPages(id: string, pages: number[], x: number, y: number): BoardElement[] {
  return paperPositions(pages.map(number => createPaper(0, 0, id, number)), 'single', { x, y });
}

export async function exportPdf(doc: BoardDocument, range: string, signal: AbortSignal, progress: (completed: number, total: number) => void): Promise<Blob> {
  const lib = await import('pdf-lib');
  let pages = paperPages(doc.elements);
  if (!pages.length) {
    const b = unionBounds(doc.elements); if (!b) throw new Error('画板还是空的');
    pages = [{ ...createPaper(), ...b, paper: { margin: 0 } }];
  }
  const indices = parsePageRange(range, pages.length, 200);
  const output = await lib.PDFDocument.create(), originals = new Map<string, Awaited<ReturnType<typeof lib.PDFDocument.load>>>();
  let complete = 0;
  for (const index of indices) {
    signal.throwIfAborted();
    const paper = pages[index - 1], bounds = elementBounds(paper);
    const outputPage = output.addPage([595.28, 841.89]);
    const fit = Math.min(595.28 / bounds.w, 841.89 / bounds.h), ox = (595.28 - bounds.w * fit) / 2, oy = (841.89 - bounds.h * fit) / 2;
    outputPage.drawRectangle({ x: ox, y: oy, width: bounds.w * fit, height: bounds.h * fit, color: lib.rgb(248 / 255, 249 / 255, 246 / 255) });
    const paperBox = { x: ox + (paper.x - bounds.x) * fit, y: oy + (bounds.y + bounds.h - paper.y - paper.h) * fit, width: paper.w * fit, height: paper.h * fit };
    outputPage.drawRectangle({ ...paperBox, color: lib.rgb(1, 1, 1) });
    if (paper.paper?.sourceId) {
      const id = paper.paper.sourceId;
      if (!originals.has(id)) originals.set(id, await lib.PDFDocument.load(await (await pdfAssets.get(id)).arrayBuffer()));
      const original = originals.get(id)!.getPage(paper.paper.sourcePage! - 1), crop = original.getCropBox();
      const rotation = ((original.getRotation().angle % 360) + 360) % 360;
      const naturalW = rotation % 180 ? crop.height : crop.width, naturalH = rotation % 180 ? crop.width : crop.height;
      const target = fitPaperSource(paper, naturalW, naturalH);
      const x = ox + (target.x - bounds.x) * fit, y = oy + (bounds.y + bounds.h - target.y - target.h) * fit;
      const w = target.w * fit, h = target.h * fit;
      if (original.node.Annots()?.size()) {
        // Page embedding omits PDF annotation appearances; flatten those pages instead.
        const preview = await requestPage(paper, 2);
        const png = await new Promise<Blob>((resolve, reject) => preview.canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PDF 页图片生成失败')), 'image/png'));
        signal.throwIfAborted(); const image = await output.embedPng(await png.arrayBuffer());
        outputPage.drawImage(image, { x, y, width: w, height: h });
      } else {
        const embedded = await output.embedPage(original, { left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height });
        outputPage.drawPage(embedded, { x: x + (rotation === 180 || rotation === 270 ? w : 0), y: y + (rotation === 90 || rotation === 180 ? h : 0), width: rotation % 180 ? h : w, height: rotation % 180 ? w : h, rotate: lib.degrees(-rotation) });
      }
    }
    const annotations = doc.elements.filter(el => el.kind !== 'paper' && intersects(elementBounds(el), bounds));
    await preloadImages(annotations);
    const scale = Math.min(2, 4096 / Math.max(bounds.w, bounds.h), Math.sqrt(8000000 / (bounds.w * bounds.h)));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.ceil(bounds.w * scale)); canvas.height = Math.max(1, Math.ceil(bounds.h * scale));
    try {
      const ctx = canvas.getContext('2d')!; ctx.scale(scale, scale); ctx.translate(-bounds.x, -bounds.y);
      for (const element of annotations) drawElement(ctx, element);
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('批注图片生成失败')), 'image/png'));
      signal.throwIfAborted(); const image = await output.embedPng(await png.arrayBuffer());
      outputPage.drawImage(image, { x: ox, y: oy, width: bounds.w * fit, height: bounds.h * fit });
    } finally { canvas.width = canvas.height = 0; }
    progress(++complete, indices.length); await new Promise(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted(); const result = await output.save(); signal.throwIfAborted();
  if (result.length > 128 * 1024 * 1024) throw new Error('导出文件超过 128 MB，请缩小页码范围');
  return new Blob([new Uint8Array(result)], { type: 'application/pdf' });
}
