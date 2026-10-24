import type { Tool } from '../core/model';
import { icon } from './icons';
import { floatingBarMarkup, type FloatingBarItem } from './floating-bar';
import { DEFAULT_ERASER_SIZE, MIN_ERASER_SIZE, MAX_ERASER_SIZE, ERASER_SIZE_STEP } from '../core/eraser';

export interface ToolChild { tool: Tool; label: string; icon: string; key?: string }
export interface ToolFamily { id: string; label: string; icon: string; key?: string; children?: ToolChild[]; options?: FloatingBarItem[]; menuId?: string }

export const TOOL_FAMILIES: ToolFamily[] = [
  { id: 'select', label: '选择工具', icon: 'select', key: 'V' },
  { id: 'hand', label: '抓手', icon: 'hand', key: 'H' },
  { id: 'pen', label: '画笔', icon: 'pen', key: 'P', menuId: 'pressure-setting', options: [
    { type: 'option', label: '画笔', ariaLabel: '普通画笔', icon: 'pen', attributes: { 'data-pen-mode': 'pen', 'aria-pressed': 'true' } },
    { type: 'option', label: '荧光笔', icon: 'highlighter', attributes: { 'data-pen-mode': 'highlighter', 'aria-pressed': 'false' } },
    { type: 'group', items: [
      { type: 'separator' },
      { type: 'switch', id: 'pressure-toggle', labelId: 'pressure-label', label: '压感', checked: true, tooltip: '手写笔感应力度，鼠标慢画粗、快画细' },
    ] },
  ] },
  { id: 'shapes', label: '图形', icon: 'rect', children: [
    { tool: 'recognize', label: '轨迹识别', icon: 'recognize' },
    { tool: 'rect', label: '矩形', icon: 'rect', key: 'R' }, { tool: 'roundrect', label: '圆角矩形', icon: 'roundrect' },
    { tool: 'ellipse', label: '椭圆', icon: 'ellipse', key: 'O' },
    { tool: 'diamond', label: '菱形', icon: 'diamond', key: 'D' }, { tool: 'triangle', label: '三角形', icon: 'triangle' },
    { tool: 'pentagon', label: '五边形', icon: 'pentagon' }, { tool: 'hexagon', label: '六边形', icon: 'hexagon' },
  ] },
  { id: 'lines', label: '直线', icon: 'line', children: [
    { tool: 'line', label: '直线', icon: 'line', key: 'L' }, { tool: 'arrow', label: '箭头', icon: 'arrow', key: 'A' },
    { tool: 'bidirectional-arrow', label: '双向箭头', icon: 'bidirectional-arrow' },
  ] },
  { id: 'text', label: '文字', icon: 'text', key: 'T' },
  { id: 'note', label: '便签', icon: 'note', key: 'N' },
  { id: 'image', label: '插入图片', icon: 'image', key: 'I' },
  { id: 'eraser', label: '橡皮擦', icon: 'eraser', key: 'E', options: [
    { type: 'range', id: 'eraser-size', label: '橡皮大小', min: MIN_ERASER_SIZE, max: MAX_ERASER_SIZE, step: ERASER_SIZE_STEP, value: DEFAULT_ERASER_SIZE, unit: 'px' },
  ] },
];

export function familyForTool(tool: Tool): ToolFamily {
  return TOOL_FAMILIES.find(family => family.id === tool || family.children?.some(child => child.tool === tool)) ?? TOOL_FAMILIES[0];
}

export function childForTool(tool: Tool): ToolChild | undefined {
  return TOOL_FAMILIES.flatMap(family => family.children ?? []).find(child => child.tool === tool);
}

export class ToolFamilyController {
  private openFamily: string | null = null;
  constructor(private onChoose: (tool: Tool) => void) {}
  toggle(family: string): void { this.openFamily = this.openFamily === family ? null : family; }
  close(): void { this.openFamily = null; }
  open(family: string): void { this.openFamily = family; }
  isOpen(family: string): boolean { return this.openFamily === family; }
  choose(tool: Tool): void { this.onChoose(tool); }
}

export function familyButtonMarkup(family: ToolFamily): string {
  return `<button class="tool-button family-button ${family.id === 'select' ? 'active' : ''}" data-family="${family.id}" aria-label="${family.label}" aria-expanded="false" aria-pressed="${family.id === 'select'}" data-tooltip="${family.label}${family.key ? `  ${family.key}` : ''}">${icon(family.icon, 21)}<span class="tool-key">${family.key ?? ''}</span></button>`;
}

export function familyMenuMarkup(family: ToolFamily): string {
  const items = family.options ?? family.children?.map<FloatingBarItem>(child => ({ type: 'option', label: child.label, icon: child.icon, shortcut: child.key, attributes: { 'data-tool-child': child.tool } }));
  if (!items?.length) return '';
  return floatingBarMarkup({ id: family.menuId ?? `tool-menu-${family.id}`, label: `${family.label}工具`, role: 'menu', className: 'tool-submenu', attributes: { 'data-tool-menu': family.id }, items });
}

export function hasFamilyOptions(family: ToolFamily): boolean { return !!(family.options?.length || family.children?.length); }
