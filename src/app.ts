import { COLORS, FILLS, createDocument, createElement, isEmptyUntitled, type BoardDocument, type BoardElement, type BoardMeta, type Tool } from './core/model';
import { validateDocument } from './core/codec';
import { Scene } from './core/scene';
import { hitTest, screenToWorld, unionBounds, zoomAt } from './core/geometry';
import { scaleErasures } from './core/erasure';
import { transformPath } from './core/paths';
import { Repository } from './storage/repository';
import { Writer, type SaveState } from './storage/writer';
import { SnapshotCodec } from './storage/snapshot';
import { Renderer, type RenderState } from './engine/renderer';
import { Interaction, isTextInput } from './engine/interaction';
import { downloadBlob, exportDimensions, exportPNG, exportSVG, fileName, thumbnail, type ExportOptions } from './engine/export';
import { buildShell, swatches } from './ui/shell';
import { TOOL_FAMILIES, ToolFamilyController, familyForTool, hasFamilyOptions } from './ui/tool-families';
import { bindFloatingBars } from './ui/floating-bar';
import { icon } from './ui/icons';
import { CustomSelect } from './ui/custom-select';
import { createDemo } from './demo';
import { MIN_ZOOM, formatZoom } from './core/camera';
import { colorInk, cycleColor, normalizeColor, restorePalette } from './core/colors';
import { ShortcutMap, shortcutLabel } from './core/shortcuts';
import { ColorPicker } from './ui/color-picker';
import { ShortcutSettings } from './ui/shortcut-settings';
import { bindWorkspaceInput } from './ui/workspace-input';
import { bindTooltips } from './ui/tooltip';
import { layerChanges, type LayerAction } from './core/layers';
import { selectedFill, setFillColor, setFillEnabled } from './core/fill';
import { PRODUCT, isBoardFile, isElementClipboard, readPreference, writePreference } from './core/product';
import { SelectionToolbar } from './ui/selection-toolbar';
import { alignmentChanges, cloneGroupPaths, groupChanges, inScope, selectedUnits, ungroupChanges, type Alignment } from './core/groups';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
interface ClipboardData { type: typeof PRODUCT.clipboardType | typeof PRODUCT.legacyClipboardType; elements: BoardElement[] }
const penStyle = (styles: Partial<BoardElement>): Partial<BoardElement> => ({ stroke: styles.stroke, strokeWidth: styles.strokeWidth, opacity: styles.opacity, dash: styles.dash, pressureEnabled: styles.pressureEnabled });

export class App {
  private codec = new SnapshotCodec();
  private repo = new Repository(PRODUCT.database, this.codec);
  private doc: BoardDocument = createDocument();
  private scene = new Scene();
  renderer: Renderer;
  private interaction: Interaction;
  private selectionToolbar: SelectionToolbar;
  private fontSize: CustomSelect;
  private shortcuts = new ShortcutMap(readPreference('shortcuts'));
  private shortcutSettings: ShortcutSettings;
  private colorPickers: { stroke: ColorPicker; fill: ColorPicker };
  private palettes = { stroke: restorePalette(COLORS, readPreference('stroke-colors')), fill: restorePalette(FILLS, readPreference('fill-colors'), true) };
  private writer: Writer | null = null;
  private unsubscribe = () => {};
  private toastTimer = 0;
  private clipboard: BoardElement[] = [];
  private deleteId: string | null = null;
  private ready = false;
  private switching = false;
  private libraryBoards: BoardMeta[] = [];
  private exportingImage = false;
  private libraryMutation: Promise<void> = Promise.resolve();
  private toolFamilies = new ToolFamilyController(tool => this.setTool(tool));
  private familyTools = new Map<string, Tool>();
  private penMode: 'pen' | 'highlighter' = readPreference('pen-mode') === 'highlighter' ? 'highlighter' : 'pen';
  private ordinaryPenStyle: Partial<BoardElement> | null = null;
  private highlighterStyle: Partial<BoardElement> = { stroke: '#f2d64b', strokeWidth: 20, opacity: .35, dash: false, pressureEnabled: false };
  private startup = performance.now();
  private startupPhases: Record<string, number> = {};
  private firstSceneFrameMs = 0;
  startupMs = 0;
  styles: Partial<BoardElement> = { stroke: this.palettes.stroke[0], fillColor: normalizeColor(readPreference('fill-color') ?? '') ?? this.palettes.fill[1], fill: 'transparent', strokeWidth: 2, fontSize: 24, opacity: 1, dash: false, pressureEnabled: readPreference('pressure') !== 'false' };

  constructor(root: HTMLElement) {
    if (readPreference('fill-enabled') === 'true') this.styles.fill = this.styles.fillColor;
    buildShell(root, this.palettes);
    bindFloatingBars(root, $('.toolbar'));
    const position = readPreference('toolbar-position') === 'top' ? 'top' : 'bottom';
    document.documentElement.dataset.toolbarPosition = position;
    $<HTMLSelectElement>('#toolbar-position').value = position;
    bindWorkspaceInput();
    bindTooltips();
    this.fontSize = new CustomSelect($('#font-size'), [14, 18, 20, 24, 32, 40, 56, 72].map(value => ({ value, label: `${value} px` })), 24, value => this.changeStyle({ fontSize: value }));
    const state: RenderState = { camera: { x: 0, y: 0, zoom: 1 }, selected: new Set(), preview: [], hidden: new Set(), marquee: null, cursor: null, tool: 'select', grid: true, dark: readPreference('theme') === 'dark', erasing: new Map() };
    document.documentElement.dataset.theme = state.dark ? 'dark' : 'light';
    this.renderer = new Renderer(this.scene, $('#canvas'), $('#interaction-canvas'), state);
    this.selectionToolbar = new SelectionToolbar(this.renderer);
    this.renderer.onFrame = () => {
      this.selectionToolbar.update();
      if (!this.ready || this.firstSceneFrameMs) return;
      this.firstSceneFrameMs = performance.now() - this.startup;
    };
    this.interaction = this.createInteraction();
    this.colorPickers = {
      stroke: new ColorPicker($('#stroke-palette'), this.palettes.stroke, 'stroke', stroke => this.changeStyle({ stroke }), { preview: (index, color) => this.updatePalette('stroke', index, color, false), change: (index, color) => this.updatePalette('stroke', index, color), reset: () => this.updatePalette('stroke') }),
      fill: new ColorPicker($('#fill-palette'), this.palettes.fill, 'fill', fill => this.changeFillColor(fill), { preview: (index, color) => this.updatePalette('fill', index, color, false), change: (index, color) => this.updatePalette('fill', index, color), reset: () => this.updatePalette('fill') }),
    };
    this.shortcutSettings = new ShortcutSettings($('#help-dialog'), this.shortcuts, () => { writePreference('shortcuts', this.shortcuts.serialize()); this.updateShortcutLabels(); });
    this.bindUI();
    this.updateShortcutLabels();
    this.updateThemeIcon();
    if (window.innerWidth < 640) this.collapseProperties(true);
    this.startupPhases.interfaceMs = performance.now() - this.startup;
    void this.init();
  }

  private createInteraction(): Interaction {
    return new Interaction({
      renderer: this.renderer, styles: this.styles,
      onSelection: () => this.selectionChanged(), onCamera: () => this.cameraChanged(),
      setTool: tool => this.setTool(tool), onContext: event => this.contextMenu(event),
    });
  }

