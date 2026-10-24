# PDF and paper

Import a PDF from the board menu or drop it onto the canvas. Choose page ranges such as `1-5,8` to add pages to the current board. The board's name, identity, and existing drawings remain intact. The first sheets are placed below existing artwork, and importing into an unpaged canvas starts a single-column layout.

When creating a board, choose an infinite canvas without pages, a continuous single-column layout, or a continuous two-column layout. Either paper layout starts with one blank sheet when no document is selected. An optional initial PDF supports selected page ranges and either paper layout. Layout settings are saved with the board.

Each A4 sheet has a fixed margin and a visible outer boundary. Neighboring boundaries remain separate, leaving room for annotations around each sheet. The canvas remains infinite, so drawing outside these boundaries is allowed.

The main drawing toolbar always provides **Add paper**. Page navigation appears in the lower-left corner only when sheets exist, with previous/next controls, a page number field, layout switching, and sheet removal. Undo, redo, and shortcut settings are in the top bar. Layout changes move annotations together with their sheets and support undo. Removing a sheet also removes its contained annotations and can be undone.

A layout change is available only when every annotation fits entirely within one sheet's outer boundary. A group spanning multiple sheets also blocks the change. Use **Locate overflow** to find affected content; move, erase, or delete it to restore layout switching.

PDF export includes only the fixed outer boundaries, fits each frame onto an A4 page, and clips crossing strokes at the edge. Helper borders are omitted. Original PDF content stays vector-based; pages containing PDF annotations are flattened to preserve their appearance. Whiteboard annotations are composited above the original. On a board without paper, PDF export fits the entire board onto one A4 page.

Original PDFs are stored separately from drawing history and shared by their page references. Previews load only for visible pages, with a bounded 48 MiB raster cache. Individual PDFs may contain up to 5,000 pages and be at most 32 MiB. Export supports selected ranges of up to 200 pages per file.

An editable `.inkisle` export includes the referenced PDF originals, allowing a board to move between devices. Existing board files remain importable. Boards containing PDF pages can export to PNG or PDF; SVG export is available for ordinary whiteboard objects.
