import { createDocument, createElement, type BoardDocument, type BoardElement, type ElementKind } from './core/model';

/** The welcome canvas is real editable geometry, not a screenshot or an HTML overlay. */
export function createDemo(): BoardDocument {
  const doc = createDocument('好想法，从这里开始');
  let order = 0;
  const add = (kind: ElementKind, props: Partial<BoardElement>) => doc.elements.push(createElement(kind, { ...props, order: order++ }));
  add('text', { x: 370, y: 198, w: 550, h: 22, text: 'A LITTLE SPACE.  A LOT OF POSSIBILITIES.', fontSize: 11, stroke: '#98a18d' });
  add('text', { x: 367, y: 239, w: 650, h: 72, text: '让想法，自由生长。', fontSize: 46, stroke: '#344b39' });
  add('text', { x: 370, y: 320, w: 630, h: 40, text: '没有边界的画布，装得下每一个突如其来的灵感。', fontSize: 15, stroke: '#8b9680' });
  add('pen', { x: 375, y: 303, stroke: '#a2b58a', strokeWidth: 2.5, points: [{ x: 0, y: 0 }, { x: 31, y: -3 }, { x: 68, y: -4 }, { x: 110, y: -3 }, { x: 158, y: 0 }, { x: 180, y: 2 }] });

  add('note', { x: 370, y: 405, w: 218, h: 194, fill: '#f5eac5', stroke: '#706443', fontSize: 18, text: '01 / 捕捉灵感\n\n一个词、一条线，\n先把想法留下来。' });
  add('note', { x: 615, y: 434, w: 218, h: 194, fill: '#e4ebdc', stroke: '#53694d', fontSize: 18, text: '02 / 建立连接\n\n让零散的念头，\n长成清晰的思路。' });
  add('note', { x: 861, y: 405, w: 218, h: 194, fill: '#f4e0d7', stroke: '#8e6b58', fontSize: 18, text: '03 / 自由表达\n\n不必完美，\n开始就很好。' });
  add('arrow', { x: 577, y: 504, w: 49, h: 25, stroke: '#8d9f7c', strokeWidth: 1.6 });
  add('arrow', { x: 825, y: 527, w: 47, h: -25, stroke: '#bd9b84', strokeWidth: 1.6 });

  add('rect', { x: 395, y: 685, w: 166, h: 47, fill: '#edf1e8', stroke: '#c5d0bc', strokeWidth: 1, radius: 24, text: '随手画画', fontSize: 14 });
  add('rect', { x: 631, y: 685, w: 166, h: 47, fill: '#ffffff', stroke: '#c5d0bc', strokeWidth: 1, radius: 24, text: '慢慢想想', fontSize: 14 });
  add('rect', { x: 867, y: 685, w: 166, h: 47, fill: '#edf1e8', stroke: '#c5d0bc', strokeWidth: 1, radius: 24, text: '让好事发生', fontSize: 14 });
  add('arrow', { x: 568, y: 709, w: 55, h: 0, stroke: '#a4b497', strokeWidth: 1.3, dash: true });
  add('arrow', { x: 804, y: 709, w: 55, h: 0, stroke: '#a4b497', strokeWidth: 1.3, dash: true });

  add('text', { x: 1133, y: 426, w: 150, h: 70, text: '试试双击便签\n写下你的想法', fontSize: 13, stroke: '#a0aa93' });
  add('pen', { x: 1129, y: 493, stroke: '#acb59c', strokeWidth: 1.3, points: [{ x: 0, y: 0 }, { x: -4, y: 18 }, { x: -16, y: 29 }, { x: -35, y: 32 }] });
  add('arrow', { x: 1108, y: 525, w: -17, h: -1, stroke: '#acb59c', strokeWidth: 1.3 });
  add('text', { x: 471, y: 790, w: 600, h: 24, text: '这是一块真正的白板。选中、移动、涂鸦，把它变成你的。', fontSize: 11, stroke: '#a4ab9b' });
  add('ellipse', { x: 1108, y: 220, w: 19, h: 19, stroke: '#c8d1b8', strokeWidth: 1.3 });
  add('line', { x: 1145, y: 264, w: 12, h: -12, stroke: '#c8d1b8', strokeWidth: 1.3 });
  add('line', { x: 1145, y: 252, w: 12, h: 12, stroke: '#c8d1b8', strokeWidth: 1.3 });
  return doc;
}
