# Workspace editing

## Selection and nested groups

- A marquee selects only fully enclosed objects. A group must be fully enclosed to be selected from outside it.
- An ordinary multi-selection shows a separate frame around each object and supports moving only. Resize and rotation handles appear for an individually selected object.
- Rotation stems choose their initial near-zero orientation when the object is created, then turn with the object. Line and arrow stems retain their side through endpoint edits, undo/redo, source files and reopening.
- Use **Ctrl+G** to group selected objects and **Ctrl+Shift+G** to ungroup one level. Existing groups can be grouped again, up to 32 levels.
- Double-click a group, or press **Enter** when one group is selected, to enter it. Repeat to enter a nested group. The group indicator shows the current depth.
- Inside a group, click to select an individual object, or Shift-click / marquee to select several children. Single objects retain resize and rotation controls; multiple objects can only move.
- Press **Esc** or click **Exit one level** to leave the current group. **Ctrl-click** directly selects an individual descendant.
- Alignment and equal spacing treat a selected group as one unit. Operations within a group affect its children. Layer actions preserve group boundaries.
- Group, ungroup and alignment commands appear in a compact toolbar near the selection. Open **Alignment and spacing** for the alignment commands. The left panel contains style settings; layer ordering, duplicate, lock and delete remain in the right-click menu.
- Grouping, ungrouping, moving, alignment and child edits participate in undo/redo. Source files, clipboard copies and board copies preserve nesting. Copies receive independent group identities.

## Tool placement and shortcuts

Open **Workspace settings** from the header or board menu to place the tool toolbar at the top or bottom. The default is bottom, and the preference is saved locally. Tool options open toward the canvas. The centered left style panel keeps its existing position.

Click the current zoom percentage to open an upward preset menu (25%, 50%, 75%, 100%, 125%, 150%, 200%, 400%). Presets preserve the world point under the current screen center. The percentage keeps its compact, centered appearance without an arrow; the menu aligns with the full minus/percentage/plus row. Wheel, fit and keyboard zoom still update the displayed value; **Shift+0** resets to 100%.

Selecting a shape or line with a shortcut also reveals its family options. **Shift+R** toggles the shapes family; **Shift+L** toggles the lines family. Both bindings, along with group and ungroup, can be changed in shortcut settings.

Clicking a shape or line category immediately activates its last-used child, defaulting to rectangle or line, and deselects the previous tool.

Selecting the pen by clicking or pressing **P** opens pressure options beside the toolbar. Selecting existing ink also exposes pressure editing. The left style panel keeps a fixed title and control layout across tools and selections.

The pen popover includes **Pen / Highlighter**. Highlighter defaults to yellow, a 20-unit width and 35% opacity, with uniform width. Its color, width and opacity can be adjusted through the existing style controls. Switching to ordinary pen or another tool restores the previous settings. The chosen pen mode is remembered locally; highlighter strokes support normal selection, erasing, undo and file/image export.

Tool option bars share icon-above-label buttons, size to their contents and stay horizontally centered. They wrap only when the viewport requires it. Pen pressure stays at the right, separated from pen choices by a short vertical rule.

Selecting **Eraser** or pressing **E** opens a size slider with a live value. Its diameter ranges from 4 to 120 screen pixels (default 20) and is remembered locally. Over the canvas, wheel up enlarges it and wheel down shrinks it; Ctrl/Command-wheel still zooms and holding Space keeps panning. Cursor and erasure share the same diameter at every zoom. Changing size during a stroke preserves each segment's width and the whole stroke remains one undo step.

## Shared UI controls

`src/ui/floating-bar.ts` renders option bars from options, separators, switches and range sliders. Pen, eraser, shape, line, selection and alignment bars reuse this frame and its control styles; the fill switch and main/zoom toolbar separators reuse the same primitives. Range items provide bounds, step, label, unit and a live output; `setRangeValue` keeps programmatic changes and accessible values synchronized. Tool-specific classes only provide anchoring. Add choices through option data rather than another toolbar template or stylesheet. The common layout observer keeps notifications clear of any visible tool bar, including wrapped options.

`src/ui/custom-select.ts` supplies every select: text size, zoom, toolbar placement, library sorting and image-export settings. It supports typed string/number values, disabled options, keyboard navigation and typeahead, an optional chevron, centered options and a separate anchor. Menus match their anchor width and trigger font size, with no outer padding. The library sort trigger is 108 pixels wide to match its menu. Modal menus stay inside their dialog layer. Zoom formats arbitrary current values without appending them to its preset list. Reuse this component instead of native selects or a new menu implementation.

## Board library

Unnamed empty boards stay in memory and do not enter the library. Adding content or giving a board a name starts automatic saving; named empty boards are kept. Undoing or deleting all content from an unnamed board removes its stored copy, while redo can restore it. New boards open without a welcome notification.

Search by board name, sort by recent edit or name, edit names directly on cards, and duplicate entire boards. A board copy has independent elements and groups. Renaming and copying finish before switching or deleting a board.

## Image export

PNG and SVG exports open a settings dialog with an explicit choice between the whole board and selected objects. Choose a board-colored or transparent background and 0–500 canvas units of padding. PNG supports 1–4× resolution and displays actual output dimensions; large rasters are limited to 8,192 pixels per side and 16 million pixels total. SVG remains vector-based and has no resolution multiplier.

Source file export continues to save the whole editable board, including all nested groups.
