import type { Tool } from '../core/model';
import { icon } from './icons';

export interface ToolChild { tool: Tool; label: string; icon: string; key?: string }
export interface ToolFamily { id: string; label: string; icon: string; key?: string; children?: ToolChild[] }

export const TOOL_FAMILIES: ToolFamily[] = [
  { id: 'select', label: '选择工具', icon: 'select', key: 'V' },
  { id: 'hand', label: '抓手', icon: 'hand', key: 'H' },
  { id: 'pen', label: '画笔', icon: 'pen', key: 'P' },
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
  { id: 'eraser', label: '橡皮擦', icon: 'eraser', key: 'E' },
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
  isOpen(family: string): boolean { return this.openFamily === family; }
  choose(tool: Tool): void { this.onChoose(tool); }
}

export function familyButtonMarkup(family: ToolFamily): string {
  return `<button class="tool-button family-button ${family.id === 'select' ? 'active' : ''}" data-family="${family.id}" aria-label="${family.label}" aria-expanded="false" aria-pressed="${family.id === 'select'}" data-tooltip="${family.label}${family.key ? `  ${family.key}` : ''}">${icon(family.icon, 21)}<span class="tool-key">${family.key ?? ''}</span></button>`;
}

export function familyMenuMarkup(family: ToolFamily): string {
  if (!family.children?.length) return '';
  return `<div class="tool-submenu panel" id="tool-menu-${family.id}" role="menu" aria-label="${family.label}工具" hidden>${family.children.map(child => `<button role="button" data-tool-child="${child.tool}" aria-label="${child.label}" data-tooltip="${child.label}${child.key ? `  ${child.key}` : ''}">${icon(child.icon, 19)}<span>${child.label}</span>${child.key ? `<kbd>${child.key}</kbd>` : ''}</button>`).join('')}</div>`;
}
