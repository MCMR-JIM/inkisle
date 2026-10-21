import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, formatZoom, wheelZoom } from '../../src/core/camera';
import { screenToWorld, zoomAt } from '../../src/core/geometry';
import { createDocument } from '../../src/core/model';
import { decodeDocument, encodeDocument } from '../../src/core/codec';

describe('fine-grained viewport zoom', () => {
  it('changes a normal wheel notch by about eight percent and accepts small trackpad deltas', () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1.05);
    expect(wheelZoom(1, -100)).toBeLessThan(1.11);
    expect(wheelZoom(1, -2)).toBeGreaterThan(1);
    expect(wheelZoom(1, -2)).toBeLessThan(1.005);
    expect(wheelZoom(wheelZoom(1, -100), 100)).toBeCloseTo(1, 10);
  });

  it('normalizes pixel/line deltas and bounds a single extreme scroll event', () => {
    expect(wheelZoom(1, -48, 0)).toBeCloseTo(wheelZoom(1, -3, 1), 10);
    expect(wheelZoom(1, -10000)).toBeLessThan(1.3);
    expect(wheelZoom(1, 10000)).toBeGreaterThan(.75);
  });

  it('extends the zoom range and preserves the world point under the pointer at both limits', () => {
    expect(MIN_ZOOM).toBe(.01); expect(MAX_ZOOM).toBe(20);
    const camera = { x: 120, y: -80, zoom: 1 };
    const point = { x: 720, y: 420 }, anchor = screenToWorld(point, camera);
    for (const zoom of [0, .01, 8, 20, 100]) {
      const next = zoomAt(camera, point, zoom);
      expect(next.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(next.zoom).toBeLessThanOrEqual(MAX_ZOOM);
      expect(screenToWorld(point, next)).toEqual(anchor);
    }
  });

  it('persists the expanded range and keeps low-zoom fractional values visible', () => {
    const doc = createDocument();
    for (const zoom of [MIN_ZOOM, .0125, MAX_ZOOM]) {
      doc.camera.zoom = zoom;
      expect(decodeDocument(encodeDocument(doc)).camera.zoom).toBe(zoom);
    }
    expect(formatZoom(.0125)).toBe('1.25%');
    expect(formatZoom(1)).toBe('100%');
    expect(formatZoom(1.083)).toBe('108.3%');
    expect(formatZoom(20)).toBe('2000%');
    doc.camera.zoom = 100;
    expect(() => encodeDocument(doc)).toThrow(/格式/);
  });
});
