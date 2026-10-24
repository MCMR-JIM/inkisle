# PDF and paper

Import a PDF from the board menu or drop it onto the canvas. Choose page ranges such as `1-5,8` and import into a new board or the current board. Blank paper can also be added from the board menu.

Each A4 sheet has a fixed margin and a visible outer boundary. Neighboring boundaries remain separate, leaving room for annotations around each sheet. The canvas remains infinite, so drawing outside these boundaries is allowed.

The page toolbar provides continuous one-column and two-column layouts, previous/next navigation, a page number field, and add/remove controls. Layout changes move annotations together with their sheets and support undo. Removing a sheet also removes its contained annotations and can be undone.

A layout change is available only when every annotation fits entirely within one sheet's outer boundary. A group spanning multiple sheets also blocks the change. Use **Locate overflow** to find affected content; move, erase, or delete it to restore layout switching.

PDF export includes only the fixed outer boundaries, fits each frame onto an A4 page, and clips crossing strokes at the edge. Helper borders are omitted. Original PDF content stays vector-based; pages containing PDF annotations are flattened to preserve their appearance. Whiteboard annotations are composited above the original. On a board without paper, PDF export fits the entire board onto one A4 page.

Original PDFs are stored separately from drawing history and shared by their page references. Previews load only for visible pages, with a bounded 48 MiB raster cache. Individual PDFs may contain up to 5,000 pages and be at most 32 MiB. Export supports selected ranges of up to 200 pages per file.

An editable `.inkisle` export includes the referenced PDF originals, allowing a board to move between devices. Existing board files remain importable. Boards containing PDF pages can export to PNG or PDF; SVG export is available for ordinary whiteboard objects.
