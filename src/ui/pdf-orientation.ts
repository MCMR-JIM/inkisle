import { parsePageRange } from '../core/paper';
import { CustomSelect } from './custom-select';
import { icon } from './icons';

export function pdfOrientationMarkup(id: string): string {
  return `<div id="${id}" class="pdf-orientation" hidden><label for="${id}-angle">页面方向</label><button id="${id}-angle" type="button" aria-label="PDF 页面方向"></button><div class="pdf-preview"><canvas id="${id}-canvas" aria-label="PDF 方向预览" hidden></canvas><span id="${id}-status" role="status"></span></div><div class="pdf-preview-navigation"><button id="${id}-previous" type="button" class="icon-button" aria-label="预览上一页">${icon('arrowLeft', 16)}</button><span id="${id}-page"></span><button id="${id}-next" type="button" class="icon-button" aria-label="预览下一页">${icon('arrowRight', 16)}</button></div><p class="pdf-orientation-hint">保留原页横竖方向，旋转应用于本次导入的全部页面</p></div>`;
}

/** Shared import/create preview; only the displayed page is rasterized. */
export class PdfOrientation {
  private angle: CustomSelect;
  private source: { id: string; count: number } | null = null;
  private pages: number[] = [];
  private index = 0;
  private job: AbortController | null = null;
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private status: HTMLElement;

  constructor(private id: string, range: HTMLInputElement) {
    this.root = document.getElementById(id)!;
    this.canvas = this.element<HTMLCanvasElement>('canvas'); this.status = this.element('status');
    this.angle = new CustomSelect(this.element<HTMLButtonElement>('angle'), [
      { value: 0, label: '原始方向' }, { value: 90, label: '向右旋转 90°' },
      { value: 180, label: '旋转 180°' }, { value: 270, label: '向左旋转 90°' },
    ], 0, () => { void this.render(); });
    this.element('previous').addEventListener('click', () => { this.index--; void this.render(); });
    this.element('next').addEventListener('click', () => { this.index++; void this.render(); });
    range.addEventListener('input', () => {
      if (!this.source) return;
      try { this.pages = parsePageRange(range.value, this.source.count); this.index = 0; void this.render(); }
      catch { /* The form reports invalid ranges on confirmation; keep the last valid preview. */ }
    });
  }

  private element<T extends HTMLElement>(name: string): T { return document.getElementById(`${this.id}-${name}`) as T; }
  get rotation(): number { return this.angle.value; }
  setDisabled(value: boolean): void { this.angle.setDisabled(value); this.element<HTMLButtonElement>('previous').disabled = value || this.index === 0; this.element<HTMLButtonElement>('next').disabled = value || this.index === this.pages.length - 1; }

  load(source: { id: string; count: number }): void {
    this.clear(); this.source = source; this.pages = Array.from({ length: source.count }, (_, i) => i + 1);
    this.angle.setValue(0); this.root.hidden = false; void this.render();
  }

  clear(): void {
    this.job?.abort(); this.job = null; this.source = null; this.pages = []; this.index = 0;
    this.root.hidden = true; this.canvas.width = this.canvas.height = 0;
    this.root.removeAttribute('aria-busy');
  }

  private async render(): Promise<void> {
    if (!this.source) return;
    this.job?.abort(); const job = this.job = new AbortController();
    this.index = Math.max(0, Math.min(this.pages.length - 1, this.index));
    const number = this.pages[this.index];
    this.element('page').textContent = `第 ${number} 页 / ${this.source.count} 页`;
    this.element<HTMLButtonElement>('previous').disabled = this.index === 0;
    this.element<HTMLButtonElement>('next').disabled = this.index === this.pages.length - 1;
    this.canvas.hidden = true; this.status.textContent = '正在生成预览…'; this.root.setAttribute('aria-busy', 'true');
    let surface: HTMLCanvasElement | undefined;
    try {
      const pdf = await import('../engine/pdf'); job.signal.throwIfAborted();
      surface = await pdf.previewPdfPage(this.source.id, number, this.rotation, job.signal);
      job.signal.throwIfAborted();
      this.canvas.width = surface.width; this.canvas.height = surface.height;
      this.canvas.getContext('2d')!.drawImage(surface, 0, 0);
      this.canvas.hidden = false; this.status.textContent = '';
    } catch (error) {
      if (!job.signal.aborted) this.status.textContent = error instanceof Error ? error.message : '预览加载失败，请重试';
    } finally {
      if (surface) surface.width = surface.height = 0;
      if (this.job === job) { this.job = null; this.root.removeAttribute('aria-busy'); }
    }
  }
}
