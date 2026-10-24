import { describe, expect, it } from 'vitest';
import { createDocument, createElement } from '../../src/core/model';
import { containsBounds, elementBounds, intersects } from '../../src/core/geometry';
import { appendPaperChanges, createPaper, documentPaperLayout, paperAssignments, paperLayoutChanges, paperPositions, parsePageRange } from '../../src/core/paper';
import { decodeDocument, encodeDocument } from '../../src/core/codec';
import { Scene } from '../../src/core/scene';

describe('fixed paper export boundaries', () => {
  it('retains double-column intent with one sheet and appends without overlapping margins', () => {
    const doc = createDocument(); doc.paperLayout = 'double';
    doc.elements = paperPositions([createPaper()], 'double', { x: 300, y: 120 });
    expect(documentPaperLayout(doc)).toBe('double');
    const added = appendPaperChanges(doc.elements, [createPaper()], 'double')[0].after!;
    expect(added.y).toBe(doc.elements[0].y); expect(intersects(elementBounds(added), elementBounds(doc.elements[0]))).toBe(false);
    doc.elements.push(added); doc.paperLayout = 'single'; expect(documentPaperLayout(doc)).toBe('double');
    const content = createElement('rect', { x: 500, y: 300, w: 200, h: 100 });
    const first = appendPaperChanges([content], [createPaper()], 'single')[0].after!;
    expect(elementBounds(first).y).toBeGreaterThan(elementBounds(content).y + elementBounds(content).h);
  });
  it('validates, deduplicates and bounds page ranges before loading or exporting pages', () => {
    expect(parsePageRange('3,1-2,2', 4)).toEqual([1, 2, 3]);
    expect(parsePageRange('', 3)).toEqual([1, 2, 3]);
    for (const range of ['0', '4', '3-1', 'a', '1,', '1-999999999']) expect(() => parsePageRange(range, 3)).toThrow();
    expect(() => parsePageRange('1-201', 300, 200)).toThrow(/200/);
  });
  it('keeps every expanded frame separate with mixed sizes in either continuous layout', () => {
    const pages = Array.from({ length: 9 }, (_, i) => ({ ...createPaper(), w: i % 2 ? 842 : 595, h: i % 2 ? 595 : 842 }));
    for (const layout of ['single', 'double'] as const) {
      const placed = paperPositions(pages, layout, { x: -1000, y: -2000 });
      for (let i = 0; i < placed.length; i++) {
        expect(containsBounds(elementBounds(placed[i]), placed[i])).toBe(true);
        for (let j = i + 1; j < placed.length; j++) expect(intersects(elementBounds(placed[i]), elementBounds(placed[j]))).toBe(false);
      }
    }
  });

  it('moves margin annotations with their paper and undoes both in one history step', () => {
    const [a, b] = paperPositions([createPaper(), createPaper()], 'single', { x: 0, y: 0 });
    const note = createElement('text', { x: b.x + b.w + 8, y: b.y + 10, w: 60, h: 20 });
    const scene = new Scene([a, b, note]);
    scene.apply(paperLayoutChanges(scene.elements, 'double'), '双页');
    const moved = scene.get(note.id)!, page = scene.get(b.id)!;
    expect(moved.x - page.x).toBeCloseTo(note.x - b.x);
    expect(moved.y - page.y).toBeCloseTo(note.y - b.y);
    scene.undo(); expect(scene.get(note.id)).toEqual(note); expect(scene.get(b.id)).toEqual(b);
  });

  it('blocks ink whose stroke edge crosses the frame and cross-page groups', () => {
    const pages = paperPositions([createPaper(), createPaper()], 'single', { x: 0, y: 0 });
    const edge = elementBounds(pages[0]);
    const ink = createElement('pen', { x: edge.x + edge.w - 1, y: 150, strokeWidth: 4, points: [{ x: 0, y: 0 }, { x: 0, y: 30 }] });
    expect(paperAssignments([...pages, ink]).overflow).toHaveLength(1);
    expect(() => paperLayoutChanges([...pages, ink], 'double')).toThrow(/越|超出/);
    const group = pages.map(p => createElement('rect', { x: p.x + 10, y: p.y + 10, w: 20, h: 20, groupPath: ['cross-page'] }));
    expect(paperAssignments([...pages, ...group]).overflow).toHaveLength(2);
  });

  it('round-trips page references and rejects movable or malformed paper records', () => {
    const doc = createDocument(); doc.elements = [createPaper(0, 0, 'a'.repeat(64), 2)];
    expect(decodeDocument(encodeDocument(doc))).toEqual(doc);
    doc.elements[0].locked = false; expect(() => encodeDocument(doc)).toThrow();
    doc.elements[0].locked = true; doc.elements[0].paper!.sourcePage = 0; expect(() => encodeDocument(doc)).toThrow();
  });
});
