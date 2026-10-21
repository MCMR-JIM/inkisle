export const MIN_ZOOM = .01;
export const MAX_ZOOM = 20;

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

/** Normalize hardware wheel units; one 100px notch changes scale by ~8%. */
export function wheelZoom(zoom: number, deltaY: number, deltaMode = 0): number {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1);
  const bounded = Math.max(-250, Math.min(250, pixels));
  return clampZoom(zoom * Math.exp(-bounded * .0008));
}

export function formatZoom(zoom: number): string {
  const percent = zoom * 100;
  return `${Number(percent.toFixed(percent < 10 ? 2 : 1))}%`;
}
