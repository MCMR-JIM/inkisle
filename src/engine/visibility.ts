import type { BoardElement, Bounds } from '../core/model';
import { elementBounds, expandBounds } from '../core/geometry';
import { drawElement, imageFor } from './draw';
import { textLayout } from './text-layout';

const SCALE = 2, TILE = 512, MAX_PIXELS = 8_000_000;

async function anyPixels(canvas: HTMLCanvasElement, element: BoardElement, bounds: Bounds): Promise<boolean> {
  const left = Math.floor(bounds.x * SCALE), top = Math.floor(bounds.y * SCALE);
  const width = Math.ceil((bounds.x + bounds.w) * SCALE) - left, height = Math.ceil((bounds.y + bounds.h) * SCALE) - top;
  let tiles = 0;
  for (let y = 0; y < height; y += TILE) for (let x = 0; x < width; x += TILE) {
    canvas.width = Math.min(TILE, width - x); canvas.height = Math.min(TILE, height - y);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.setTransform(SCALE, 0, 0, SCALE, -left - x, -top - y);
    // Visibility ignores camera LOD and decoration such as a note's drop shadow.
    drawElement(ctx, element, false, Math.max(1, 5 / element.fontSize), false, false);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) return true;
    if (++tiles % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return false;
}

async function visible(element: BoardElement, canvas: HTMLCanvasElement): Promise<boolean> {
  if (!element.erasures?.length || element.locked || element.kind === 'paper') return true;
  if (element.kind === 'image' && element.src) await imageFor(element.src).decode();
  // Masks and geometry share local coordinates, so rotation need not enlarge the scan.
  const local = { ...element, x: 0, y: 0, rotation: 0 };
  let bounds = elementBounds(local);
  if (local.kind === 'text') {
    const ctx = canvas.getContext('2d')!;
    const layout = textLayout(ctx, local);
    bounds = { ...bounds, w: Math.max(bounds.w, layout.width + local.fontSize * 2), h: Math.max(bounds.h, layout.lines.length * layout.leading + local.fontSize) };
  }
  bounds = expandBounds(bounds, Math.max(4 * local.strokeWidth, 2));
  // Never downsample a large object and mistake a small surviving detail for emptiness.
  if (Math.ceil(bounds.w * SCALE) * Math.ceil(bounds.h * SCALE) > MAX_PIXELS) return true;
  if (await anyPixels(canvas, local, bounds)) return true;
  // An undecodable or inherently unrenderable source is not evidence of complete erasure.
  return !await anyPixels(canvas, { ...local, erasures: undefined }, bounds);
}

/** Check only committed masks, serially on one bounded surface, outside pointer movement. */
export async function removeErasedParts(groups: BoardElement[][]): Promise<BoardElement[][]> {
  const canvas = document.createElement('canvas'), result: BoardElement[][] = [];
  try {
    for (const group of groups) {
      const retained: BoardElement[] = [];
      for (const element of group) {
        try { if (await visible(element, canvas)) retained.push(element); }
        catch { retained.push(element); }
      }
      result.push(retained);
    }
    return result;
  } finally { canvas.width = canvas.height = 0; }
}
