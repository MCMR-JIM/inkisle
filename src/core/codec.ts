import type { BoardDocument } from './model';
import { MIN_ZOOM, MAX_ZOOM } from './camera';
import { PRODUCT } from './product';

// LWB1 is a stable file-format identifier, including legacy .liubai snapshots.
const MAGIC = [0x4c, 0x57, 0x42, 0x31];
const HEADER = 16;
const MAX_BYTES = 64 * 1024 * 1024;
const kinds = new Set(['pen', 'rect', 'roundrect', 'ellipse', 'diamond', 'triangle', 'pentagon', 'hexagon', 'arrow', 'bidirectional-arrow', 'line', 'text', 'note', 'image', 'path', 'paper']);
const color = /^(#[\da-f]{3,8}|transparent)$/i;
const table = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function finite(n: unknown, limit = 1e9): n is number {
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit;
}

function assert(condition: unknown): asserts condition {
  if (!condition) throw new Error('画板数据格式不正确，或包含非法坐标');
}

export function validateDocument(input: unknown): asserts input is BoardDocument {
  assert(input && typeof input === 'object');
  const doc = input as BoardDocument;
  assert(typeof doc.id === 'string' && doc.id.length > 0 && doc.id.length <= 120);
  assert(typeof doc.title === 'string' && doc.title.length <= 300);
  assert(finite(doc.created, 1e16) && finite(doc.updated, 1e16));
  assert(doc.camera && finite(doc.camera.x) && finite(doc.camera.y) && finite(doc.camera.zoom) && doc.camera.zoom >= MIN_ZOOM && doc.camera.zoom <= MAX_ZOOM);
  assert(typeof doc.background === 'string' && color.test(doc.background));
  assert(doc.paperLayout === undefined || ['infinite', 'single', 'double'].includes(doc.paperLayout));
  assert(Array.isArray(doc.elements) && doc.elements.length <= 100000);
  const ids = new Set<string>();
  const parents = new Map<string, string>();
  let samples = 0;
  for (const el of doc.elements) {
    assert(el && typeof el === 'object' && kinds.has(el.kind));
    assert(typeof el.id === 'string' && el.id.length > 0 && el.id.length <= 120 && !ids.has(el.id));
    ids.add(el.id);
    if (el.groupPath !== undefined) {
      assert(Array.isArray(el.groupPath) && el.groupPath.length <= 32);
      const ancestry = new Set<string>();
      for (let i = 0; i < el.groupPath.length; i++) {
        const id = el.groupPath[i], parent = JSON.stringify(el.groupPath.slice(0, i));
        assert(typeof id === 'string' && id.length > 0 && id.length <= 120 && !ancestry.has(id));
        assert(!parents.has(id) || parents.get(id) === parent);
        ancestry.add(id); parents.set(id, parent);
      }
    }
    for (const key of ['x', 'y', 'w', 'h'] as const) assert(finite(el[key]));
    assert(finite(el.order, 1e16));
    assert(el.rotation === undefined || finite(el.rotation, Math.PI * 1000));
    assert(el.rotationHandleSide === undefined || el.rotationHandleSide === 1 || el.rotationHandleSide === -1);
    if (el.orderPath !== undefined) assert(Array.isArray(el.orderPath) && el.orderPath.length <= 256 && el.orderPath.every(n => Number.isSafeInteger(n) && n >= 0));
    assert(typeof el.stroke === 'string' && color.test(el.stroke) && typeof el.fill === 'string' && color.test(el.fill));
    assert(el.fillColor === undefined || typeof el.fillColor === 'string' && el.fillColor !== 'transparent' && color.test(el.fillColor));
    assert(finite(el.strokeWidth, 200) && el.strokeWidth >= 0 && finite(el.opacity, 1) && el.opacity >= 0);
    assert(finite(el.fontSize, 1000) && el.fontSize > 0 && finite(el.radius, 1000) && el.radius >= 0);
    assert(typeof el.text === 'string' && el.text.length <= 100000);
    assert(typeof el.locked === 'boolean' && typeof el.dash === 'boolean');
    if (el.kind === 'paper' || el.paper !== undefined) {
      assert(el.kind === 'paper' && el.paper && finite(el.paper.margin, 500) && el.paper.margin >= 0);
      assert(el.w > 0 && el.h > 0 && !el.rotation && el.locked && !el.groupPath?.length && !el.erasures?.length);
      assert(el.paper.sourceId === undefined && el.paper.sourcePage === undefined || typeof el.paper.sourceId === 'string' && /^[a-f0-9]{64}$/.test(el.paper.sourceId) && Number.isSafeInteger(el.paper.sourcePage) && el.paper.sourcePage! > 0 && el.paper.sourcePage! <= 5000);
      assert(el.paper.sourceRotation === undefined || !!el.paper.sourceId && [0, 90, 180, 270].includes(el.paper.sourceRotation));
    }
    assert(el.pressureEnabled === undefined || typeof el.pressureEnabled === 'boolean');
    assert(Array.isArray(el.points));
    samples += el.points.length;
    assert(samples <= 2000000);
    for (const p of el.points) assert(p && finite(p.x) && finite(p.y) && (p.pressure === undefined || (finite(p.pressure, 1) && p.pressure >= 0)));
    if (el.vertices !== undefined) {
      assert(el.kind === 'triangle' && Array.isArray(el.vertices) && el.vertices.length === 3);
      for (const p of el.vertices) assert(p && finite(p.x) && finite(p.y));
    }
    if (el.erasures !== undefined) {
      assert(Array.isArray(el.erasures) && el.erasures.length <= 10000);
      for (const stroke of el.erasures) {
        assert(stroke && finite(stroke.radiusX) && stroke.radiusX > 0 && finite(stroke.radiusY) && stroke.radiusY > 0);
        assert(Array.isArray(stroke.points) && stroke.points.length > 0);
        samples += stroke.points.length; assert(samples <= 2000000);
        for (const p of stroke.points) assert(p && finite(p.x) && finite(p.y));
      }
    }
    if (el.kind === 'image') assert(typeof el.src === 'string' && /^data:image\/(png|jpeg|webp|gif|avif);base64,[a-z\d+/=\s]+$/i.test(el.src) && el.src.length <= 28 * 1024 * 1024);
    if (el.path !== undefined || el.kind === 'path') {
      assert(el.kind === 'path' && el.path && Array.isArray(el.path.fills) && Array.isArray(el.path.strokes));
      assert(el.path.fills.length + el.path.strokes.length > 0 && el.path.fills.length + el.path.strokes.length <= 10000);
      for (const ring of el.path.fills) {
        assert(Array.isArray(ring) && ring.length >= 3);
        samples += ring.length; assert(samples <= 2000000);
        for (const p of ring) assert(p && finite(p.x) && finite(p.y));
      }
      for (const stroke of el.path.strokes) {
        assert(stroke && typeof stroke.closed === 'boolean' && Array.isArray(stroke.points) && stroke.points.length > 0);
        assert(stroke.pressureEnabled === undefined || typeof stroke.pressureEnabled === 'boolean');
        samples += stroke.points.length; assert(samples <= 2000000);
        for (const p of stroke.points) assert(p && finite(p.x) && finite(p.y) && (p.pressure === undefined || (finite(p.pressure, 1) && p.pressure >= 0)));
      }
      if (el.path.label !== undefined) {
        const label = el.path.label;
        assert(label && typeof label.text === 'string' && label.text.length <= 100000);
        for (const key of ['x', 'y', 'w', 'h'] as const) assert(finite(label[key]));
        assert(label.w > 0 && label.h > 0);
      }
    }
  }
}

export function encodeDocument(doc: BoardDocument): Uint8Array<ArrayBuffer> {
  validateDocument(doc);
  const data = new TextEncoder().encode(JSON.stringify(doc));
  if (data.length > MAX_BYTES) throw new Error('画板文件超过 64 MB，请拆分画板后再导出');
  const result = new Uint8Array(HEADER + data.length);
  result.set(MAGIC);
  const view = new DataView(result.buffer);
  view.setUint16(4, 1, true);
  view.setUint32(8, data.length, true);
  view.setUint32(12, crc32(data), true);
  result.set(data, HEADER);
  return result;
}

export function decodeDocument(bytes: Uint8Array): BoardDocument {
  if (bytes.length < HEADER || !MAGIC.every((b, i) => bytes[i] === b)) throw new Error(`这不是有效的${PRODUCT.name}文件`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(4, true) !== 1) throw new Error('暂不支持此画板文件版本');
  const size = view.getUint32(8, true);
  if (size > MAX_BYTES || size !== bytes.length - HEADER) throw new Error('文件不完整或已经损坏');
  const payload = bytes.subarray(HEADER);
  if (crc32(payload) !== view.getUint32(12, true)) throw new Error('文件校验失败，内容可能已损坏');
  let doc: unknown;
  try { doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)); }
  catch { throw new Error('画板数据已损坏'); }
  validateDocument(doc);
  return doc;
}
