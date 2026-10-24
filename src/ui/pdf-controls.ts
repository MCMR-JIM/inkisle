import type { BoardDocument, Bounds, Change } from '../core/model';
import { createPaper, PAPER_GAP, paperAssignments, paperLayoutChanges, paperPages, type PaperLayout } from '../core/paper';
import { elementBounds, unionBounds } from '../core/geometry';
import { downloadBlob, fileName } from '../engine/export';
import { resetPaperResources } from '../engine/paper-render';
import { CustomSelect } from './custom-select';

interface PdfHost {
  document(): BoardDocument;
  apply(changes: Change[], label: string): void;
  settle(): Promise<void>;
  view(bounds: Bounds): void;
  notify(message: string): void;
  invalidate(): void;
  newBoard(name: string): Promise<void>;
}
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class PdfControls {
  private source: { id: string; count: number; name: string } | null = null;
  private target: CustomSelect<'new' | 'current'>;
  private exporting: AbortController | null = null;
  private importing = false;
  private boardId = '';
  private resourceKey = '';
  private current = 0;

  constructor(private host: PdfHost) {
    this.target = new CustomSelect($<HTMLButtonElement>('pdf-import-target'), [{ value: 'new', label: '新画板' }, { value: 'current', label: '当前画板' }], 'new', () => {});
    $('pdf-single').addEventListener('click', () => { void this.layout('single'); });
    $('pdf-double').addEventListener('click', () => { void this.layout('double'); });
    $('pdf-previous').addEventListener('click', () => this.go(this.current - 1));
    $('pdf-next').addEventListener('click', () => this.go(this.current + 1));
    $('pdf-jump').addEventListener('change', () => this.go($<HTMLInputElement>('pdf-jump').valueAsNumber - 1));
    $('pdf-add-paper').addEventListener('click', () => this.addPaper());
    $('pdf-remove-paper').addEventListener('click', () => this.removePaper());
    $('pdf-locate-overflow').addEventListener('click', () => {
      const el = paperAssignments(this.host.document().elements).overflow[0]; if (el) this.host.view(elementBounds(el));
    });
    $('pdf-import-form').addEventListener('submit', event => { event.preventDefault(); void this.confirmImport(); });
    $('pdf-export-form').addEventListener('submit', event => { event.preventDefault(); void this.confirmExport(); });
    $<HTMLDialogElement>('pdf-export-dialog').addEventListener('close', () => this.exporting?.abort());
    $('pdf-cancel-export').addEventListener('click', () => $<HTMLDialogElement>('pdf-export-dialog').close());
  }

  update(): void {
    const doc = this.host.document(), pages = paperPages(doc.elements);
    if (doc.id !== this.boardId) {
      this.boardId = doc.id; this.current = 0;
    }
    const sources = [...new Set(pages.flatMap(p => p.paper?.sourceId ? [p.paper.sourceId] : []))].sort();
    const resourceKey = `${doc.id}:${sources.join(',')}`;
    if (this.resourceKey !== resourceKey) {
      this.resourceKey = resourceKey; resetPaperResources();
      if (sources.length) void import('../engine/pdf').then(pdf => { if (this.resourceKey === resourceKey) { pdf.activatePdf(() => this.host.invalidate()); this.host.invalidate(); } });
    }
    $('pdf-navigation').hidden = !pages.length;
    if (!pages.length) return;
    this.current = Math.min(this.current, pages.length - 1);
    const { overflow } = paperAssignments(doc.elements);
    const double = pages.length > 1 && Math.abs(pages[0].y - pages[1].y) < 1;
    $('pdf-single').setAttribute('aria-pressed', String(!double));
    $('pdf-double').setAttribute('aria-pressed', String(double));
    $<HTMLButtonElement>('pdf-single').disabled = !!overflow.length;
    $<HTMLButtonElement>('pdf-double').disabled = !!overflow.length;
    $('pdf-overflow-status').textContent = overflow.length ? `${overflow.length} 个对象越界，暂不能切换布局` : '外框内可导出';
    $('pdf-locate-overflow').hidden = !overflow.length;
    const field = $<HTMLInputElement>('pdf-jump'); field.max = String(pages.length); field.value = String(this.current + 1);
    $('pdf-page-total').textContent = `/ ${pages.length}`;
    $<HTMLButtonElement>('pdf-previous').disabled = this.current === 0;
    $<HTMLButtonElement>('pdf-next').disabled = this.current === pages.length - 1;
  }

  private async layout(layout: PaperLayout): Promise<void> {
    try { await this.host.settle(); const changes = paperLayoutChanges(this.host.document().elements, layout); this.host.apply(changes, layout === 'single' ? '单页连续布局' : '双页连续布局'); this.update(); this.go(this.current); }
    catch (error) { this.host.notify(error instanceof Error ? error.message : String(error)); }
  }

  private origin(): { x: number; y: number } {
    const pages = paperPages(this.host.document().elements);
    return pages.length ? { x: Math.min(...pages.map(p => elementBounds(p).x)), y: Math.max(...pages.map(p => { const b = elementBounds(p); return b.y + b.h; })) + PAPER_GAP } : { x: 300, y: 120 };
  }

  addPaper(): void {
    const origin = this.origin(), page = createPaper(origin.x + 96, origin.y + 96);
    this.host.apply([{ id: page.id, after: page }], '添加纸张'); this.update(); this.go(paperPages(this.host.document().elements).length - 1);
  }

  private removePaper(): void {
    const doc = this.host.document(), page = paperPages(doc.elements)[this.current]; if (!page) return;
    const { owners } = paperAssignments(doc.elements);
    const removed = doc.elements.filter(el => el.id === page.id || owners.get(el.id)?.id === page.id);
    this.host.apply(removed.map(el => ({ id: el.id, after: null })), '删除纸张及页内内容'); this.update();
  }

  private go(index: number): void {
    const pages = paperPages(this.host.document().elements); if (!pages.length) return;
    this.current = Math.min(pages.length - 1, Math.max(0, Math.round(Number.isFinite(index) ? index : 0)));
    const double = pages.length > 1 && Math.abs(pages[0].y - pages[1].y) < 1;
    const row = double ? pages.slice(Math.floor(this.current / 2) * 2, Math.floor(this.current / 2) * 2 + 2) : [pages[this.current]];
    this.host.view(unionBounds(row)!); this.update();
  }

  async import(file: File): Promise<void> {
    if (this.importing) { this.host.notify('PDF 正在读取，请稍候'); return; }
    this.importing = true; const boardId = this.host.document().id;
    try {
      const pdf = await import('../engine/pdf');
      const source = await pdf.inspectPdf(file);
      if (this.host.document().id !== boardId) throw new Error('画板已切换，请重新导入 PDF');
      this.source = { ...source, name: file.name.replace(/\.pdf$/i, '').slice(0, 100) };
      $('pdf-import-summary').textContent = `${file.name} · ${source.count} 页`;
      $<HTMLInputElement>('pdf-import-range').value = `1-${source.count}`;
      $('pdf-import-status').textContent = '';
      $<HTMLDialogElement>('pdf-import-dialog').showModal();
    } catch (error) { this.host.notify(error instanceof Error ? error.message : String(error)); }
    finally { this.importing = false; }
  }

  private async confirmImport(): Promise<void> {
    if (!this.source || this.importing) return;
    const button = $<HTMLButtonElement>('pdf-confirm-import'); button.disabled = true;
    try {
      const pdf = await import('../engine/pdf'); const range = pdf.parsePageRange($<HTMLInputElement>('pdf-import-range').value, this.source.count);
      const source = this.source;
      if (this.target.value === 'new') await this.host.newBoard(source.name);
      const origin = this.origin(); const pages = pdf.importedPages(this.source.id, range, origin.x, origin.y);
      this.host.apply(pages.map(after => ({ id: after.id, after })), '导入 PDF');
      this.source = null; $<HTMLDialogElement>('pdf-import-dialog').close(); this.update(); this.go(paperPages(this.host.document().elements).length - pages.length);
    } catch (error) { $('pdf-import-status').textContent = error instanceof Error ? error.message : String(error); }
    finally { button.disabled = false; }
  }

  openExport(): void {
    const count = paperPages(this.host.document().elements).length || 1;
    $('pdf-export-summary').textContent = `${count} 页 · A4 适配 · 仅导出外框内内容`;
    $<HTMLInputElement>('pdf-export-range').value = `1-${count}`;
    $('pdf-export-status').textContent = count > 200 ? '每次最多导出 200 页，请选择页码范围' : '';
    $<HTMLDialogElement>('pdf-export-dialog').showModal();
  }

  private async confirmExport(): Promise<void> {
    if (this.exporting) return;
    const button = $<HTMLButtonElement>('pdf-confirm-export'); button.disabled = true;
    const controller = this.exporting = new AbortController();
    try {
      await this.host.settle(); const doc = this.host.document();
      const pdf = await import('../engine/pdf');
      const blob = await pdf.exportPdf(doc, $<HTMLInputElement>('pdf-export-range').value, controller.signal, (done, total) => { $('pdf-export-status').textContent = `正在导出 ${done} / ${total} 页`; });
      downloadBlob(blob, `${fileName(doc.title)}.pdf`); $<HTMLDialogElement>('pdf-export-dialog').close();
    } catch (error) { if (!controller.signal.aborted) $('pdf-export-status').textContent = error instanceof Error ? error.message : String(error); }
    finally { this.exporting = null; button.disabled = false; }
  }
}
