import type { BoardDocument } from '../core/model';
import { SnapshotCodec } from './snapshot';
import { AssetStore, MAX_PDF_BYTES, pdfAssets } from './assets';

const SIGNATURE = 'INKB';
const MAX_BUNDLE = 256 * 1024 * 1024;
interface BundleManifest { documentBytes: number; assets: { id: string; bytes: number }[] }

/** Legacy documents retain their existing encoding. PDF boards carry raw originals once. */
export async function exportSource(doc: BoardDocument, codec = new SnapshotCodec(), store: AssetStore = pdfAssets): Promise<Blob> {
  const bytes = await codec.encode(doc);
  const ids = [...new Set(doc.elements.flatMap(el => el.paper?.sourceId ? [el.paper.sourceId] : []))];
  if (!ids.length) return new Blob([bytes], { type: 'application/octet-stream' });
  const blobs = await Promise.all(ids.map(id => store.get(id)));
  const manifest: BundleManifest = { documentBytes: bytes.length, assets: blobs.map((b, i) => ({ id: ids[i], bytes: b.size })) };
  const metadata = new TextEncoder().encode(JSON.stringify(manifest));
  const header = new Uint8Array(8); header.set(new TextEncoder().encode(SIGNATURE)); new DataView(header.buffer).setUint32(4, metadata.length, true);
  const result = new Blob([header, metadata, bytes, ...blobs], { type: 'application/octet-stream' });
  if (result.size > MAX_BUNDLE) throw new Error('画板及 PDF 原件超过 256 MB，请拆分画板');
  return result;
}

export async function importSource(file: Blob, codec = new SnapshotCodec(), store: AssetStore = pdfAssets): Promise<BoardDocument> {
  if (file.size > MAX_BUNDLE) throw new Error('画板文件超过 256 MB');
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (new TextDecoder().decode(header.slice(0, 4)) !== SIGNATURE) {
    if (file.size > 65 * 1024 * 1024) throw new Error('画板文件超过 64 MB');
    return codec.decode(new Uint8Array(await file.arrayBuffer()));
  }
  if (header.length < 8) throw new Error('画板文件不完整');
  const size = new DataView(header.buffer).getUint32(4, true);
  if (size > 1024 * 1024 || 8 + size > file.size) throw new Error('画板资源目录已损坏');
  const manifest = JSON.parse(await file.slice(8, 8 + size).text()) as BundleManifest;
  if (!manifest || typeof manifest !== 'object' || !Number.isSafeInteger(manifest.documentBytes) || manifest.documentBytes < 16 || manifest.documentBytes > 65 * 1024 * 1024 || !Array.isArray(manifest.assets) || manifest.assets.length > 128) throw new Error('画板资源目录已损坏');
  let offset = 8 + size;
  const doc = await codec.decode(new Uint8Array(await file.slice(offset, offset + manifest.documentBytes).arrayBuffer())); offset += manifest.documentBytes;
  const parts: { id: string; blob: Blob }[] = [], ids = new Set<string>();
  for (const asset of manifest.assets) {
    if (!asset || !/^[a-f0-9]{64}$/.test(asset.id) || ids.has(asset.id) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > MAX_PDF_BYTES || offset + asset.bytes > file.size) throw new Error('画板 PDF 资源已损坏');
    ids.add(asset.id); parts.push({ id: asset.id, blob: file.slice(offset, offset + asset.bytes, 'application/pdf') }); offset += asset.bytes;
  }
  if (offset !== file.size || doc.elements.some(el => el.paper?.sourceId && !ids.has(el.paper.sourceId))) throw new Error('画板 PDF 资源不完整');
  // Verify every payload before writing any resource into the local store.
  for (const part of parts) {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await part.blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
    if (hash !== part.id) throw new Error('PDF 原件校验失败');
  }
  for (const part of parts) await store.put(part.blob);
  return doc;
}
