import { COLORS, FILLS } from '../core/model';
import { icon, logo } from './icons';
import { TOOL_FAMILIES, familyButtonMarkup, familyMenuMarkup } from './tool-families';
import { colorInk } from '../core/colors';
import { PRODUCT } from '../core/product';

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
        ${button('quick-new', 'plus', '新建画板')}
        ${button('theme-button', 'moon', '切换主题')}
        ${button('workspace-settings-button', 'settings', '工作区设置')}
        <button id="library-button" class="button button-subtle">${icon('library', 17)}<span>我的画板</span></button>
        <button id="export-button" class="button button-primary">${icon('export', 17)}<span>导出</span>${icon('chevron', 14)}</button>
      </div>
    </header>
    <div class="toolbar panel" role="toolbar" aria-label="白板工具">
      ${TOOL_FAMILIES.map((family, i) => `${i === 3 || i === 5 ? '<span class="tool-separator"></span>' : ''}${familyButtonMarkup(family)}`).join('')}
      ${TOOL_FAMILIES.map(familyMenuMarkup).join('')}
    </div>
    <aside id="properties" class="properties panel" aria-label="样式设置">
      <div class="panel-heading"><span>${icon('settings', 16)}<span id="property-title">画笔与样式</span></span><button id="collapse-properties" class="tiny-button" aria-label="收起样式">${icon('minus', 15)}</button></div>
      <div id="property-content">
        <div class="property-group"><div class="color-group-heading"><span id="stroke-label">描边</span><button id="stroke-palette" class="palette-button" type="button" aria-label="描边调色板" aria-pressed="false">${icon('palette', 16)}</button></div><div class="swatches" id="stroke-colors" role="group" aria-labelledby="stroke-label">${swatches(palettes.stroke, 'stroke')}</div></div>
        <div class="property-group"><div class="color-group-heading"><span id="fill-label">填充</span><div class="fill-heading-actions"><button id="fill-toggle" class="pressure-toggle" type="button" role="switch" aria-checked="false" aria-labelledby="fill-label" data-tooltip="关闭填充显示透明，开启填充使用选中的颜色"><span></span></button><button id="fill-palette" class="palette-button" type="button" aria-label="填充调色板" aria-pressed="false">${icon('palette', 16)}</button></div></div><div class="swatches" id="fill-colors" role="group" aria-labelledby="fill-label">${swatches(palettes.fill, 'fill')}</div></div>
        <div class="property-group"><label>线条粗细</label><div class="segmented" id="stroke-widths">${[1, 2, 4, 7].map(w => `<button data-width="${w}" aria-label="线宽 ${w}" class="${w === 2 ? 'active' : ''}"><span style="height:${Math.min(w, 5)}px"></span></button>`).join('')}</div></div>
        <div id="pressure-setting" class="property-group pressure-setting" hidden><div class="property-row"><label id="pressure-label" for="pressure-toggle">压感</label><button id="pressure-toggle" class="pressure-toggle" type="button" role="switch" aria-checked="true" aria-labelledby="pressure-label" data-tooltip="手写笔感应力度，鼠标慢画粗、快画细"><span></span></button></div></div>
        <div class="property-group property-row"><label>线条样式</label><div class="mini-segmented"><button data-dash="false" class="active" aria-label="实线">━</button><button data-dash="true" aria-label="虚线">┄</button></div></div>
        <div class="property-group property-row"><label for="font-size">文字大小</label><button id="font-size" aria-label="文字大小"></button></div>
        <div class="property-group"><label for="opacity">不透明度 <output id="opacity-value">100%</output></label><input id="opacity" type="range" min="10" max="100" value="100" aria-label="不透明度"/></div>
        <div id="selection-actions" class="selection-actions" hidden>
          <span id="selection-label">已选择 1 个元素</span>
          <div class="group-controls"><button id="group-button" class="button button-subtle" data-tooltip="组合 · Ctrl + G">组合</button><button id="ungroup-button" class="button button-subtle" data-tooltip="取消组合 · Ctrl + Shift + G">解组</button></div>
          <div id="alignment-controls" class="alignment-controls" role="group" aria-label="对齐与分布">${[['left', '左对齐'], ['center', '水平居中'], ['right', '右对齐'], ['top', '顶端对齐'], ['middle', '垂直居中'], ['bottom', '底端对齐'], ['horizontal', '水平等距'], ['vertical', '垂直等距']].map(([action, label]) => `<button data-align="${action}" data-tooltip="${label}" aria-label="${label}">${label}</button>`).join('')}</div>
          <div class="layer-controls">${button('send-back', 'back', '置于底层')}${button('send-backward', 'layer-down', '下移一层')}${button('bring-forward', 'layer-up', '上移一层')}${button('bring-front', 'front', '置于顶层')}</div>
          <div class="object-controls">${button('duplicate-button', 'duplicate', '复制元素')}${button('lock-button', 'lock', '锁定元素')}${button('delete-button', 'trash', '删除元素')}</div>
        </div>
        <div class="property-footnote">${icon('bolt', 13)}<span>轻一点，让想法快一点。</span></div>
      </div>
    </aside>
    <button id="expand-properties" class="panel icon-button expand-properties" aria-label="展开样式" hidden>${icon('settings')}</button>
    <div id="group-navigation" class="group-navigation panel" hidden><span id="group-scope-label"></span><button id="exit-group" class="button button-subtle">退出一层 <kbd>Esc</kbd></button></div>
    <div id="empty-state" class="empty-state" hidden><div class="empty-mark">${logo}</div><h1>好想法，在${PRODUCT.name}生长。</h1><p>随手画一笔，或按 <kbd>N</kbd> 贴下第一个灵感。</p><div><button class="button button-subtle" id="add-first-note">${icon('note', 16)}贴一张便签</button><button class="text-button" id="show-example">看看示例 ${icon('arrowRight', 15)}</button></div></div>
    <div class="bottom-left"><div class="history-controls panel">${button('undo-button', 'undo', '撤销')}${button('redo-button', 'redo', '重做')}</div>${button('help-button', 'keyboard', '快捷键帮助')}<span class="local-badge"><span></span>本地优先 <span class="badge-divider">/</span> 自由创作</span></div>
    <div class="bottom-right"><span id="element-count">0 个元素</span><div class="zoom-controls panel">${button('zoom-out', 'minus', '缩小')}<button id="zoom-value" class="zoom-value" aria-label="重置缩放">100%</button>${button('zoom-in', 'plus', '放大')}<span class="tool-separator"></span>${button('fit-button', 'fit', '适应画布')}</div></div>
    <div class="menu panel" id="document-menu" hidden>
      <button data-action="new">${icon('plus', 17)}新建画板<kbd>Ctrl Alt N</kbd></button>
      <button data-action="library">${icon('library', 17)}我的画板</button>
      <button data-action="import">${icon('import', 17)}导入 ${PRODUCT.extension} 文件</button>
      <hr/><button data-action="grid">${icon('grid', 17)}显示 / 隐藏网格<kbd>G</kbd></button>
      <button data-action="help">${icon('keyboard', 17)}快捷键帮助<kbd>?</kbd></button>
      <button data-action="workspace-settings">${icon('settings', 17)}工作区设置</button>
    </div>
    <div class="menu panel export-menu" id="export-menu" hidden>
      <div class="menu-title">带走你的好想法</div>
      <button data-action="export-file">${icon('export', 17)}${PRODUCT.name}源文件<span>${PRODUCT.extension}</span></button>
      <button data-action="export-png">${icon('image', 17)}导出高清图片<span>PNG</span></button>
      <button data-action="export-svg">${icon('rect', 17)}导出矢量图<span>SVG</span></button>
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
    <dialog id="library-dialog" class="dialog library-dialog" aria-labelledby="library-title"><div class="dialog-header"><div><h2 id="library-title">我的画板</h2><p>你的画板，安静地保存在这台设备上。点击名称即可修改。</p></div><button data-close class="icon-button" aria-label="关闭画板库">${icon('close')}</button></div><div class="library-actions"><button class="button button-primary" id="new-board-button" aria-label="新建画板">${icon('plus', 17)}新建画板</button><button class="button button-subtle" id="library-import">${icon('import', 17)}导入画板</button><span id="board-count"></span></div><div class="library-search"><input id="library-search" type="search" aria-label="搜索画板" placeholder="搜索画板名称"/><select id="library-sort" aria-label="画板排序"><option value="updated">最近编辑</option><option value="title">名称排序</option></select></div><div id="board-list" class="board-list"></div><div class="dialog-footer">${icon('leaf', 15)}没有云端，没有打扰。只有你和你的想法。</div></dialog>
    <dialog id="workspace-settings-dialog" class="dialog settings-dialog" aria-labelledby="workspace-settings-title"><div class="dialog-header"><div><h2 id="workspace-settings-title">工作区设置</h2><p>按你的习惯安排工具，设置自动保存在本机。</p></div><button data-close class="icon-button" aria-label="关闭工作区设置">${icon('close')}</button></div><div class="settings-fields"><label for="toolbar-position">工具栏位置</label><select id="toolbar-position"><option value="bottom">底部</option><option value="top">顶部</option></select><p>图形和线条选项随工具栏移动。左侧样式面板保持原位。</p></div></dialog>
    <dialog id="export-options-dialog" class="dialog export-options-dialog" aria-labelledby="export-options-title"><div class="dialog-header"><div><h2 id="export-options-title">导出图片</h2><p id="export-summary"></p></div><button data-close class="icon-button" aria-label="关闭导出设置">${icon('close')}</button></div><form id="export-options-form" class="export-fields"><label for="export-scope">导出范围</label><select id="export-scope"><option value="all">整个画板</option><option value="selection">已选对象</option></select><label for="export-format">文件格式</label><select id="export-format"><option value="png">PNG 图片</option><option value="svg">SVG 矢量图</option></select><label for="export-background">背景</label><select id="export-background"><option value="board">画板背景</option><option value="transparent">透明背景</option></select><label for="export-padding">留白（画布单位）</label><input id="export-padding" type="number" min="0" max="500" value="48" required/><label for="export-scale">图片倍率</label><select id="export-scale"><option value="1">1×</option><option value="2" selected>2×</option><option value="3">3×</option><option value="4">4×</option></select><p id="export-dimensions" class="export-dimensions" role="status"></p><button id="confirm-export" class="button button-primary" type="submit">导出 PNG</button></form></dialog>
    <dialog id="help-dialog" class="dialog help-dialog" aria-labelledby="shortcut-title"><div class="dialog-header"><div><h2 id="shortcut-title">快捷键</h2><p>按你的习惯设置，让创作更顺手。</p></div><button data-close class="icon-button" aria-label="关闭帮助">${icon('close')}</button></div><div class="shortcut-settings-heading"><p id="shortcut-status" role="status">点击右侧键位，按下新的组合键即可修改</p><button id="reset-shortcuts" class="text-button">恢复默认</button></div><div id="shortcut-list" class="shortcut-list"></div><div class="help-tip">${icon('info', 17)}<span>空格 + 拖动平移 · Shift 多选 / 约束 · Ctrl + 滚轮缩放<br/>Ctrl C / X / V 复制、剪切、粘贴 · Ctrl Enter 完成文字 · Esc 取消<br/>macOS 的 Ctrl 对应 Command。填充颜色通过点击选择。</span></div><div class="dialog-footer"><span>快捷键自动保存在本机</span><span>${PRODUCT.name} 0.1</span></div></dialog>
    <dialog id="confirm-dialog" class="dialog confirm-dialog"><h2>删除这块画板？</h2><p>此操作无法撤销。你可以先导出一份源文件。</p><div><button id="cancel-delete" class="button button-subtle">保留画板</button><button id="confirm-delete" class="button button-danger">删除画板</button></div></dialog>
    <div id="toast" class="toast" role="status" hidden></div>
    <input type="file" id="import-file" accept="${PRODUCT.extension},${PRODUCT.legacyExtension}" hidden />
    <input type="file" id="image-file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden />
  `;
}

export function swatches(colors: string[], property: string): string {
  return colors.map((color, i) => `<button class="swatch ${color === 'transparent' ? 'transparent' : ''} ${i === 0 ? 'active' : ''}" style="--swatch:${color};--swatch-ink:${colorInk(color)}" data-color="${color}" data-property="${property}" data-color-index="${i}" data-tooltip="双击编辑此预设色" aria-label="${property === 'stroke' ? '描边' : '填充'} ${color === 'transparent' ? '透明' : color}" aria-pressed="${i === 0}">${icon('check', 13)}</button>`).join('');
}