  private async init(): Promise<void> {
    try {
      let phase = performance.now();
      const boards = await this.repo.list();
      this.startupPhases.metadataMs = performance.now() - phase;
      const last = readPreference('last-board');
      const id = boards.find(b => b.id === last)?.id ?? boards[0]?.id;
      phase = performance.now();
      let doc = id ? await this.repo.load(id) : null;
      this.startupPhases.restoreMs = performance.now() - phase;
      if (!doc) {
        doc = createDemo();
        this.initialCamera(doc);
        phase = performance.now();
        // Library previews are generated when the library is opened. Encoding
        // an unseen thumbnail on the cold path delays the first useful frame.
        await this.repo.create(doc);
        this.startupPhases.firstSaveMs = performance.now() - phase;
      }
      this.loadDocument(doc);
    } catch (error) {
      const doc = createDemo(); this.initialCamera(doc); this.loadDocument(doc, false);
      this.saveState('error');
      this.toast(`本地存储暂不可用。你仍可绘制并导出备份。${message(error)}`, 7000);
    }
    this.ready = true;
    this.startupMs = performance.now() - this.startup;
    performance.mark('inkisle-ready');
  }

  private initialCamera(doc: BoardDocument): void {
    const width = this.renderer.width, height = this.renderer.height;
    const scale = Math.min(1, Math.max(0.3, (width - (width < 640 ? 50 : 280)) / 1000), Math.max(0.35, (height - 240) / 630));
    doc.camera = { x: (width - 1440 * scale) / 2, y: (height - 960 * scale) / 2 + 10, zoom: scale };
  }

  private loadDocument(doc: BoardDocument, persistent = true, stored = true): void {
    this.interaction.cancel(); this.interaction.finishEditing();
    this.writer?.stop(); this.unsubscribe();
    this.doc = doc;
    this.scene = new Scene(doc.elements);
    this.renderer.scene = this.scene;
    this.renderer.state.camera = { ...doc.camera };
    this.renderer.state.selected.clear(); this.renderer.state.hidden.clear(); this.renderer.state.preview = [];
    this.renderer.state.groupScope = [];
    this.writer = persistent ? new Writer(this.repo, () => this.document(), (state, error) => {
      this.saveState(state);
      if (state === 'saved') writePreference('last-board', this.doc.id);
      else if (state === 'draft' && readPreference('last-board') === this.doc.id) writePreference('last-board', '');
      if (error) this.toast(`保存暂未成功，点击左上角保存状态可重试。${message(error)}`, 5000);
    }, stored) : null;
    this.unsubscribe = this.scene.subscribe(changes => {
      for (const id of this.renderer.state.selected) if (!this.scene.get(id)) this.renderer.state.selected.delete(id);
      this.writer?.enqueue(changes);
      this.doc.updated = Date.now();
      this.renderer.invalidate(); this.updateDocumentUI();
    });
    $('#board-title').setAttribute('value', doc.title);
    $<HTMLInputElement>('#board-title').value = doc.title;
    this.setTool('select');
    if (stored && persistent) writePreference('last-board', doc.id);
    if (persistent) {
      this.saveState(stored ? 'saved' : 'draft');
      if (stored && isEmptyUntitled(doc)) this.writer?.enqueue([]);
    }
    this.updateDocumentUI(); this.selectionChanged(); this.renderer.invalidate();
  }

  document(): BoardDocument {
    return { ...this.doc, camera: { ...this.renderer.state.camera }, elements: this.scene.elements };
  }

  async prepareClose(): Promise<boolean> {
    // Startup can still be creating/restoring the first board when X is pressed.
    if (!this.ready || this.switching) {
      this.toast('画板仍在打开或切换，请稍后再关闭'); return false;
    }
    await this.libraryMutation;
    this.interaction.finishEditing(); this.interaction.cancel();
    await this.interaction.settle();
    const saved = this.writer ? await this.writer.flush() : true;
    if (!saved) this.toast('保存暂未成功，窗口已保留。请重试保存或导出备份。', 7000);
    return saved;
  }

  private async newBoard(example = false): Promise<void> {
    if (this.switching) return;
    this.switching = true;
    this.interaction.finishEditing();
    try {
      await this.libraryMutation;
      await this.interaction.settle();
      if (this.writer && !await this.writer.flush()) { this.toast('请先重试保存，或导出当前画板备份'); return; }
      const doc = example ? createDemo() : createDocument();
      if (example) this.initialCamera(doc);
      if (example) await this.repo.create(doc, thumbnail(doc.elements));
      this.closeDialogs(); this.closeMenus(); this.loadDocument(doc, true, example);
    } catch (error) { this.toast(`新建失败：${message(error)}`); }
    finally { this.switching = false; }
  }

