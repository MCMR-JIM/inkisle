import { createDocument, type BoardDocument, type PageLayout } from '../core/model';
import { createPaper, paperPositions, parsePageRange } from '../core/paper';
import { CustomSelect } from './custom-select';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class BoardCreation {
  private layout: CustomSelect<PageLayout>;
  private source: { id: string; count: number; name: string } | null = null;
  private generation = 0;
  private creating = false;
  private reading = false;

  constructor(private create: (doc: BoardDocument) => Promise<boolean>) {
    this.layout = new CustomSelect($<HTMLButtonElement>('new-board-layout'), [
      { value: 'infinite', label: '无限画布（不分页）' },
      { value: 'single', label: '单页连续' },
      { value: 'double', label: '双页连续' },
    ], 'infinite', () => {});
    $('new-board-document-button').addEventListener('click', () => $('new-board-document').click());
    $('new-board-document').addEventListener('change', () => { void this.readDocument(); });
    $('new-board-clear-document').addEventListener('click', () => this.clearDocument());
    $('new-board-form').addEventListener('submit', event => { event.preventDefault(); void this.confirm(); });
    const dialog = $<HTMLDialogElement>('new-board-dialog');
    dialog.addEventListener('cancel', event => { if (this.creating) event.preventDefault(); });
    dialog.addEventListener('close', () => { this.generation++; this.source = null; $<HTMLInputElement>('new-board-document').value = ''; });
  }

  open(): void {
    if (this.creating) return;
    this.clearDocument(); this.layout.setValue('infinite');
    $<HTMLDialogElement>('new-board-dialog').showModal();
  }

  private clearDocument(): void {
    this.generation++; this.source = null; this.reading = false;
    $<HTMLInputElement>('new-board-document').value = '';
    $('new-board-document-name').textContent = '不导入文档';
    $('new-board-clear-document').hidden = true; $('new-board-pages').hidden = true;
    $('new-board-status').textContent = ''; this.layout.setOptionDisabled('infinite', false);
    $<HTMLButtonElement>('confirm-new-board').disabled = false;
  }

  private async readDocument(): Promise<void> {
    const file = $<HTMLInputElement>('new-board-document').files?.[0]; if (!file) return;
    const token = ++this.generation; this.reading = true; this.source = null;
    $('new-board-document-name').textContent = file.name; $('new-board-clear-document').hidden = false;
    $('new-board-status').textContent = '正在读取文档…'; $('new-board-pages').hidden = true;
    $<HTMLButtonElement>('confirm-new-board').disabled = true;
    try {
      const pdf = await import('../engine/pdf'), source = await pdf.inspectPdf(file);
      if (token !== this.generation) return;
      this.source = { ...source, name: file.name.replace(/\.pdf$/i, '').slice(0, 100) };
      if (this.layout.value === 'infinite') this.layout.setValue('single');
      this.layout.setOptionDisabled('infinite', true);
      $('new-board-pages').hidden = false;
      $<HTMLInputElement>('new-board-page-range').value = `1-${source.count}`;
      $('new-board-document-name').textContent = `${file.name} · ${source.count} 页`; $('new-board-status').textContent = '';
    } catch (error) {
      if (token === this.generation) $('new-board-status').textContent = error instanceof Error ? error.message : String(error);
    } finally {
      if (token === this.generation) { this.reading = false; $<HTMLButtonElement>('confirm-new-board').disabled = !this.source; }
    }
  }

  private async confirm(): Promise<void> {
    if (this.creating || this.reading) return;
    if ($<HTMLInputElement>('new-board-document').files?.length && !this.source) return;
    this.creating = true;
    $<HTMLDialogElement>('new-board-dialog').dataset.busy = 'true';
    const button = $<HTMLButtonElement>('confirm-new-board'), close = $<HTMLButtonElement>('new-board-close');
    button.disabled = close.disabled = true; this.layout.setDisabled(true);
    for (const id of ['new-board-document-button', 'new-board-clear-document']) $<HTMLButtonElement>(id).disabled = true;
    try {
      const source = this.source, mode = this.layout.value;
      const doc = createDocument(source?.name); doc.paperLayout = mode;
      if (source) {
        const pages = parsePageRange($<HTMLInputElement>('new-board-page-range').value, source.count);
        const pdf = await import('../engine/pdf');
        doc.elements = pdf.importedPages(source.id, pages, 300, 120);
      } else if (mode !== 'infinite') doc.elements = [createPaper()];
      if (doc.elements.length) doc.elements = paperPositions(doc.elements, mode === 'double' ? 'double' : 'single', { x: 300, y: 120 });
      if (await this.create(doc)) $<HTMLDialogElement>('new-board-dialog').close();
    } catch (error) { $('new-board-status').textContent = error instanceof Error ? error.message : String(error); }
    finally {
      this.creating = false; button.disabled = close.disabled = false; this.layout.setDisabled(false);
      delete $<HTMLDialogElement>('new-board-dialog').dataset.busy;
      for (const id of ['new-board-document-button', 'new-board-clear-document']) $<HTMLButtonElement>(id).disabled = false;
    }
  }
}
