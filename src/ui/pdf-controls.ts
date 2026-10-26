import type { BoardDocument, Bounds, Change, PageLayout } from '../core/model';
import { appendPaperChanges, createPaper, documentPaperLayout, paperAssignments, paperLayoutChanges, paperPages, rotatePaperChanges, type PaperLayout } from '../core/paper';
import { elementBounds, unionBounds } from '../core/geometry';
import { downloadBlob, fileName } from '../engine/export';
import { resetPaperResources } from '../engine/paper-render';
import { PdfOrientation } from './pdf-orientation';

interface PdfHost {
  document(): BoardDocument;
  apply(changes: Change[], label: string): void;
  settle(): Promise<void>;
  view(bounds: Bounds): void;
  notify(message: string): void;
  invalidate(): void;
  setLayout(layout: PageLayout): void;
}
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class PdfControls {
  private source: { id: string; count: number; boardId: string } | null = null;
  private exporting: AbortController | null = null;
  private importing = false;
  private boardId = '';
  private resourceKey = '';
  private current = 0;
  private orientation: PdfOrientation;

  constructor(private host: PdfHost) {
    this.orientation = new PdfOrientation('pdf-import-orientation', $('pdf-import-range'));
    $('pdf-single').addEventListener('click', () => { void this.layout('single'); });
    $('pdf-double').addEventListener('click', () => { void this.layout('double'); });
    $('pdf-previous').addEventListener('click', () => this.focusPage(this.current - 1));
    $('pdf-next').addEventListener('click', () => this.focusPage(this.current + 1));
    $('pdf-jump').addEventListener('change', () => this.focusPage($<HTMLInputElement>('pdf-jump').valueAsNumber - 1));
    $('pdf-remove-paper').addEventListener('click', () => this.removePaper());
    $('pdf-rotate-left').addEventListener('click', () => { void this.rotate(-1); });
    $('pdf-rotate-right').addEventListener('click', () => { void this.rotate(1); });
    $('pdf-locate-overflow').addEventListener('click', () => {
      const el = paperAssignments(this.host.document().elements).overflow[0]; if (el) this.host.view(elementBounds(el));
    });
    $('pdf-import-form').addEventListener('submit', event => { event.preventDefault(); void this.confirmImport(); });
    $<HTMLDialogElement>('pdf-import-dialog').addEventListener('close', () => { this.source = null; this.orientation.clear(); });
    $('pdf-export-form').addEventListener('submit', event => { event.preventDefault(); void this.confirmExport(); });
    $<HTMLDialogElement>('pdf-export-dialog').addEventListener('close', () => this.exporting?.abort());
    $('pdf-cancel-export').addEventListener('click', () => $<HTMLDialogElement>('pdf-export-dialog').close());
    new ResizeObserver(() => document.documentElement.style.setProperty('--page-navigation-height', `${$('pdf-navigation').offsetHeight}px`)).observe($('pdf-navigation'));
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
    document.documentElement.dataset.hasPaper = String(!!pages.length);
    if (!pages.length) return;
    this.current = Math.min(this.current, pages.length - 1);
    const { overflow } = paperAssignments(doc.elements);
    const mode = documentPaperLayout(doc), double = mode === 'double';
    if (doc.paperLayout !== mode) this.host.setLayout(mode);
    $('pdf-single').setAttribute('aria-pressed', String(!double));
    $('pdf-double').setAttribute('aria-pressed', String(double));
    $<HTMLButtonElement>('pdf-single').disabled = !!overflow.length;
    $<HTMLButtonElement>('pdf-double').disabled = !!overflow.length;
    $('pdf-overflow-status').textContent = overflow.length ? `${overflow.length} 个对象越界` : '';
    $('pdf-boundary-status').hidden = !overflow.length;
    $('pdf-locate-overflow').hidden = !overflow.length;
    const field = $<HTMLInputElement>('pdf-jump'); field.max = String(pages.length); field.value = String(this.current + 1);
    $('pdf-page-total').textContent = `/ ${pages.length}`;
    $<HTMLButtonElement>('pdf-previous').disabled = this.current === 0;
    $<HTMLButtonElement>('pdf-next').disabled = this.current === pages.length - 1;
  }

  private async layout(layout: PaperLayout): Promise<void> {
    try { await this.host.settle(); const changes = paperLayoutChanges(this.host.document().elements, layout); this.host.apply(changes, layout === 'single' ? '单页连续布局' : '双页连续布局'); this.host.setLayout(layout); this.update(); this.focusPage(this.current); }
    catch (error) { this.host.notify(error instanceof Error ? error.message : String(error)); }
  }

  addPaper(): void {
    const doc = this.host.document(), mode = documentPaperLayout(doc), layout = mode === 'double' ? 'double' : 'single';
    this.host.apply(appendPaperChanges(doc.elements, [createPaper()], layout), '添加纸张');
    this.host.setLayout(layout); this.update(); this.focusPage(paperPages(this.host.document().elements).length - 1);
  }

  private removePaper(): void {
    const doc = this.host.document(), page = paperPages(doc.elements)[this.current]; if (!page) return;
    const { owners } = paperAssignments(doc.elements);
    const removed = doc.elements.filter(el => el.id === page.id || owners.get(el.id)?.id === page.id);
    this.host.apply(removed.map(el => ({ id: el.id, after: null })), '删除纸张及页内内容'); this.update();
  }

  private async rotate(direction: -1 | 1): Promise<void> {
    try {
      await this.host.settle();
      const doc = this.host.document(), page = paperPages(doc.elements)[this.current]; if (!page) return;
      this.host.apply(rotatePaperChanges(doc.elements, page.id, direction, documentPaperLayout(doc) === 'double' ? 'double' : 'single'), '旋转页面');
      this.update(); this.focusPage(this.current);
    } catch (error) { this.host.notify(error instanceof Error ? error.message : String(error)); }
  }

  focusPage(index = 0): void {
    const pages = paperPages(this.host.document().elements); if (!pages.length) return;
    this.current = Math.min(pages.length - 1, Math.max(0, Math.round(Number.isFinite(index) ? index : 0)));
    const current = pages[this.current], double = documentPaperLayout(this.host.document()) === 'double';
    const row = double ? pages.filter(page => Math.abs(elementBounds(page).y - elementBounds(current).y) < 1) : [current];
    this.host.view(unionBounds(row)!); this.update();
  }

  async import(file: File): Promise<void> {
    if (this.importing) { this.host.notify('PDF 正在读取，请稍候'); return; }
    this.importing = true; const boardId = this.host.document().id;
    try {
      const pdf = await import('../engine/pdf');
      const source = await pdf.inspectPdf(file);
      if (this.host.document().id !== boardId) throw new Error('画板已切换，请重新导入 PDF');
      this.source = { ...source, boardId };
      $('pdf-import-summary').textContent = `${file.name} · ${source.count} 页`;
      $<HTMLInputElement>('pdf-import-range').value = `1-${source.count}`;
      $('pdf-import-status').textContent = '';
      $<HTMLDialogElement>('pdf-import-dialog').showModal();
      this.orientation.load(source);
    } catch (error) { this.host.notify(error instanceof Error ? error.message : String(error)); }
    finally { this.importing = false; }
  }

  private async confirmImport(): Promise<void> {
    if (!this.source || this.importing) return;
    const source = this.source, button = $<HTMLButtonElement>('pdf-confirm-import'); button.disabled = true; this.importing = true;
    this.orientation.setDisabled(true);
    try {
      await this.host.settle();
      const pdf = await import('../engine/pdf'), doc = this.host.document();
      if (doc.id !== source.boardId) throw new Error('画板已切换，请重新导入 PDF');
      if (source !== this.source) return;
      const range = pdf.parsePageRange($<HTMLInputElement>('pdf-import-range').value, source.count);
      const pages = await pdf.importedPages(source.id, range, 0, 0, this.orientation.rotation), existing = paperPages(doc.elements);
      if (this.host.document().id !== source.boardId) throw new Error('画板已切换，请重新导入 PDF');
      if (source !== this.source) return;
      const layout = documentPaperLayout(doc) === 'double' && paperAssignments(doc.elements).overflow.length ? 'double' : 'single';
      const inserted = appendPaperChanges(doc.elements, pages, layout), changes = new Map(inserted.map(change => [change.id, change]));
      if (existing.length && layout === 'single') {
        const combined = [...doc.elements, ...inserted.map(change => change.after!)];
        if (!paperAssignments(combined).overflow.length) for (const change of paperLayoutChanges(combined, layout)) changes.set(change.id, change);
      }
      this.host.apply([...changes.values()], '导入 PDF'); this.host.setLayout(layout);
      $<HTMLDialogElement>('pdf-import-dialog').close(); this.update(); this.focusPage(existing.length);
    } catch (error) { $('pdf-import-status').textContent = error instanceof Error ? error.message : String(error); }
    finally { button.disabled = false; this.importing = false; this.orientation.setDisabled(false); }
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
