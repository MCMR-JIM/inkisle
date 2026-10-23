# Workspace editing

## Selection and nested groups

- A marquee selects only fully enclosed objects. A group must be fully enclosed to be selected from outside it.
- An ordinary multi-selection shows a separate frame around each object and supports moving only. Resize and rotation handles appear for an individually selected object.
- Use **Ctrl+G** to group selected objects and **Ctrl+Shift+G** to ungroup one level. Existing groups can be grouped again, up to 32 levels.
- Double-click a group, or press **Enter** when one group is selected, to enter it. Repeat to enter a nested group. The group indicator shows the current depth.
- Inside a group, click to select an individual object, or Shift-click / marquee to select several children. Single objects retain resize and rotation controls; multiple objects can only move.
- Press **Esc** or click **Exit one level** to leave the current group. **Ctrl-click** directly selects an individual descendant.
- Alignment and equal spacing treat a selected group as one unit. Operations within a group affect its children. Layer actions preserve group boundaries.
- Group, ungroup and alignment commands appear in a compact toolbar near the selection. Open **Alignment and spacing** for the alignment commands. The left panel contains style settings; layer ordering, duplicate, lock and delete remain in the right-click menu.
- Grouping, ungrouping, moving, alignment and child edits participate in undo/redo. Source files, clipboard copies and board copies preserve nesting. Copies receive independent group identities.

## Tool placement and shortcuts

Open **Workspace settings** from the header or board menu to place the tool toolbar at the top or bottom. The default is bottom, and the preference is saved locally. Tool options open toward the canvas. The centered left style panel keeps its existing position.

Selecting a shape or line with a shortcut also reveals its family options. **Shift+R** toggles the shapes family; **Shift+L** toggles the lines family. Both bindings, along with group and ungroup, can be changed in shortcut settings.

On small screens, tools and shape options use multiple rows with larger touch targets.

## Board library

Search by board name, sort by recent edit or name, edit names directly on cards, and duplicate entire boards. A board copy has independent elements and groups. Renaming and copying finish before switching or deleting a board.

## Image export

PNG and SVG exports open a settings dialog with an explicit choice between the whole board and selected objects. Choose a board-colored or transparent background and 0–500 canvas units of padding. PNG supports 1–4× resolution and displays actual output dimensions; large rasters are limited to 8,192 pixels per side and 16 million pixels total. SVG remains vector-based and has no resolution multiplier.

Source file export continues to save the whole editable board, including all nested groups.
