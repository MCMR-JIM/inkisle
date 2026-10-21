import { describe, expect, it } from 'vitest';
import { createDocument, createElement, FILLS } from '../../src/core/model';
import { decodeDocument, encodeDocument } from '../../src/core/codec';
import { selectedFill, setFillColor, setFillEnabled } from '../../src/core/fill';
import { restorePalette } from '../../src/core/colors';

describe('independent fill switch and selected color', () => {
  it('has ten colored presets and migrates old transparent slots without losing edited colors', () => {
    expect(FILLS).toHaveLength(10); expect(FILLS.every(color => color !== 'transparent')).toBe(true);
    const old = FILLS.slice(); old[0] = 'transparent'; old[3] = '#123abc';
    const restored = restorePalette(FILLS, JSON.stringify(old), true);
    expect(restored[0]).toBe(FILLS[0]); expect(restored[3]).toBe('#123abc');
  });

  it('changes the selected color without filling while disabled and restores it when enabled', () => {
    const off = setFillColor({ fill: 'transparent' }, '#123abc');
    expect(off).toEqual({ fill: 'transparent', fillColor: '#123abc' });
    const on = setFillEnabled(off, true);
    expect(on).toEqual({ fill: '#123abc', fillColor: '#123abc' });
    expect(setFillColor(on, '#fedcba')).toEqual({ fill: '#fedcba', fillColor: '#fedcba' });
    expect(setFillEnabled(on, false)).toEqual(off);
  });

  it('recovers legacy object colors and keeps remembered colors in source files', () => {
    const legacy = createElement('rect', { fill: '#deedf5' });
    expect(selectedFill(legacy)).toBe('#deedf5');
    const off = { ...legacy, ...setFillEnabled(legacy, false) };
    const doc = createDocument(); doc.elements = [off];
    const copy = decodeDocument(encodeDocument(doc)).elements[0];
    expect(copy.fill).toBe('transparent'); expect(copy.fillColor).toBe('#deedf5');
    expect(setFillEnabled(copy, true).fill).toBe('#deedf5');
    expect(selectedFill({ fill: 'transparent' }, '#e6eee5')).toBe('#e6eee5');
    copy.fillColor = 'transparent'; expect(() => encodeDocument({ ...doc, elements: [copy] })).toThrow(/格式/);
  });
});
