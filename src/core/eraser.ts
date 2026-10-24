export const DEFAULT_ERASER_SIZE = 20;
export const MIN_ERASER_SIZE = 4;
export const MAX_ERASER_SIZE = 120;
export const ERASER_SIZE_STEP = 2;

/** Eraser size is its diameter in screen pixels, independent of canvas zoom. */
export function normalizeEraserSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ERASER_SIZE;
  return Math.max(MIN_ERASER_SIZE, Math.min(MAX_ERASER_SIZE, Math.round(value / ERASER_SIZE_STEP) * ERASER_SIZE_STEP));
}

export function wheelEraserSize(size: number, delta: number, mode = 0): number {
  if (!Number.isFinite(delta) || delta === 0) return normalizeEraserSize(size);
  const pixels = Math.abs(delta) * (mode === 1 ? 16 : mode === 2 ? 800 : 1);
  const steps = Math.max(1, Math.round(pixels / 100));
  return normalizeEraserSize(size - Math.sign(delta) * steps * ERASER_SIZE_STEP);
}

export function eraserRadius(size: number, zoom: number): number { return size / (2 * zoom); }
