import { colorInk, hexToHSV, hsvToHex, normalizeColor, type HSV } from '../core/colors';
import { icon } from './icons';
import { CanvasEyeDropper } from './canvas-eyedropper';

interface PresetActions { preview(index: number, color: string): void; change(index: number, color: string): void; reset(): void }

/** One linked preset is live; switching commits it and starts a fresh comparison. */
export class ColorPicker {
  private popover: HTMLDivElement;
  private hex: HTMLInputElement;
  private field: HTMLDivElement;
  private hue: HTMLDivElement;
  private before: HTMLElement;
  private after: HTMLElement;
  private error: HTMLElement;
  private presetGrid: HTMLElement;
  private dropper: HTMLButtonElement;
  private applyButton: HTMLButtonElement;
  private selectedPreset: number | null = null;
  private sampling: AbortController | null = null;
  private current = '#283e36';
  private original = '#283e36';
  private draft = '#283e36';
  private hexDirty = false;
  private hsv: HSV = { h: 0, s: 0, v: 1 };

  constructor(private trigger: HTMLButtonElement, private presets: string[], property: string, private onChange: (color: string) => void, private presetActions: PresetActions) {
    const label = property === 'stroke' ? '描边' : '填充';
    this.popover = document.createElement('div');
    this.popover.id = `${property}-picker`; this.popover.className = 'color-picker panel'; this.popover.hidden = true;
    this.popover.setAttribute('role', 'dialog'); this.popover.setAttribute('aria-label', `${label}调色板`);
    this.popover.innerHTML = `
      <div class="color-picker-heading"><span>${label}调色板</span><button type="button" class="tiny-button" data-color-close aria-label="关闭${label}调色板" data-tooltip="保存当前颜色并关闭">${icon('close', 15)}</button></div>
      <div class="color-field" tabindex="0" role="slider" aria-label="饱和度与明度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-tooltip="左右调整饱和度，上下调整明度；按住 Shift 加快"><span class="color-field-thumb"></span></div>
      <div class="color-hue-row"><div class="color-hue" tabindex="0" role="slider" aria-label="色相" aria-valuemin="0" aria-valuemax="360" aria-valuenow="0" aria-orientation="horizontal" data-tooltip="拖动调整色相，也可使用方向键"><span class="color-hue-thumb"></span></div></div>
      <div class="color-value-row"><span class="color-preview" role="img" aria-label="原色与新色对比" data-tooltip="上方是原色，下方是修改后的颜色"><span class="color-before"></span><span class="color-after"></span></span><input id="${property}-hex" class="hex-input" type="text" aria-label="HEX 颜色" data-tooltip="输入 3 位或 6 位十六进制色号" maxlength="7" autocomplete="off" spellcheck="false"/><button type="button" class="eyedropper-button" aria-label="画布取色" data-tooltip="方形画布取色，下方实时显示 HEX；Esc 取消" aria-busy="false">${icon('eyedropper', 17)}</button></div>
      <div class="preset-heading"><span>预设</span><button type="button" class="text-button" data-preset-reset data-tooltip="恢复这组默认预设色">恢复预设</button></div>
      <div class="swatches picker-presets" role="group" aria-label="${label}预设颜色"></div>
      <p id="${property}-color-error" class="color-error" role="alert" hidden></p>
      <div class="color-picker-actions"><button type="button" class="button button-subtle" data-color-cancel data-tooltip="取消当前色的修改，已切换保存的颜色保留">取消</button><button type="button" class="button button-primary" data-color-apply data-tooltip="保存当前颜色并关闭">应用颜色</button></div>`;
    document.body.append(this.popover);
    this.hex = this.popover.querySelector('.hex-input')!;
    this.field = this.popover.querySelector('.color-field')!;
    this.hue = this.popover.querySelector('.color-hue')!;
    this.before = this.popover.querySelector('.color-before')!;
    this.after = this.popover.querySelector('.color-after')!;
    this.error = this.popover.querySelector('.color-error')!;
    this.presetGrid = this.popover.querySelector('.picker-presets')!;
    this.dropper = this.popover.querySelector('.eyedropper-button')!;
    this.applyButton = this.popover.querySelector('[data-color-apply]')!;
    this.createPresets();
    trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-controls', this.popover.id); trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('click', () => this.popover.hidden ? this.open() : this.close());
    this.bindControl(this.field, false); this.bindControl(this.hue, true);
    this.hex.addEventListener('input', () => {
      this.hexDirty = true;
      const value = normalizeColor(this.hex.value);
      if (value) this.setDraft(value, false);
      this.error.hidden = true;
    });
    this.hex.addEventListener('blur', () => { if (!this.popover.hidden) this.flushHex(); });
    this.popover.querySelector('[data-color-cancel]')!.addEventListener('click', () => this.close(true, false));
    this.popover.querySelector('[data-color-close]')!.addEventListener('click', () => this.close());
    this.applyButton.addEventListener('click', () => this.close());
    this.dropper.addEventListener('click', () => { if (this.sampling) this.sampling.abort(); else void this.sample(); });
    this.presetGrid.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-preset-index]');
      if (button) this.selectPreset(+button.dataset.presetIndex!);
    });
    this.popover.querySelector('[data-preset-reset]')!.addEventListener('click', () => {
      this.revert(); this.presetActions.reset();
      this.begin(this.presets.indexOf(this.current));
    });
    this.popover.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter' && event.target === this.hex) { event.preventDefault(); this.flushHex(); this.hex.blur(); }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !this.popover.hidden && !document.querySelector('.canvas-eyedropper')) {
        event.preventDefault(); event.stopPropagation(); this.close(true, false);
      }
    }, true);
    document.addEventListener('pointerdown', event => { if (!this.popover.hidden && !this.popover.contains(event.target as Node) && !trigger.contains(event.target as Node)) this.close(false); });
    window.addEventListener('resize', () => { if (!this.popover.hidden) this.position(); });
    const panelResize = new ResizeObserver(() => { if (!this.popover.hidden) this.position(); });
    panelResize.observe(trigger.closest('#properties')!);
    document.addEventListener('scroll', event => { if (!this.popover.hidden && !this.popover.contains(event.target as Node)) this.position(); }, true);
  }

  setValue(value: string): void {
    this.current = value;
    const custom = value !== 'transparent' && !this.presets.includes(value.toLowerCase());
    this.trigger.classList.toggle('active', custom); this.trigger.setAttribute('aria-pressed', String(custom)); this.trigger.dataset.currentColor = value;
    this.trigger.style.setProperty('--custom-color', value); this.trigger.style.setProperty('--custom-ink', colorInk(value));
  }

  close(focus = true, save = true): void {
    if (this.popover.hidden) return;
    this.sampling?.abort(); this.sampling = null; this.updateDropper();
    if (save) this.commit(); else this.revert();
    this.popover.hidden = true; this.trigger.setAttribute('aria-expanded', 'false');
    if (focus) this.trigger.focus({ preventScroll: true });
  }

  editPreset(index: number): void {
    if (this.popover.hidden) this.open();
    this.selectPreset(index); this.hex.focus({ preventScroll: true }); this.hex.select();
  }

  private begin(index: number): void {
    this.selectedPreset = index >= 0 && index < this.presets.length ? index : null;
    this.original = this.selectedPreset === null ? this.current : this.presets[this.selectedPreset];
    this.draft = this.original; this.hexDirty = false;
    this.hsv = hexToHSV(this.draft, this.hsv.h) ?? { h: this.hsv.h, s: 0, v: 1 };
    this.error.hidden = true; this.render();
  }

  private selectPreset(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.presets.length || index === this.selectedPreset) return;
    this.commit(); this.begin(index);
  }

  private commit(): void {
    this.flushHex();
    if (this.draft === this.original && this.draft === this.current) return;
    if (this.selectedPreset !== null && this.draft !== this.original) this.presetActions.change(this.selectedPreset, this.draft);
    this.onChange(this.draft); this.original = this.draft;
  }

  private revert(): void {
    if (this.selectedPreset !== null && this.presets[this.selectedPreset] !== this.original) this.presetActions.preview(this.selectedPreset, this.original);
    this.draft = this.original; this.hexDirty = false;
  }

  private flushHex(): void {
    if (this.hexDirty) {
      const value = normalizeColor(this.hex.value);
      if (value) this.setDraft(value, false);
    }
    this.hexDirty = false; this.hex.value = this.draft === 'transparent' ? '#ffffff' : this.draft;
  }

  private setDraft(value: string, updateHex = true): void {
    this.draft = value;
    this.hsv = hexToHSV(value, this.hsv.h) ?? { h: this.hsv.h, s: 0, v: 1 };
    if (this.selectedPreset !== null) this.presetActions.preview(this.selectedPreset, value);
    if (updateHex) this.hexDirty = false;
    this.render(updateHex);
  }

  private createPresets(): void {
    this.presets.forEach((_, i) => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.presetIndex = String(i); button.className = 'swatch'; button.innerHTML = icon('check', 13);
      this.presetGrid.append(button);
    });
  }

  private renderPresets(): void {
    this.presets.forEach((color, i) => {
      const button = this.presetGrid.children[i] as HTMLButtonElement;
      button.dataset.color = color; button.classList.toggle('transparent', color === 'transparent'); button.classList.toggle('active', this.selectedPreset === i);
      button.style.setProperty('--swatch', color); button.style.setProperty('--swatch-ink', colorInk(color));
      button.setAttribute('aria-label', `修改第 ${i + 1} 个预设色 ${color === 'transparent' ? '透明' : color}`); button.setAttribute('aria-pressed', String(this.selectedPreset === i));
    });
  }

  private updateDropper(): void {
    const busy = !!this.sampling;
    this.dropper.setAttribute('aria-busy', String(busy)); this.dropper.setAttribute('aria-label', busy ? '取消取色' : '画布取色');
    this.dropper.dataset.tooltip = busy ? '取消取色' : '方形画布取色，下方实时显示 HEX；Esc 取消';
    this.dropper.innerHTML = icon(busy ? 'close' : 'eyedropper', 17); this.applyButton.disabled = busy;
  }

  private async sample(): Promise<void> {
    if (this.sampling) return;
    this.flushHex();
    const controller = new AbortController(); this.sampling = controller; this.error.hidden = true; this.updateDropper();
    try {
      const result = await new CanvasEyeDropper().open({ signal: controller.signal });
      if (this.sampling !== controller || this.popover.hidden) return;
      const value = normalizeColor(result.sRGBHex); if (!value) throw new Error('Invalid sampled color');
      this.setDraft(value);
    } catch (error) {
      if (this.sampling === controller && !controller.signal.aborted && (error as { name?: string })?.name !== 'AbortError') { this.error.textContent = '画布取色未完成，请重试或使用色盘'; this.error.hidden = false; }
    } finally {
      if (this.sampling === controller) { this.sampling = null; this.updateDropper(); if (!this.popover.hidden) this.dropper.focus({ preventScroll: true }); }
    }
  }

  private bindControl(control: HTMLDivElement, isHue: boolean): void {
    let pointer: number | null = null;
    const update = (event: PointerEvent): void => {
      const b = control.getBoundingClientRect(), clamp = (value: number) => Math.max(0, Math.min(1, value));
      const x = clamp((event.clientX - b.left) / Math.max(1, b.width));
      if (isHue) this.hsv.h = x * 360;
      else { this.hsv.s = x; this.hsv.v = 1 - clamp((event.clientY - b.top) / Math.max(1, b.height)); }
      this.controlChanged();
    };
    control.addEventListener('pointerdown', event => { if (event.button !== 0 || pointer !== null) return; event.preventDefault(); this.flushHex(); pointer = event.pointerId; control.focus({ preventScroll: true }); control.setPointerCapture(pointer); update(event); });
    control.addEventListener('pointermove', event => { if (event.pointerId === pointer) update(event); });
    control.addEventListener('pointerup', event => { if (event.pointerId !== pointer) return; update(event); pointer = null; if (control.hasPointerCapture(event.pointerId)) control.releasePointerCapture(event.pointerId); });
    control.addEventListener('pointercancel', () => { pointer = null; }); control.addEventListener('lostpointercapture', () => { pointer = null; });
    control.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); this.flushHex(); const step = event.shiftKey ? 10 : 1;
      if (isHue) {
        if (event.key === 'Home') this.hsv.h = 0;
        else if (event.key === 'End') this.hsv.h = 360;
        else this.hsv.h = Math.max(0, Math.min(360, this.hsv.h + (['ArrowRight', 'ArrowUp'].includes(event.key) ? step : -step)));
      } else {
        if (event.key === 'Home') this.hsv.s = 0;
        else if (event.key === 'End') this.hsv.s = 1;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') this.hsv.s = Math.max(0, Math.min(1, this.hsv.s + (event.key === 'ArrowRight' ? step : -step) / 100));
        else this.hsv.v = Math.max(0, Math.min(1, this.hsv.v + (event.key === 'ArrowUp' ? step : -step) / 100));
      }
      this.controlChanged();
    });
  }

  private controlChanged(): void {
    this.draft = hsvToHex(this.hsv); this.hexDirty = false; this.error.hidden = true;
    if (this.selectedPreset !== null) this.presetActions.preview(this.selectedPreset, this.draft);
    this.render();
  }

  private render(updateHex = true): void {
    const { h, s, v } = this.hsv;
    this.popover.style.setProperty('--picker-hue', hsvToHex({ h, s: 1, v: 1 }));
    this.field.style.setProperty('--picker-saturation', `${s * 100}%`); this.field.style.setProperty('--picker-value', `${(1 - v) * 100}%`); this.hue.style.setProperty('--picker-hue-position', `${h / 360 * 100}%`);
    this.field.setAttribute('aria-valuenow', String(Math.round(s * 100))); this.field.setAttribute('aria-valuetext', `饱和度 ${Math.round(s * 100)}%，明度 ${Math.round(v * 100)}%`);
    this.hue.setAttribute('aria-valuenow', String(Math.round(h))); this.hue.setAttribute('aria-valuetext', `${Math.round(h)} 度`);
    this.before.dataset.color = this.original; this.before.style.backgroundColor = this.original; this.before.classList.toggle('transparent', this.original === 'transparent');
    this.after.dataset.color = this.draft; this.after.style.backgroundColor = this.draft; this.after.classList.toggle('transparent', this.draft === 'transparent');
    this.before.parentElement!.setAttribute('aria-label', `原色 ${this.original}，新色 ${this.draft}`);
    if (updateHex) this.hex.value = this.draft === 'transparent' ? '#ffffff' : this.draft;
    this.renderPresets();
  }

  private position(): void {
    const rect = this.trigger.closest('#properties')!.getBoundingClientRect();
    if (!rect.width) { this.close(false); return; }
    this.popover.style.left = `${rect.right}px`; this.popover.style.top = `${rect.top}px`; this.popover.style.width = `${Math.min(244, Math.max(0, window.innerWidth - rect.right - 8))}px`; this.popover.style.maxHeight = `${Math.max(0, window.innerHeight - rect.top - 8)}px`;
  }

  private open(): void {
    this.sampling?.abort(); this.sampling = null; this.updateDropper(); this.begin(this.presets.indexOf(this.current));
    this.popover.hidden = false; this.trigger.setAttribute('aria-expanded', 'true'); this.position(); this.hex.focus({ preventScroll: true }); this.hex.select();
  }
}
