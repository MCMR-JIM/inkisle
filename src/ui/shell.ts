import { COLORS, FILLS } from '../core/model';
import { icon, logo } from './icons';
import { TOOL_FAMILIES, familyButtonMarkup, familyMenuMarkup } from './tool-families';
import { colorInk } from '../core/colors';
import { PRODUCT } from '../core/product';
import { barSeparatorMarkup, floatingBarMarkup, toggleSwitchMarkup } from './floating-bar';

const button = (id: string, glyph: string, label: string, extra = '') => `<button id="${id}" class="icon-button" aria-label="${label}" data-tooltip="${label}" ${extra}>${icon(glyph)}</button>`;

export function buildShell(root: HTMLElement, palettes = { stroke: COLORS, fill: FILLS }): void {
  root.innerHTML = `
    <main id="workspace" aria-label="无限白板">
      <canvas id="canvas" aria-hidden="true"></canvas>
      <canvas id="interaction-canvas" tabindex="0" aria-label="白板画布，使用工具绘制，空格拖动平移"></canvas>
      <textarea id="text-editor" spellcheck="false" aria-label="编辑文字" placeholder="写下你的想法…" hidden></textarea>
    </main>
    <header class="app-header">
      <div class="header-start">
        <button id="brand-button" class="brand" aria-label="打开画板库">${logo}<span>${PRODUCT.name}<span class="brand-dot">.</span></span></button>
        <span class="header-divider"></span>
        <div class="document-info">
          <div class="title-row"><input id="board-title" value="正在打开…" maxlength="100" aria-label="画板名称" spellcheck="false" />${button('document-menu-button', 'chevron', '画板菜单')}</div>
          <button id="save-status" class="save-status" aria-label="保存状态，点击重试"><span class="status-dot"></span><span>正在打开画板</span></button>
        </div>
      </div>
      <div class="header-actions">
        <div class="header-history" role="group" aria-label="历史与快捷键">${button('undo-button', 'undo', '撤销')}${button('redo-button', 'redo', '重做')}${button('help-button', 'keyboard', '快捷键帮助')}</div>${barSeparatorMarkup()}
        ${button('quick-new', 'plus', '新建画板')}
        ${button('theme-button', 'moon', '切换主题')}
        ${button('workspace-settings-button', 'settings', '工作区设置')}
        <button id="library-button" class="button button-subtle" aria-label="我的画板">${icon('library', 17)}<span>我的画板</span></button>
        <button id="export-button" class="button button-primary">${icon('export', 17)}<span>导出</span>${icon('chevron', 14)}</button>
      </div>
    </header>
    <div class="toolbar panel" role="toolbar" aria-label="白板工具">
      ${TOOL_FAMILIES.map((family, i) => `${i === 3 || i === 5 ? barSeparatorMarkup() : ''}${familyButtonMarkup(family)}`).join('')}
      ${barSeparatorMarkup()}<button type="button" id="add-paper-button" class="tool-button" data-action="add-paper" aria-label="添加纸张" data-tooltip="添加纸张">${icon('paperPlus')}</button>
      ${TOOL_FAMILIES.map(familyMenuMarkup).join('')}
    </div>
    <aside id="properties" class="properties panel" aria-label="样式设置">
      <div class="panel-heading"><span>${icon('settings', 16)}<span id="property-title">样式设置</span></span><button id="collapse-properties" class="tiny-button" aria-label="收起样式">${icon('minus', 15)}</button></div>
      <div id="property-content">
        <div class="property-group"><div class="color-group-heading"><span id="stroke-label">描边</span><button id="stroke-palette" class="palette-button" type="button" aria-label="描边调色板" aria-pressed="false">${icon('palette', 16)}</button></div><div class="swatches" id="stroke-colors" role="group" aria-labelledby="stroke-label">${swatches(palettes.stroke, 'stroke')}</div></div>
        <div class="property-group"><div class="color-group-heading"><span id="fill-label">填充</span><div class="fill-heading-actions">${toggleSwitchMarkup('fill-toggle', 'fill-label', false, '关闭填充显示透明，开启填充使用选中的颜色')}<button id="fill-palette" class="palette-button" type="button" aria-label="填充调色板" aria-pressed="false">${icon('palette', 16)}</button></div></div><div class="swatches" id="fill-colors" role="group" aria-labelledby="fill-label">${swatches(palettes.fill, 'fill')}</div></div>
        <div class="property-group"><label>线条粗细</label><div class="segmented" id="stroke-widths">${[1, 2, 4, 7].map(w => `<button data-width="${w}" aria-label="线宽 ${w}" class="${w === 2 ? 'active' : ''}"><span style="height:${Math.min(w, 5)}px"></span></button>`).join('')}</div></div>
        <div class="property-group property-row"><label>线条样式</label><div class="mini-segmented"><button data-dash="false" class="active" aria-label="实线">━</button><button data-dash="true" aria-label="虚线">┄</button></div></div>
        <div class="property-group property-row"><label for="font-size">文字大小</label><button id="font-size" aria-label="文字大小"></button></div>
        <div class="property-group"><label for="opacity">不透明度 <output id="opacity-value">100%</output></label><input id="opacity" type="range" min="10" max="100" value="100" aria-label="不透明度"/></div>
        <div class="property-footnote">${icon('bolt', 13)}<span>轻一点，让想法快一点。</span></div>
      </div>
    </aside>
    <div id="selection-status" class="visually-hidden" role="status" hidden><span id="selection-label"></span></div>
    ${floatingBarMarkup({ id: 'selection-toolbar', label: '选区操作', className: 'selection-toolbar', layout: 'compact', spaceActivates: true, items: [
      { type: 'option', label: '组合', attributes: { id: 'group-button' } },
      { type: 'option', label: '解组', attributes: { id: 'ungroup-button' } },
      { type: 'option', label: '对齐与分布', endIcon: 'chevron', attributes: { id: 'alignment-trigger', 'aria-expanded': 'false', 'aria-controls': 'alignment-controls' } },
    ], contentAfter: floatingBarMarkup({ id: 'alignment-controls', label: '对齐与分布', className: 'selection-alignment-menu', role: 'group', layout: 'grid', spaceActivates: true, items: [['left', '左对齐'], ['center', '水平居中'], ['right', '右对齐'], ['top', '顶端对齐'], ['middle', '垂直居中'], ['bottom', '底端对齐'], ['horizontal', '水平等距'], ['vertical', '垂直等距']].map(([action, label]) => ({ type: 'option', label, attributes: { 'data-align': action } })) }) })}
    <button id="expand-properties" class="panel icon-button expand-properties" aria-label="展开样式" hidden>${icon('settings')}</button>
    <div id="group-navigation" class="group-navigation panel" hidden><span id="group-scope-label"></span><button id="exit-group" class="button button-subtle">退出一层 <kbd>Esc</kbd></button></div>
    <div id="empty-state" class="empty-state" hidden><div class="empty-mark">${logo}</div><h1>好想法，在${PRODUCT.name}生长</h1><p>随手画一笔，或按 <kbd>N</kbd> 贴下第一个灵感</p><div><button class="button button-subtle" id="add-first-note">${icon('note', 16)}贴一张便签</button><button class="text-button" id="show-example">看看示例 ${icon('arrowRight', 15)}</button></div></div>
    <div class="bottom-left"><span class="local-badge"><span></span>本地优先 <span class="badge-divider">/</span> 自由创作</span></div>
    <div class="bottom-right"><span id="element-count">0 个元素</span><div class="zoom-controls panel"><div class="zoom-steps">${button('zoom-out', 'minus', '缩小')}<button id="zoom-value" class="zoom-value" aria-label="缩放比例">100%</button>${button('zoom-in', 'plus', '放大')}</div>${barSeparatorMarkup()}${button('fit-button', 'fit', '适应画布')}</div></div>
    <div class="menu panel" id="document-menu" hidden>
      <button data-action="new">${icon('plus', 17)}新建画板<kbd>Ctrl Alt N</kbd></button>
      <button data-action="library">${icon('library', 17)}我的画板</button>
      <button data-action="import">${icon('import', 17)}导入 ${PRODUCT.extension} 文件</button>
      <button data-action="import-pdf">${icon('import', 17)}导入 PDF</button>
      <hr/><button data-action="grid">${icon('grid', 17)}显示 / 隐藏网格<kbd>G</kbd></button>
      <button data-action="help">${icon('keyboard', 17)}快捷键帮助<kbd>?</kbd></button>
      <button data-action="workspace-settings">${icon('settings', 17)}工作区设置</button>
    </div>
    <div class="menu panel export-menu" id="export-menu" hidden>
      <div class="menu-title">带走你的好想法</div>
      <button data-action="export-file">${icon('export', 17)}${PRODUCT.name}源文件<span>${PRODUCT.extension}</span></button>
      <button data-action="export-png">${icon('image', 17)}导出高清图片<span>PNG</span></button>
      <button data-action="export-svg">${icon('rect', 17)}导出矢量图<span>SVG</span></button>
      <button data-action="export-pdf">${icon('export', 17)}导出文档<span>PDF</span></button>
    </div>
    <div class="menu panel" id="context-menu" hidden>
      <button data-action="edit">${icon('text', 17)}编辑文字<kbd>Enter</kbd></button>
      <button data-action="duplicate">${icon('duplicate', 17)}复制元素<kbd>Ctrl D</kbd></button>
       <button data-action="forward">${icon('layer-up', 17)}上移一层<kbd>Ctrl ]</kbd></button>
       <button data-action="backward">${icon('layer-down', 17)}下移一层<kbd>Ctrl [</kbd></button>
       <button data-action="front">${icon('front', 17)}置于顶层<kbd>]</kbd></button>
       <button data-action="back">${icon('back', 17)}置于底层<kbd>[</kbd></button>
      <button data-action="lock">${icon('lock', 17)}锁定 / 解锁</button>
      <button data-action="group">${icon('rect', 17)}组合<kbd>Ctrl G</kbd></button>
      <button data-action="ungroup">${icon('rect', 17)}取消组合<kbd>Ctrl Shift G</kbd></button>
      <hr/><button data-action="delete" class="danger">${icon('trash', 17)}删除元素<kbd>Del</kbd></button>
    </div>
    <dialog id="library-dialog" class="dialog library-dialog" aria-labelledby="library-title"><div class="dialog-header"><div><h2 id="library-title">我的画板</h2><p>你的画板，安静地保存在这台设备上。点击名称即可修改。</p></div><button data-close class="icon-button" aria-label="关闭画板库">${icon('close')}</button></div><div class="library-actions"><button class="button button-primary" id="new-board-button" aria-label="新建画板">${icon('plus', 17)}新建画板</button><button class="button button-subtle" id="library-import">${icon('import', 17)}导入画板</button><span id="board-count"></span></div><div class="library-search"><input id="library-search" type="search" aria-label="搜索画板" placeholder="搜索画板名称"/><button type="button" id="library-sort" aria-label="画板排序"></button></div><div id="board-list" class="board-list"></div><div class="dialog-footer">${icon('leaf', 15)}没有云端，没有打扰。只有你和你的想法。</div></dialog>
    <dialog id="new-board-dialog" class="dialog document-dialog" aria-labelledby="new-board-title"><div class="dialog-header"><h2 id="new-board-title">新建画板</h2><button id="new-board-close" type="button" data-close class="icon-button" aria-label="取消新建画板">${icon('close')}</button></div><form id="new-board-form" class="pdf-fields"><label for="new-board-layout">布局</label><button type="button" id="new-board-layout" aria-label="新画板布局"></button><label for="new-board-document-button">初始文档</label><div class="new-board-document"><button type="button" id="new-board-document-button" class="button button-subtle">${icon('import', 16)}选择 PDF</button><span id="new-board-document-name">不导入文档</span><button type="button" id="new-board-clear-document" class="icon-button" aria-label="移除初始文档" hidden>${icon('close', 16)}</button></div><div id="new-board-pages" hidden><label for="new-board-page-range">导入页码</label><input id="new-board-page-range" placeholder="例如 1-5,8"/></div><p id="new-board-status" role="status"></p><button type="submit" id="confirm-new-board" class="button button-primary">创建画板</button></form><input id="new-board-document" type="file" accept=".pdf" hidden/></dialog>
    <dialog id="workspace-settings-dialog" class="dialog settings-dialog" aria-labelledby="workspace-settings-title"><div class="dialog-header"><h2 id="workspace-settings-title">工作区设置</h2><button data-close class="icon-button" aria-label="关闭工作区设置">${icon('close')}</button></div><div class="settings-fields"><label for="toolbar-position">工具栏位置</label><button type="button" id="toolbar-position" aria-label="工具栏位置"></button></div><div class="dialog-footer"><span>${PRODUCT.name} v${PRODUCT.version}</span></div></dialog>
    <dialog id="export-options-dialog" class="dialog export-options-dialog" aria-labelledby="export-options-title"><div class="dialog-header"><div><h2 id="export-options-title">导出图片</h2><p id="export-summary"></p></div><button data-close class="icon-button" aria-label="关闭导出设置">${icon('close')}</button></div><form id="export-options-form" class="export-fields"><label for="export-scope">导出范围</label><button type="button" id="export-scope" aria-label="导出范围"></button><label for="export-format">文件格式</label><button type="button" id="export-format" aria-label="文件格式"></button><label for="export-background">背景</label><button type="button" id="export-background" aria-label="背景"></button><label for="export-padding">留白（画布单位）</label><input id="export-padding" type="number" min="0" max="500" value="48" required/><label for="export-scale">图片倍率</label><button type="button" id="export-scale" aria-label="图片倍率"></button><p id="export-dimensions" class="export-dimensions" role="status"></p><button id="confirm-export" class="button button-primary" type="submit">导出 PNG</button></form></dialog>
    <dialog id="help-dialog" class="dialog help-dialog" aria-labelledby="shortcut-title"><div class="dialog-header"><div><h2 id="shortcut-title">快捷键</h2><p>按你的习惯设置，让创作更顺手。</p></div><button data-close class="icon-button" aria-label="关闭帮助">${icon('close')}</button></div><div class="shortcut-settings-heading"><p id="shortcut-status" role="status">点击右侧键位，按下新的组合键即可修改</p><button id="reset-shortcuts" class="text-button">恢复默认</button></div><div id="shortcut-list" class="shortcut-list"></div><div class="help-tip">${icon('info', 17)}<span>空格 + 拖动平移 · Shift 多选 / 约束 · Ctrl + 滚轮缩放<br/>Ctrl C / X / V 复制、剪切、粘贴 · Ctrl Enter 完成文字 · Esc 取消<br/>macOS 的 Ctrl 对应 Command。填充颜色通过点击选择。</span></div><div class="dialog-footer"><span>快捷键自动保存在本机</span><span>${PRODUCT.name} v${PRODUCT.version}</span></div></dialog>
    <dialog id="confirm-dialog" class="dialog confirm-dialog"><h2>删除这块画板？</h2><p>此操作无法撤销。你可以先导出一份源文件。</p><div><button id="cancel-delete" class="button button-subtle">保留画板</button><button id="confirm-delete" class="button button-danger">删除画板</button></div></dialog>
    <div id="toast" class="toast" role="status" hidden></div>
    ${floatingBarMarkup({ id: 'pdf-navigation', label: '纸张与页码', className: 'pdf-navigation', layout: 'compact', items: [{ type: 'group', items: [
      { type: 'option', label: '单页', ariaLabel: '单页连续布局', attributes: { id: 'pdf-single' } },
      { type: 'option', label: '双页', ariaLabel: '双页连续布局', attributes: { id: 'pdf-double' } },
      { type: 'separator' },
      { type: 'option', label: '删页', ariaLabel: '删除本页及页内内容', attributes: { id: 'pdf-remove-paper' } },
    ] }], contentAfter: `<div class="pdf-page-controls">${button('pdf-previous', 'arrowLeft', '上一页')}<div class="pdf-page-jump"><label for="pdf-jump" class="visually-hidden">页码</label><input id="pdf-jump" type="number" min="1" value="1" aria-label="跳转 PDF 页码"/><span id="pdf-page-total"></span></div>${button('pdf-next', 'arrowRight', '下一页')}</div><div class="pdf-boundary-status" id="pdf-boundary-status" hidden><span id="pdf-overflow-status" role="status"></span><button type="button" id="pdf-locate-overflow" class="text-button" hidden>定位越界</button></div>` })}
    <dialog id="pdf-import-dialog" class="dialog document-dialog" aria-labelledby="pdf-import-title"><div class="dialog-header"><h2 id="pdf-import-title">导入 PDF</h2><button type="button" data-close class="icon-button" aria-label="关闭 PDF 导入">${icon('close')}</button></div><form id="pdf-import-form" class="pdf-fields"><p id="pdf-import-summary"></p><label for="pdf-import-range">导入页码</label><input id="pdf-import-range" placeholder="例如 1-5,8" required/><p id="pdf-import-status" role="status"></p><button id="pdf-confirm-import" class="button button-primary" type="submit">导入当前画板</button></form></dialog>
    <dialog id="pdf-export-dialog" class="dialog document-dialog" aria-labelledby="pdf-export-title"><div class="dialog-header"><h2 id="pdf-export-title">导出 PDF</h2><button type="button" data-close class="icon-button" aria-label="关闭 PDF 导出">${icon('close')}</button></div><form id="pdf-export-form" class="pdf-fields"><p id="pdf-export-summary"></p><label for="pdf-export-range">导出页码</label><input id="pdf-export-range" placeholder="例如 1-5,8" required/><p id="pdf-export-status" role="status"></p><div class="pdf-export-actions"><button type="button" id="pdf-cancel-export" class="button button-subtle">取消</button><button id="pdf-confirm-export" class="button button-primary" type="submit">导出 PDF</button></div></form></dialog>
    <input type="file" id="import-file" accept="${PRODUCT.extension},${PRODUCT.legacyExtension},.pdf" hidden />
    <input type="file" id="image-file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden />
  `;
}

export function swatches(colors: string[], property: string): string {
  return colors.map((color, i) => `<button class="swatch ${color === 'transparent' ? 'transparent' : ''} ${i === 0 ? 'active' : ''}" style="--swatch:${color};--swatch-ink:${colorInk(color)}" data-color="${color}" data-property="${property}" data-color-index="${i}" data-tooltip="双击编辑此预设色" aria-label="${property === 'stroke' ? '描边' : '填充'} ${color === 'transparent' ? '透明' : color}" aria-pressed="${i === 0}">${icon('check', 13)}</button>`).join('');
}
