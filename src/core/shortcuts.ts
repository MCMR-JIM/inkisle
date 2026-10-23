interface KeyEvent { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; isComposing?: boolean }
export interface ShortcutDefinition { id: string; label: string; key: string; aliases?: string[] }

export const SHORTCUTS: ShortcutDefinition[] = [
  { id: 'color-next', label: '下一个描边颜色', key: 'Tab' },
  { id: 'color-previous', label: '上一个描边颜色', key: 'Shift+Tab' },
  { id: 'tool:select', label: '选择工具', key: 'V' }, { id: 'tool:hand', label: '抓手', key: 'H' },
  { id: 'tool:pen', label: '画笔', key: 'P' }, { id: 'tool:eraser', label: '橡皮擦', key: 'E' },
  { id: 'family:shapes', label: '展开 / 收起图形工具', key: 'Shift+R' },
  { id: 'family:lines', label: '展开 / 收起线条工具', key: 'Shift+L' },
  { id: 'group', label: '组合', key: 'Mod+G' }, { id: 'ungroup', label: '取消组合', key: 'Mod+Shift+G' },
  { id: 'tool:rect', label: '矩形', key: 'R' }, { id: 'tool:roundrect', label: '圆角矩形', key: '' },
  { id: 'tool:recognize', label: '轨迹识别', key: '' }, { id: 'tool:ellipse', label: '椭圆', key: 'O' },
  { id: 'tool:diamond', label: '菱形', key: 'D' }, { id: 'tool:triangle', label: '三角形', key: '' },
  { id: 'tool:pentagon', label: '五边形', key: '' }, { id: 'tool:hexagon', label: '六边形', key: '' },
  { id: 'tool:arrow', label: '箭头', key: 'A' }, { id: 'tool:line', label: '直线', key: 'L' },
  { id: 'tool:bidirectional-arrow', label: '双向箭头', key: '' }, { id: 'tool:text', label: '文字', key: 'T' },
  { id: 'tool:note', label: '便签', key: 'N' }, { id: 'tool:image', label: '插入图片', key: 'I' },
  { id: 'undo', label: '撤销', key: 'Mod+Z' }, { id: 'redo', label: '重做', key: 'Mod+Shift+Z', aliases: ['Mod+Y'] },
  { id: 'select-all', label: '全选', key: 'Mod+A' }, { id: 'duplicate', label: '复制一份', key: 'Mod+D' },
  { id: 'delete', label: '删除选中', key: 'Delete', aliases: ['Backspace'] }, { id: 'edit', label: '编辑文字', key: 'Enter' },
  { id: 'new-board', label: '新建画板', key: 'Mod+Alt+N' }, { id: 'export', label: '导出源文件', key: 'Mod+S' },
  { id: 'zoom-in', label: '放大画布', key: 'Mod+=', aliases: ['Mod+Shift+='] }, { id: 'zoom-out', label: '缩小画布', key: 'Mod+-' },
  { id: 'fit', label: '适应内容', key: 'Shift+1' }, { id: 'zoom-reset', label: '缩放到 100%', key: 'Shift+0' },
  { id: 'grid', label: '显示 / 隐藏网格', key: 'G' }, { id: 'help', label: '快捷键设置', key: 'Shift+/' },
  { id: 'send-backward', label: '下移一层', key: 'Mod+[' }, { id: 'bring-forward', label: '上移一层', key: 'Mod+]' },
  { id: 'send-back', label: '置于底层', key: '[' }, { id: 'bring-front', label: '置于顶层', key: ']' },
  { id: 'move-left', label: '向左微调', key: 'ArrowLeft' }, { id: 'move-right', label: '向右微调', key: 'ArrowRight' },
  { id: 'move-up', label: '向上微调', key: 'ArrowUp' }, { id: 'move-down', label: '向下微调', key: 'ArrowDown' },
];

const codes: Record<string, string> = { Space: 'Space', Slash: '/', Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", Backquote: '`' };

export function shortcutFromEvent(event: KeyEvent): string | null {
  if (event.isComposing || ['Control', 'Meta', 'Alt', 'Shift', 'Dead', 'Process', 'Unidentified'].includes(event.key)) return null;
  const code = event.code ?? '';
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : codes[code] ?? (event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return [event.ctrlKey || event.metaKey ? 'Mod' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+');
}

export function shortcutLabel(chord: string): string {
  return chord ? chord.split('+').map(key => ({ Mod: 'Ctrl', Space: '空格', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' })[key] ?? key).join(' + ') : '未设置';
}

export class ShortcutMap {
  private overrides: Record<string, string> = {};

  constructor(saved: string | null = null) {
    try {
      const data: unknown = JSON.parse(saved ?? '{}');
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const entries = Object.entries(data).filter(([id, key]) => SHORTCUTS.some(item => item.id === id) && typeof key === 'string') as [string, string][];
        for (const [id] of entries) this.overrides[id] = '';
        for (const [id, key] of entries) if (this.set(id, key)) delete this.overrides[id];
        const occupied = new Set<string>();
        for (const item of SHORTCUTS) {
          if (this.keys(item).some(key => occupied.has(key))) delete this.overrides[item.id];
          if (this.keys(item).some(key => occupied.has(key))) this.overrides[item.id] = '';
          for (const key of this.keys(item)) occupied.add(key);
        }
      }
    } catch { /* An optional corrupt preference falls back to the defaults. */ }
  }

  get(id: string): string { return this.overrides[id] ?? SHORTCUTS.find(item => item.id === id)?.key ?? ''; }
  private keys(item: ShortcutDefinition): string[] { return [this.get(item.id), ...(this.overrides[item.id] === undefined ? item.aliases ?? [] : [])].filter(Boolean); }

  action(event: KeyEvent): string | null {
    const chord = shortcutFromEvent(event);
    return SHORTCUTS.find(item => this.keys(item).includes(chord ?? ''))?.id ?? null;
  }

  set(id: string, chord: string): string | null {
    if (!SHORTCUTS.some(item => item.id === id)) return '未知操作';
    if (chord && !/^(Mod\+)?(Alt\+)?(Shift\+)?([A-Z0-9]|F(?:[1-9]|1[0-2])|Tab|Space|Enter|Delete|Backspace|Home|End|PageUp|PageDown|Arrow(?:Left|Right|Up|Down)|[\[\]\/\\=,.;'`-])$/.test(chord)) return '请按一个有效按键或组合键';
    if (['Mod+Tab', 'Mod+Shift+Tab', 'Alt+Tab', 'Alt+Shift+Tab', 'Alt+F4', 'Mod+W', 'Mod+Shift+W'].includes(chord)) return '这个组合键由浏览器或系统保留';
    if (['Space', 'Mod+C', 'Mod+X', 'Mod+V', 'Mod+Enter'].includes(chord)) return '这个组合键用于固定的平移或文字编辑操作';
    const conflict = chord && SHORTCUTS.find(item => item.id !== id && this.keys(item).includes(chord));
    if (conflict) return `已用于“${conflict.label}”，请换一个组合键`;
    this.overrides[id] = chord;
    return null;
  }

  reset(): void { this.overrides = {}; }
  serialize(): string { return JSON.stringify(this.overrides); }
}