  private bindUI(): void {
    document.addEventListener('dblclick', event => {
      const swatch = (event.target as HTMLElement).closest<HTMLElement>('[data-color-index]');
      if (!swatch) return;
      const property = swatch.dataset.property as 'stroke' | 'fill';
      this.colorPickers[property].editPreset(+swatch.dataset.colorIndex!);
    });
    document.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      const penMode = target.closest<HTMLElement>('[data-pen-mode]')?.dataset.penMode;
      if (penMode === 'pen' || penMode === 'highlighter') { this.penMode = penMode; writePreference('pen-mode', penMode); this.setTool('pen'); return; }
      const familyElement = target.closest<HTMLElement>('[data-family]');
      if (familyElement) { this.toggleToolFamily(familyElement.dataset.family!); return; }
      const childElement = target.closest<HTMLElement>('[data-tool-child]');
      if (childElement) { this.toolFamilies.choose(childElement.dataset.toolChild as Tool); return; }
      const tool = target.closest<HTMLElement>('[data-tool]')?.dataset.tool as Tool | undefined;
    if (tool) this.setTool(tool);
      const color = target.closest<HTMLElement>('[data-color-index]');
      if (color) {
        if (color.dataset.property === 'fill') this.changeFillColor(color.dataset.color!);
        else this.changeStyle({ stroke: color.dataset.color! });
      }
      const width = target.closest<HTMLElement>('[data-width]')?.dataset.width;
      if (width) this.changeStyle({ strokeWidth: +width });
      const dash = target.closest<HTMLElement>('[data-dash]')?.dataset.dash;
      if (dash) this.changeStyle({ dash: dash === 'true' });
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action) { this.perform(action); this.closeMenus(); }
      const close = target.closest('[data-close]');
      if (close) close.closest('dialog')?.close();
    if (!target.closest('.menu, .tool-submenu, [data-family], #document-menu-button, #export-button')) { this.closeMenus(); }
    });
    document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
      if (event.target === dialog) { const b = dialog.getBoundingClientRect(); if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) dialog.close(); }
    }));
    const on = (id: string, action: () => void) => $(`#${id}`).addEventListener('click', action);
    on('brand-button', () => { void this.showLibrary(); }); on('library-button', () => { void this.showLibrary(); });
    on('new-board-button', () => { void this.newBoard(); }); on('quick-new', () => { void this.newBoard(); });
    on('show-example', () => { void this.newBoard(true); });
    on('document-menu-button', () => this.toggleMenu('document-menu', $('#document-menu-button')));
    on('export-button', () => this.toggleMenu('export-menu', $('#export-button'), true));
    on('theme-button', () => this.toggleTheme()); on('help-button', () => this.shortcutSettings.open());
    on('undo-button', () => this.undo()); on('redo-button', () => this.redo());
    on('zoom-out', () => this.zoom(this.renderer.state.camera.zoom / 1.25)); on('zoom-in', () => this.zoom(this.renderer.state.camera.zoom * 1.25));
    on('zoom-value', () => this.zoom(1)); on('fit-button', () => this.fit());
    on('fill-toggle', () => this.toggleFill());
    on('pressure-toggle', () => {
      const pressure = $('#pressure-toggle').getAttribute('aria-checked') !== 'true';
      this.styles.pressureEnabled = pressure; writePreference('pressure', String(pressure));
      const ink = this.selected().filter(el => !el.locked && (el.kind === 'pen' || el.path?.strokes.some(stroke => stroke.pressureEnabled !== undefined)));
      if (ink.length) this.scene.apply(ink.map(el => ({ id: el.id, after: { ...el, pressureEnabled: pressure, ...(el.path ? { path: { ...el.path, strokes: el.path.strokes.map(stroke => ({ ...stroke, pressureEnabled: pressure })) } } : {}) } })), '修改压感');
      this.selectionChanged();
    });
    on('collapse-properties', () => this.collapseProperties(true)); on('expand-properties', () => this.collapseProperties(false));
    on('save-status', () => { if (this.writer) void this.writer.flush(); });
    on('add-first-note', () => {
      const p = screenToWorld({ x: this.renderer.width / 2 - 80, y: this.renderer.height / 2 - 40 }, this.renderer.state.camera);
      this.interaction.editText(createElement('note', { ...this.styles, ...p, w: 230, h: 200, fontSize: 20 }), true);
    });
    on('library-import', () => $('#import-file').click());
    on('workspace-settings-button', () => $<HTMLDialogElement>('#workspace-settings-dialog').showModal());
    $('#toolbar-position').addEventListener('change', () => {
      const position = $<HTMLSelectElement>('#toolbar-position').value;
      document.documentElement.dataset.toolbarPosition = position; writePreference('toolbar-position', position);
    });
    on('exit-group', () => this.interaction.exitGroup());
    on('group-button', () => this.groupSelection()); on('ungroup-button', () => this.groupSelection(true));
    document.querySelectorAll<HTMLElement>('[data-align]').forEach(button => button.addEventListener('click', () => {
      this.scene.apply(alignmentChanges(this.scene.elements, this.renderer.state.selected, button.dataset.align as Alignment, this.renderer.state.groupScope ?? []), '对齐与分布'); this.selectionChanged();
    }));
    for (const id of ['library-search', 'library-sort']) $(`#${id}`).addEventListener(id === 'library-search' ? 'input' : 'change', () => this.renderLibrary(this.libraryBoards));
    $('#export-options-form').addEventListener('input', () => this.updateExportPreview());
    $('#export-options-form').addEventListener('submit', event => { event.preventDefault(); void this.confirmImageExport(); });
    on('cancel-delete', () => $<HTMLDialogElement>('#confirm-dialog').close());
    on('confirm-delete', () => { void this.confirmDelete(); });
    $<HTMLInputElement>('#board-title').addEventListener('change', () => {
      const input = $<HTMLInputElement>('#board-title');
      this.doc.title = input.value.trim() || '未命名画板'; input.value = this.doc.title;
      this.writer?.enqueue([], { title: this.doc.title }); document.title = `${this.doc.title} — ${PRODUCT.name}`;
    });
    $('#board-title').addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter') $('#board-title').blur(); });
    $('#opacity').addEventListener('input', () => { $('#opacity-value').textContent = `${$<HTMLInputElement>('#opacity').value}%`; });
    $('#opacity').addEventListener('change', () => this.changeStyle({ opacity: +$<HTMLInputElement>('#opacity').value / 100 }));
    $<HTMLInputElement>('#import-file').addEventListener('change', event => { const input = event.target as HTMLInputElement; if (input.files?.[0]) void this.importFile(input.files[0]); input.value = ''; });
    $<HTMLInputElement>('#image-file').addEventListener('change', event => { const input = event.target as HTMLInputElement; if (input.files?.[0]) void this.addImage(input.files[0]); input.value = ''; });
    $('#workspace').addEventListener('dragover', event => { event.preventDefault(); });
    $('#workspace').addEventListener('drop', event => {
      event.preventDefault(); const e = event as DragEvent; const file = e.dataTransfer?.files[0];
      if (file && isBoardFile(file.name)) void this.importFile(file); else if (file?.type.startsWith('image/')) void this.addImage(file, { x: e.clientX, y: e.clientY });
    });
    document.addEventListener('keydown', event => this.keydown(event), true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { this.toolFamilies.close(); this.renderToolState(); }
    });
    document.addEventListener('copy', event => this.copy(event));
    document.addEventListener('cut', event => { if (this.copy(event)) this.deleteSelection(); });
    document.addEventListener('paste', event => this.paste(event));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { this.interaction.finishEditing(); void this.interaction.settle().then(() => this.writer?.flush()); } });
    window.addEventListener('beforeunload', event => { if (this.writer?.pending || this.interaction.isEditing || this.interaction.hasPendingGeometry) { void this.writer?.flush(); event.preventDefault(); } });
  }

  setTool(tool: Tool): void {
    if (tool === 'image') { $('#image-file').click(); return; }
    this.interaction?.finishEditing();
    this.syncPenProfile(tool === 'pen' && this.penMode === 'highlighter');
    this.renderer.state.tool = tool;
    if (tool !== 'select') this.renderer.state.selected.clear();
    const family = familyForTool(tool);
    if (family.children?.length) this.familyTools.set(family.id, tool);
    if (hasFamilyOptions(family)) this.toolFamilies.open(family.id); else this.toolFamilies.close();
    this.renderToolState();
    this.interaction?.updateCursor(); this.renderer.invalidate(false); this.selectionChanged();
  }

  private syncPenProfile(highlighter: boolean): void {
    if (highlighter && !this.ordinaryPenStyle) {
      this.ordinaryPenStyle = penStyle(this.styles); Object.assign(this.styles, this.highlighterStyle);
    } else if (!highlighter && this.ordinaryPenStyle) {
      this.highlighterStyle = penStyle(this.styles); Object.assign(this.styles, this.ordinaryPenStyle); this.ordinaryPenStyle = null;
    }
  }

  private toggleToolFamily(id: string): void {
    const family = TOOL_FAMILIES.find(item => item.id === id)!;
    if (!hasFamilyOptions(family)) { this.setTool(id as Tool); return; }
    if (familyForTool(this.renderer.state.tool).id !== id) {
      this.setTool(this.familyTools.get(id) ?? (id === 'shapes' ? 'rect' : family.children?.[0].tool ?? id as Tool)); return;
    }
    this.toolFamilies.toggle(id);
    this.renderToolMenus();
    if (this.toolFamilies.isOpen(id)) document.querySelector<HTMLElement>(`[data-tool-menu="${id}"] [aria-selected="true"]`)?.focus();
  }

  private renderToolState(): void {
    const activeFamily = familyForTool(this.renderer.state.tool);
    document.querySelectorAll<HTMLElement>('[data-family]').forEach(button => {
      const active = button.dataset.family === activeFamily.id;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll<HTMLElement>('[data-tool-child]').forEach(item => {
      const active = item.dataset.toolChild === this.renderer.state.tool;
      item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active));
    });
    this.renderToolMenus();
  }

  private renderToolMenus(): void {
    const elements = this.selected();
    const inkSelected = elements.length > 0 && elements.every(el => el.kind === 'pen' || el.path?.strokes.some(stroke => stroke.pressureEnabled !== undefined));
    const family = TOOL_FAMILIES.find(family => hasFamilyOptions(family) && this.toolFamilies.isOpen(family.id))?.id ?? (inkSelected ? 'pen' : null);
    document.querySelectorAll<HTMLElement>('[data-tool-menu]').forEach(menu => { menu.hidden = menu.dataset.toolMenu !== family; });
    document.querySelectorAll<HTMLElement>('[data-family]').forEach(button => button.setAttribute('aria-expanded', String(button.dataset.family === family)));
    document.querySelectorAll<HTMLElement>('[data-pen-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.penMode === this.penMode)));
  }

  private selected(): BoardElement[] { return [...this.renderer.state.selected].map(id => this.scene.get(id)).filter((el): el is BoardElement => !!el); }

  private movableSelection(): BoardElement[] {
    return selectedUnits(this.scene.elements, this.renderer.state.selected, this.renderer.state.groupScope ?? []).filter(unit => !unit.elements.some(el => el.locked)).flatMap(unit => unit.elements);
  }

  private selectionChanged(): void {
    const scope = this.renderer.state.groupScope ?? [];
    while (scope.length && !this.scene.elements.some(el => inScope(el, scope))) scope.pop();
    this.renderer.state.groupScope = scope;
    const units = selectedUnits(this.scene.elements, this.renderer.state.selected, scope);
    this.renderer.state.selected = new Set(units.flatMap(unit => unit.elements.map(el => el.id)));
    const elements = this.selected();
    const first = elements[0];
    $('#selection-status').hidden = !elements.length;
    $('#selection-label').textContent = `已选择 ${elements.length} 个元素`;
    if (units.some(unit => unit.group)) $('#selection-label').textContent = `已选择 ${units.length} 个对象 · ${elements.length} 个元素`;
    $<HTMLButtonElement>('#group-button').disabled = units.length < 2 || elements.some(el => el.locked || (el.groupPath?.length ?? 0) >= 32);
    $<HTMLButtonElement>('#ungroup-button').disabled = !units.some(unit => unit.group && !unit.elements.some(el => el.locked));
    for (const id of ['group-button', 'ungroup-button']) $(`#${id}`).hidden = $<HTMLButtonElement>(`#${id}`).disabled;
    $('#alignment-trigger').hidden = units.filter(unit => !unit.elements.some(el => el.locked)).length < 2;
    document.querySelectorAll<HTMLButtonElement>('[data-align]').forEach(button => { button.disabled = units.filter(unit => !unit.elements.some(el => el.locked)).length < (['horizontal', 'vertical'].includes(button.dataset.align!) ? 3 : 2); });
    $('#group-navigation').hidden = !scope.length;
    $('#group-scope-label').textContent = `组合内 · 第 ${scope.length} 层`;
    const style = first ?? this.styles;
    const fillColor = selectedFill(style, selectedFill(this.styles));
    $('#fill-toggle').setAttribute('aria-checked', String(elements.length ? elements.every(el => el.fill !== 'transparent') : this.styles.fill !== 'transparent'));
    $<HTMLButtonElement>('#fill-toggle').disabled = !!elements.length && elements.every(el => el.locked);
    this.renderToolMenus();
    $('#pressure-toggle').setAttribute('aria-checked', String(first ? !!first.pressureEnabled : this.styles.pressureEnabled !== false));
    $<HTMLButtonElement>('#pressure-toggle').disabled = (!!elements.length && elements.every(el => el.locked)) || (this.renderer.state.tool === 'pen' && this.penMode === 'highlighter');
    document.querySelectorAll<HTMLElement>('[data-color-index]').forEach(button => {
      const active = button.dataset.color === (button.dataset.property === 'fill' ? fillColor : style.stroke); button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    this.colorPickers.stroke.setValue(style.stroke ?? '#283e36');
    this.colorPickers.fill.setValue(fillColor);
    document.querySelectorAll<HTMLElement>('[data-width]').forEach(button => button.classList.toggle('active', +button.dataset.width! === style.strokeWidth));
    document.querySelectorAll<HTMLElement>('[data-dash]').forEach(button => button.classList.toggle('active', button.dataset.dash === String(style.dash)));
    $<HTMLInputElement>('#opacity').value = String(Math.round((style.opacity ?? 1) * 100));
    $('#opacity-value').textContent = `${Math.round((style.opacity ?? 1) * 100)}%`;
    const size = style.fontSize ?? 24;
    this.fontSize.setValue(size);
    this.renderer.invalidate(false); this.updateHistory();
  }

  private changeStyle(style: Partial<BoardElement>): void {
    Object.assign(this.styles, style);
    const elements = this.selected().filter(el => !el.locked && Object.entries(style).some(([key, value]) => el[key as keyof BoardElement] !== value));
    if (elements.length) this.scene.apply(elements.map(el => {
      const after = { ...el, ...style };
      if (style.fontSize && el.kind === 'text') {
        const ratio = style.fontSize / el.fontSize;
        after.w *= ratio; after.h *= ratio;
        after.erasures = scaleErasures(el.erasures, ratio, ratio);
        after.path = transformPath(el.path, ratio, ratio);
      }
      return { id: el.id, after };
    }), '修改样式');
    this.selectionChanged();
  }

  private updatePalette(property: 'stroke' | 'fill', index?: number, color?: string, persist = true): void {
    const colors = this.palettes[property];
    if (index !== undefined && color) colors[index] = color;
    else colors.splice(0, colors.length, ...(property === 'stroke' ? COLORS : FILLS));
    if (persist) writePreference(`${property}-colors`, JSON.stringify(colors));
    if (index === undefined) $(`#${property}-colors`).innerHTML = swatches(colors, property);
    else {
      const button = document.querySelector<HTMLElement>(`#${property}-colors [data-color-index="${index}"]`)!;
      const value = colors[index];
      button.dataset.color = value; button.style.setProperty('--swatch', value); button.style.setProperty('--swatch-ink', colorInk(value));
      button.classList.toggle('transparent', value === 'transparent');
      button.setAttribute('aria-label', `${property === 'stroke' ? '描边' : '填充'} ${value === 'transparent' ? '透明' : value}`);
    }
    if (persist) this.selectionChanged();
  }

  private changeFillColor(color: string): void {
    const current = this.selected(), enabled = current.length ? current.every(el => el.fill !== 'transparent') : this.styles.fill !== 'transparent';
    Object.assign(this.styles, setFillColor({ ...this.styles, fill: enabled ? color : 'transparent' }, color));
    const changes = current.filter(el => !el.locked).map(el => ({ id: el.id, after: { ...el, ...setFillColor(el, color) } })).filter(change => change.after.fill !== this.scene.get(change.id)!.fill || change.after.fillColor !== this.scene.get(change.id)!.fillColor);
    this.scene.apply(changes, '修改填充颜色'); this.saveFillPreference(); this.selectionChanged();
  }

  private toggleFill(): void {
    const enabled = $('#fill-toggle').getAttribute('aria-checked') !== 'true', fallback = selectedFill(this.styles);
    const current = this.selected();
    Object.assign(this.styles, setFillEnabled(current[0] ?? this.styles, enabled, fallback));
    const changes = current.filter(el => !el.locked).map(el => ({ id: el.id, after: { ...el, ...setFillEnabled(el, enabled, fallback) } }));
    this.scene.apply(changes, enabled ? '开启填充' : '关闭填充'); this.saveFillPreference(); this.selectionChanged();
  }

  private saveFillPreference(): void {
    writePreference('fill-enabled', String(this.styles.fill !== 'transparent'));
    writePreference('fill-color', selectedFill(this.styles));
  }

  private updateDocumentUI(): void {
    $('#element-count').textContent = `${this.scene.size} 个元素`;
    $('#empty-state').hidden = this.scene.size > 0;
    document.title = `${this.doc.title} — ${PRODUCT.name}`;
    this.updateHistory();
    this.cameraChanged(false);
  }

  private updateHistory(): void {
    $<HTMLButtonElement>('#undo-button').disabled = !this.scene.canUndo;
    $<HTMLButtonElement>('#redo-button').disabled = !this.scene.canRedo;
  }

  private saveState(state: SaveState): void {
    const el = $('#save-status'); el.dataset.state = state;
    el.lastElementChild!.textContent = state === 'draft' ? '空白画板' : state === 'saved' ? '已保存在本机' : state === 'saving' ? '正在保存…' : '保存未成功 · 点击重试';
  }

  private cameraChanged(persist = true): void {
    $('#zoom-value').textContent = formatZoom(this.renderer.state.camera.zoom);
    if (persist && this.ready) this.writer?.enqueue([], { camera: { ...this.renderer.state.camera } }, 650);
  }

  private zoom(value: number): void {
    this.interaction.finishEditing();
    this.renderer.state.camera = zoomAt(this.renderer.state.camera, { x: this.renderer.width / 2, y: this.renderer.height / 2 }, value);
    this.renderer.invalidate(); this.cameraChanged();
  }

  private fit(): void {
    this.interaction.finishEditing();
    const b = unionBounds(this.selected().length ? this.selected() : this.scene.elements);
    if (!b) { this.zoom(1); return; }
    const left = $('#properties').hidden ? 70 : Math.min(255, this.renderer.width * 0.25);
    const w = this.renderer.width - left - 60, h = this.renderer.height - 230;
    const zoom = Math.min(2, Math.max(MIN_ZOOM, Math.min(w / Math.max(1, b.w), h / Math.max(1, b.h))));
    this.renderer.state.camera = { x: left + w / 2 - (b.x + b.w / 2) * zoom, y: 160 + h / 2 - (b.y + b.h / 2) * zoom, zoom };
    this.renderer.invalidate(); this.cameraChanged();
  }

  private undo(): void { this.interaction.finishEditing(); this.interaction.cancel(); this.scene.undo(); this.selectionChanged(); }
  private redo(): void { this.interaction.finishEditing(); this.interaction.cancel(); this.scene.redo(); this.selectionChanged(); }
  private deleteSelection(): void {
    const elements = this.movableSelection();
    if (!elements.length) return;
    this.scene.apply(elements.map(el => ({ id: el.id, after: null })), '删除');
    this.selectionChanged();
  }

  private duplicate(): void { this.insertElements(this.selected()); }

  private groupSelection(ungroup = false): void {
    this.interaction.finishEditing(); this.interaction.cancel();
    const changes = (ungroup ? ungroupChanges : groupChanges)(this.scene.elements, this.renderer.state.selected, this.renderer.state.groupScope ?? []);
    this.scene.apply(changes, ungroup ? '取消组合' : '组合'); this.selectionChanged();
    if (changes.length) this.toast(ungroup ? '已解开一层组合' : '已组合 · 双击进入，Esc 退出；Ctrl + 单击直接选择内部对象');
  }

  private insertElements(elements: BoardElement[], center = false): void {
    if (!elements.length) return;
    const depth = this.renderer.state.groupScope?.length ?? 0;
    if (elements.some(el => (el.groupPath?.length ?? 0) - (center ? 0 : depth) + depth > 32)) { this.toast('组合层数已达上限，请先解开一层再粘贴'); return; }
    const b = unionBounds(elements)!;
    const cameraCenter = screenToWorld({ x: this.renderer.width / 2, y: this.renderer.height / 2 }, this.renderer.state.camera);
    const dx = center ? cameraCenter.x - b.x - b.w / 2 : 24;
    const dy = center ? cameraCenter.y - b.y - b.h / 2 : 24;
    const order = this.scene.elements.at(-1)?.order ?? 0;
    const copies = cloneGroupPaths(elements, this.renderer.state.groupScope ?? [], center ? 0 : this.renderer.state.groupScope?.length ?? 0).map((el, i) => ({ ...el, id: crypto.randomUUID(), x: el.x + dx, y: el.y + dy, order: order + i + 1, locked: false }));
    this.scene.apply(copies.map(el => ({ id: el.id, after: el })), '粘贴');
    this.setTool('select'); this.renderer.state.selected = new Set(copies.map(el => el.id)); this.selectionChanged();
  }

  private reorder(direction: LayerAction): void {
    const changes = layerChanges(this.scene.elements, this.renderer.state.selected, direction, this.renderer.state.groupScope ?? []);
    this.scene.apply(changes, direction === 'front' ? '置顶' : direction === 'back' ? '置底' : direction === 'forward' ? '上移一层' : '下移一层');
  }

  private toggleLock(): void {
    const elements = this.selected(); const locked = !elements.every(el => el.locked);
    this.scene.apply(elements.map(el => ({ id: el.id, after: { ...el, locked } })), locked ? '锁定' : '解锁'); this.selectionChanged();
  }

  private keydown(e: KeyboardEvent): void {
    if (!this.ready || e.defaultPrevented || e.isComposing || isTextInput(e.target) || document.querySelector('dialog[open], .color-picker:not([hidden]), .canvas-eyedropper')) return;
    const target = e.target instanceof Element ? e.target : null;
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const action = this.shortcuts.action(e);
      if (action) { e.preventDefault(); e.stopPropagation(); if (!this.interaction.isGesturing) this.runShortcut(action); }
      return;
    }
    if (target?.closest('[role="combobox"], [role="listbox"]')) return;
    if (e.key === 'Escape') { if (this.interaction.exitGroup()) { e.preventDefault(); return; } this.renderer.state.selected.clear(); this.closeMenus(); this.setTool('select'); return; }
    if ((e.key === 'Enter' || e.key === ' ') && target?.closest('button')) return;
    let action = this.shortcuts.action(e);
    const accelerated = e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.startsWith('Arrow');
    if (!action && accelerated) {
      const base = this.shortcuts.action({ key: e.key, code: e.code });
      if (base?.startsWith('move-')) action = base;
    }
    if (!action || this.interaction.isGesturing && !['undo', 'redo', 'export'].includes(action)) return;
    e.preventDefault(); e.stopPropagation(); this.runShortcut(action, accelerated ? 10 : 1);
  }

  private runShortcut(action: string, amount = 1): void {
    if (action.startsWith('family:')) { this.toggleToolFamily(action.slice(7)); return; }
    if (action.startsWith('tool:')) { this.setTool(action.slice(5) as Tool); return; }
    if (action === 'color-next' || action === 'color-previous') {
      const style = this.selected()[0] ?? this.styles;
      this.changeStyle({ stroke: cycleColor(this.palettes.stroke, style.stroke ?? this.palettes.stroke[0], action === 'color-next' ? 1 : -1) }); return;
    }
    if (action.startsWith('move-')) {
      const dx = action === 'move-right' ? amount : action === 'move-left' ? -amount : 0;
      const dy = action === 'move-down' ? amount : action === 'move-up' ? -amount : 0;
      this.scene.apply(this.movableSelection().map(el => ({ id: el.id, after: { ...el, x: el.x + dx, y: el.y + dy } })), '微调'); this.selectionChanged(); return;
    }
    const actions: Record<string, () => void> = {
      undo: () => this.undo(), redo: () => this.redo(), duplicate: () => this.duplicate(), delete: () => this.deleteSelection(), edit: () => this.interaction.editSelected(),
      'select-all': () => { this.setTool('select'); this.renderer.state.selected = new Set(this.scene.elements.filter(el => inScope(el, this.renderer.state.groupScope ?? [])).map(el => el.id)); this.selectionChanged(); },
      group: () => this.groupSelection(), ungroup: () => this.groupSelection(true),
      'new-board': () => { void this.newBoard(); }, export: () => { void this.export('file'); },
      'zoom-in': () => this.zoom(this.renderer.state.camera.zoom * 1.25), 'zoom-out': () => this.zoom(this.renderer.state.camera.zoom / 1.25), 'zoom-reset': () => this.zoom(1),
      fit: () => this.fit(), grid: () => this.perform('grid'), help: () => this.shortcutSettings.open(), 'send-back': () => this.reorder('back'), 'bring-front': () => this.reorder('front'), 'send-backward': () => this.reorder('backward'), 'bring-forward': () => this.reorder('forward'),
    };
    actions[action]?.();
  }

  private updateShortcutLabels(): void {
    for (const family of TOOL_FAMILIES) {
      const button = document.querySelector<HTMLElement>(`[data-family="${family.id}"]`);
      const key = this.shortcuts.get(`${family.children?.length ? 'family' : 'tool'}:${family.id}`), label = key ? shortcutLabel(key) : '';
      if (button) { button.dataset.tooltip = `${family.label}${label ? `  ${label}` : ''}${family.id === 'hand' ? ' · 空格 + 拖动临时平移 · Ctrl + 滚轮缩放' : ''}`; const hint = button.querySelector('.tool-key'); if (hint) hint.textContent = label; }
      for (const child of family.children ?? []) {
        const item = document.querySelector<HTMLElement>(`[data-tool-child="${child.tool}"]`);
        if (!item) continue;
        const key = this.shortcuts.get(`tool:${child.tool}`), label = key ? shortcutLabel(key) : '';
        item.dataset.tooltip = `${child.label}${label ? `  ${label}` : ''}`;
        let hint = item.querySelector('kbd'); if (!hint) { hint = document.createElement('kbd'); item.append(hint); } hint.textContent = label;
      }
    }
    const hints: Record<string, string> = { new: 'new-board', duplicate: 'duplicate', forward: 'bring-forward', backward: 'send-backward', front: 'bring-front', back: 'send-back', delete: 'delete', edit: 'edit', grid: 'grid', help: 'help', group: 'group', ungroup: 'ungroup' };
    for (const [action, id] of Object.entries(hints)) document.querySelectorAll<HTMLElement>(`[data-action="${action}"] > kbd`).forEach(el => { el.textContent = this.shortcuts.get(id) ? shortcutLabel(this.shortcuts.get(id)) : ''; });
    for (const [id, label, action] of [['group-button', '组合', 'group'], ['ungroup-button', '取消组合', 'ungroup']]) {
      const chord = this.shortcuts.get(action); $(`#${id}`).dataset.tooltip = `${label}${chord ? `  ${shortcutLabel(chord)}` : ''}`;
    }
  }

  private copy(event: ClipboardEvent): boolean {
    if (isTextInput(event.target) || document.querySelector('dialog[open]')) return false;
    const elements = this.selected().map(el => ({ ...el, groupPath: el.groupPath?.slice(this.renderer.state.groupScope?.length ?? 0) }));
    if (!elements.length) {
      event.preventDefault(); window.getSelection()?.removeAllRanges();
      return false;
    }
    event.preventDefault(); this.clipboard = structuredClone(elements);
    event.clipboardData?.setData('text/plain', JSON.stringify({ type: PRODUCT.clipboardType, elements } satisfies ClipboardData));
    this.toast(`已复制 ${elements.length} 个元素`); return true;
  }

  private paste(event: ClipboardEvent): void {
    if (isTextInput(event.target) || document.querySelector('dialog[open]')) return;
    const image = [...(event.clipboardData?.files ?? [])].find(file => file.type.startsWith('image/'));
    if (image) { event.preventDefault(); void this.addImage(image); return; }
    const text = event.clipboardData?.getData('text/plain');
    if (!text && this.clipboard.length) { event.preventDefault(); this.insertElements(this.clipboard, true); return; }
    if (!text) return;
    event.preventDefault();
    try {
      const data: ClipboardData = JSON.parse(text);
      if (isElementClipboard(data.type)) {
        const doc = createDocument(); doc.elements = data.elements; validateDocument(doc);
        this.insertElements(data.elements, true); return;
      }
    } catch { /* Ordinary text is pasted as a text element. */ }
    const point = screenToWorld({ x: this.renderer.width / 2 - 150, y: this.renderer.height / 2 }, this.renderer.state.camera);
    this.interaction.editText(createElement('text', { ...this.styles, ...point, groupPath: this.renderer.state.groupScope?.slice(), text: text.slice(0, 100000), w: 400, h: 60 }), true);
    this.interaction.finishEditing();
  }

  private async export(format: 'file' | 'png' | 'svg', configured = false): Promise<void> {
    if (format !== 'file' && !configured) {
      this.interaction.finishEditing();
      $<HTMLSelectElement>('#export-format').value = format;
      $<HTMLSelectElement>('#export-scope').value = this.selected().length ? 'selection' : 'all';
      $<HTMLOptionElement>('#export-scope option[value="selection"]').disabled = !this.selected().length;
      this.updateExportPreview(); $<HTMLDialogElement>('#export-options-dialog').showModal(); return;
    }
    const exportOptions = configured ? this.imageExportOptions() : {};
    this.interaction.finishEditing();
    await this.interaction.settle();
    const doc = this.document();
    const selectionOnly = configured && $<HTMLSelectElement>('#export-scope').value === 'selection';
    const elements = selectionOnly ? this.selected() : doc.elements;
    try {
      if (format === 'file') {
        downloadBlob(new Blob([await this.codec.encode(doc)], { type: 'application/octet-stream' }), `${fileName(doc.title)}${PRODUCT.extension}`);
        void this.writer?.flush(); this.toast('源文件已导出，随时可以重新打开');
      } else {
        const blob = format === 'png' ? await exportPNG(doc, elements, exportOptions) : exportSVG(doc, elements, exportOptions);
        downloadBlob(blob, `${fileName(doc.title)}.${format}`); this.toast(`${format.toUpperCase()} 已导出${selectionOnly ? ' · 仅选中内容' : ''}`);
        $<HTMLDialogElement>('#export-options-dialog').close();
      }
    } catch (error) { this.toast(message(error)); }
  }

  private imageExportOptions(): ExportOptions {
    return { padding: $<HTMLInputElement>('#export-padding').valueAsNumber, transparent: $<HTMLSelectElement>('#export-background').value === 'transparent', scale: +$<HTMLSelectElement>('#export-scale').value };
  }

  private updateExportPreview(): void {
    const elements = $<HTMLSelectElement>('#export-scope').value === 'selection' ? this.selected() : this.scene.elements;
    const bounds = unionBounds(elements), format = $<HTMLSelectElement>('#export-format').value;
    $('#export-summary').textContent = `整个画板 ${this.scene.size} 个元素 · 已选 ${this.selected().length} 个元素`;
    $<HTMLSelectElement>('#export-scale').disabled = format === 'svg';
    $('#confirm-export').textContent = `导出 ${format.toUpperCase()}`;
    try {
      if (!bounds) throw new Error('当前范围没有内容，请选择其他范围或先画点什么。');
      const size = exportDimensions(bounds, this.imageExportOptions());
      $('#export-dimensions').textContent = format === 'svg' ? `${elements.length} 个元素 · 矢量图可无损缩放` : `${size.width} × ${size.height} px · ${elements.length} 个元素${size.scale < +$<HTMLSelectElement>('#export-scale').value ? ' · 已按大图上限调整倍率' : ''}`;
      $<HTMLButtonElement>('#confirm-export').disabled = this.exportingImage;
    } catch (error) { $('#export-dimensions').textContent = message(error); $<HTMLButtonElement>('#confirm-export').disabled = true; }
  }

  private async confirmImageExport(): Promise<void> {
    const button = $<HTMLButtonElement>('#confirm-export'); if (button.disabled) return;
    if (this.exportingImage) return;
    this.exportingImage = true;
    button.disabled = true;
    const format = $<HTMLSelectElement>('#export-format').value as 'png' | 'svg';
    try { await this.export(format, true); }
    finally { this.exportingImage = false; this.updateExportPreview(); }
  }

  private async importFile(file: File): Promise<void> {
    try {
      if (file.size > 65 * 1024 * 1024) throw new Error('文件超过 64 MB');
      const doc = await this.codec.decode(new Uint8Array(await file.arrayBuffer()));
      this.interaction.finishEditing();
      await this.interaction.settle();
      if (this.writer && !await this.writer.flush()) throw new Error('请先保存或导出当前画板');
      doc.id = crypto.randomUUID(); doc.created = doc.updated = Date.now();
      const stored = !isEmptyUntitled(doc);
      if (stored) await this.repo.create(doc, thumbnail(doc.elements));
      this.closeDialogs(); this.loadDocument(doc, true, stored); this.toast('画板已导入');
    } catch (error) { this.toast(`导入失败：${message(error)}`, 5000); }
  }

  private async addImage(file: File, screen = { x: this.renderer.width / 2, y: this.renderer.height / 2 }): Promise<void> {
    const scene = this.scene;
    let groupPath = this.renderer.state.groupScope?.slice();
    const point = screenToWorld(screen, this.renderer.state.camera);
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('请选择 15 MB 以内的图片');
      if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)) throw new Error('支持 PNG、JPEG、WebP、GIF 和 AVIF 图片');
      const src = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file); });
      const image = new Image(); image.src = src; await image.decode();
      // Reloading the same board also replaces its scene and invalidates this import.
      if (this.scene !== scene) { this.toast('画板已切换，请重新插入图片'); return; }
      if (groupPath?.length) {
        const group = groupPath.at(-1)!;
        const member = scene.elements.find(el => el.groupPath?.includes(group));
        if (!member) { this.toast('组合已变化，请重新插入图片'); return; }
        groupPath = member.groupPath!.slice(0, member.groupPath!.indexOf(group) + 1);
      }
      const scale = Math.min(1, 600 / image.naturalWidth, 500 / image.naturalHeight);
      const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
      const el = createElement('image', { x: point.x - w / 2, y: point.y - h / 2, w, h, src, strokeWidth: 0, radius: 8, groupPath });
      scene.apply([{ id: el.id, after: el }], '插入图片');
      this.renderer.state.selected.clear(); this.selectionChanged();
    } catch (error) { this.toast(message(error)); }
  }

  private toggleTheme(): void {
    this.renderer.state.dark = !this.renderer.state.dark;
    document.documentElement.dataset.theme = this.renderer.state.dark ? 'dark' : 'light';
    writePreference('theme', this.renderer.state.dark ? 'dark' : 'light');
    this.updateThemeIcon(); this.renderer.invalidate();
  }
  private updateThemeIcon(): void { $('#theme-button').innerHTML = icon(this.renderer.state.dark ? 'sun' : 'moon'); }
  private collapseProperties(collapsed: boolean): void { $('#properties').hidden = collapsed; $('#expand-properties').hidden = !collapsed; this.selectionToolbar.update(); }

  private closeMenus(): void { document.querySelectorAll<HTMLElement>('.menu').forEach(menu => { menu.hidden = true; }); }
  private toggleMenu(id: string, anchor: HTMLElement, right = false): void {
    const menu = $(`#${id}`), wasOpen = !menu.hidden;
    this.closeMenus(); if (wasOpen) return;
    const b = anchor.getBoundingClientRect();
    menu.hidden = false; menu.style.top = `${b.bottom + 9}px`;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, right ? b.right - menu.offsetWidth : b.left))}px`;
    if (id === 'export-menu') $('#export-button').dataset.tooltip = this.selected().length ? `导出时可选择整个画板或已选的 ${this.selected().length} 个元素` : '导出当前画板，所有数据保存在本机';
  }

  private contextMenu(event: MouseEvent): void {
    this.closeMenus();
    const point = screenToWorld({ x: event.clientX, y: event.clientY }, this.renderer.state.camera);
    const hit = this.scene.query({ x: point.x - 5, y: point.y - 5, w: 10, h: 10 }).reverse().find(el => hitTest(el, point, 5));
    if (hit && !this.renderer.state.selected.has(hit.id)) { this.setTool('select'); this.interaction.selectElement(hit); }
    const units = selectedUnits(this.scene.elements, this.renderer.state.selected, this.renderer.state.groupScope ?? []);
    for (const action of ['forward', 'backward', 'front', 'back', 'delete']) {
      $<HTMLButtonElement>(`#context-menu [data-action="${action}"]`).disabled = !this.movableSelection().length;
    }
    $<HTMLButtonElement>('#context-menu [data-action="group"]').disabled = units.length < 2 || this.selected().some(el => el.locked);
    $<HTMLButtonElement>('#context-menu [data-action="ungroup"]').disabled = !units.some(unit => unit.group && !unit.elements.some(el => el.locked));
    const menu = $('#context-menu'); menu.hidden = false;
    menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - 255))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 10))}px`;
  }

  private perform(action: string): void {
    const actions: Record<string, () => void> = {
      new: () => { void this.newBoard(); }, library: () => { void this.showLibrary(); }, import: () => $('#import-file').click(),
      'workspace-settings': () => $<HTMLDialogElement>('#workspace-settings-dialog').showModal(),
      group: () => this.groupSelection(), ungroup: () => this.groupSelection(true),
      grid: () => { this.renderer.state.grid = !this.renderer.state.grid; this.renderer.invalidate(); },
      help: () => this.shortcutSettings.open(),
      'export-file': () => { void this.export('file'); }, 'export-png': () => { void this.export('png'); }, 'export-svg': () => { void this.export('svg'); },
      duplicate: () => this.duplicate(), delete: () => this.deleteSelection(), forward: () => this.reorder('forward'), backward: () => this.reorder('backward'), front: () => this.reorder('front'), back: () => this.reorder('back'), lock: () => this.toggleLock(), edit: () => this.interaction.editSelected(),
    };
    actions[action]?.();
  }

  private closeDialogs(): void { document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close()); }

  private async showLibrary(): Promise<void> {
    this.interaction.finishEditing();
    this.closeMenus();
    const dialog = $<HTMLDialogElement>('#library-dialog');
    if (!dialog.open) dialog.showModal();
    try {
      await this.interaction.settle();
      if (this.writer && !await this.writer.flush()) { this.toast('当前画板尚未保存成功，请先重试'); return; }
      // A thumbnail is only rendered when opening the library, never during drawing.
      if (this.writer?.stored) await this.repo.compact(this.document(), thumbnail(this.scene.elements));
      const boards = await this.repo.list();
      this.renderLibrary(boards);
    } catch (error) { this.toast(`无法读取画板：${message(error)}`); }
  }

  private renderLibrary(boards: BoardMeta[]): void {
    this.libraryBoards = boards;
    const query = $<HTMLInputElement>('#library-search').value.trim().toLocaleLowerCase();
    const visible = boards.filter(board => board.title.toLocaleLowerCase().includes(query));
    if ($<HTMLSelectElement>('#library-sort').value === 'title') visible.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN', { numeric: true }));
    $('#board-count').textContent = query ? `${visible.length} / ${boards.length} 块画板` : `${boards.length} 块画板`;
    const list = $('#board-list'); list.replaceChildren();
    if (!visible.length) { const empty = document.createElement('p'); empty.className = 'library-empty'; empty.textContent = query ? '没有找到匹配的画板，试试其他名称。' : '还没有画板，创建一块开始记录。'; list.append(empty); }
    for (const board of visible) {
      const card = document.createElement('div'); card.className = 'board-card';
      const preview = document.createElement('button'); preview.className = 'board-preview'; preview.setAttribute('aria-label', `打开画板 ${board.title}`);
      if (board.thumbnail) { const image = document.createElement('img'); image.src = board.thumbnail; image.alt = ''; preview.append(image); }
      else preview.innerHTML = icon('note', 30);
      preview.addEventListener('click', () => { void this.openBoard(board.id); });
      card.append(preview);
      if (board.id === this.doc.id) { const label = document.createElement('span'); label.className = 'current-label'; label.textContent = '当前画板'; card.append(label); }
      const info = document.createElement('div'); info.className = 'board-card-info';
      const title = document.createElement('input'); title.className = 'board-card-title'; title.value = board.title; title.maxLength = 100; title.setAttribute('aria-label', `画板名称 ${board.title}`);
      title.addEventListener('change', () => { const value = title.value; this.libraryMutation = this.libraryMutation.then(() => this.renameBoard(board.id, value)); });
      title.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); title.value = board.title; title.blur(); } if (event.key === 'Enter') title.blur(); });
      const time = document.createElement('span'); time.textContent = `${board.elementCount} 个元素 · ${new Date(board.updated).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`;
      info.append(title, time); card.append(info);
      const copy = document.createElement('button'); copy.className = 'icon-button board-copy'; copy.setAttribute('aria-label', `复制画板 ${board.title}`); copy.innerHTML = icon('duplicate', 15);
      copy.addEventListener('click', () => { copy.disabled = true; this.libraryMutation = this.libraryMutation.then(() => this.duplicateBoard(board.id)).finally(() => { copy.disabled = false; }); });
      const remove = document.createElement('button'); remove.className = 'icon-button'; remove.setAttribute('aria-label', `删除画板 ${board.title}`); remove.innerHTML = icon('trash', 15);
      remove.addEventListener('click', () => { this.deleteId = board.id; $<HTMLDialogElement>('#confirm-dialog').showModal(); });
      card.append(copy, remove); list.append(card);
    }
  }

  private async renameBoard(id: string, value: string): Promise<void> {
    const title = value.trim() || '未命名画板';
    try {
      if (id === this.doc.id) {
        this.doc.title = title; $<HTMLInputElement>('#board-title').value = title; document.title = `${title} — ${PRODUCT.name}`;
        this.writer?.enqueue([], { title });
        if (this.writer && !await this.writer.flush()) throw new Error('名称尚未保存，请重试');
      } else {
        const doc = await this.repo.load(id); if (!doc) throw new Error('画板已被删除');
        if (isEmptyUntitled({ ...doc, title })) await this.repo.remove(id, true);
        else await this.repo.append(id, [], { title });
      }
      this.renderLibrary(await this.repo.list());
    } catch (error) { this.toast(`重命名失败：${message(error)}`); }
  }

  private async duplicateBoard(id: string): Promise<void> {
    try {
      if (id === this.doc.id) {
        await this.interaction.settle();
        if (this.writer && !await this.writer.flush()) throw new Error('请先保存当前画板');
      }
      const source = await this.repo.load(id); if (!source) throw new Error('画板已被删除');
      const copy = { ...source, id: crypto.randomUUID(), title: `${source.title} 副本`.slice(0, 100), created: Date.now(), updated: Date.now(), elements: cloneGroupPaths(source.elements).map(el => ({ ...el, id: crypto.randomUUID() })) };
      await this.repo.create(copy, thumbnail(copy.elements));
      this.renderLibrary(await this.repo.list()); this.toast('画板副本已创建');
    } catch (error) { this.toast(`复制失败：${message(error)}`); }
  }

  private async openBoard(id: string): Promise<void> {
    if (this.switching) return;
    if (id === this.doc.id) { this.closeDialogs(); return; }
    this.switching = true;
    try {
      await this.libraryMutation;
      this.interaction.finishEditing(); this.interaction.cancel();
      await this.interaction.settle();
      if (this.writer && !await this.writer.flush()) throw new Error('请先保存当前画板');
      const doc = await this.repo.load(id); if (!doc) throw new Error('找不到这块画板');
      this.closeDialogs(); this.loadDocument(doc);
    } catch (error) { this.toast(message(error)); }
    finally { this.switching = false; }
  }

  private async confirmDelete(): Promise<void> {
    const id = this.deleteId; if (!id) return;
    try {
      await this.libraryMutation;
      if (id === this.doc.id) {
        if (this.writer && !await this.writer.flush()) throw new Error('请先重试保存');
        this.writer?.stop();
      }
      await this.repo.remove(id);
      $<HTMLDialogElement>('#confirm-dialog').close();
      if (id === this.doc.id) {
        const boards = await this.repo.list();
        const next = boards[0] ? await this.repo.load(boards[0].id) : null;
        if (next) this.loadDocument(next);
        else this.loadDocument(createDocument(), true, false);
      }
      this.renderLibrary(await this.repo.list()); this.toast('画板已删除');
    } catch (error) { this.toast(message(error)); }
  }

  private toast(text: string, duration = 3000): void {
    const toast = $('#toast'); toast.textContent = text; toast.hidden = false;
    clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => { toast.hidden = true; }, duration);
  }

  /** Read-only diagnostics, deliberately off the input hot path. */
  diagnostics(): object {
    return { startupMs: this.startupMs, firstSceneFrameMs: this.firstSceneFrameMs, startupPhases: this.startupPhases, elements: this.scene.size, visible: this.renderer.visibleCount, lastFrameMs: this.renderer.lastFrameMs, lastWriteMs: this.writer?.lastWriteMs ?? 0, frames: this.renderer.frames, productionDependencies: 0 };
  }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
