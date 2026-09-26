# Agent 2 — Image Intake & Diagnostic Viewer

You own: `src/components/viewer/*` (ImageViewer.tsx, Filmstrip.tsx, Dropzone.tsx, plus any new files there, `viewer.css`),
`src/lib/imageIntake.ts`, `src/lib/annotate.ts`, `notes/agent2.md`. CSS class prefix: `vw-`. Read `SWARM.md`,
`src/types.ts`, `src/store.ts`, `src/styles/*.css` first. Keep exported names/props: `ImageViewer()` (no props),
`Filmstrip()` (no props), `Dropzone({studyId})`, `filesToStudyImages`, `ACCEPTED_TYPES`, `renderAnnotatedImage`.

## `src/lib/imageIntake.ts`
- `filesToStudyImages(files)`: accept PNG/JPEG/WebP/BMP/GIF and DICOM (`.dcm` or `application/dicom`, or files with the
  `DICM` magic at byte 128). Standard images: decode via `createImageBitmap`, downscale to max 1536px long edge, encode JPEG q=0.92
  (PNG if small grayscale is fine too) → `dataUrl`, `width`, `height`. DICOM: use `dicom-parser` (`import dicomParser from 'dicom-parser'`)
  for uncompressed pixel data (8/16-bit, MONOCHROME1/2, rescale slope/intercept, apply Window Center/Width if present else
  min/max), render to canvas → JPEG. For compressed transfer syntaxes throw a clear error. Skip non-images with an error list.
  Return `StudyImage` with `status:'idle'`, `id: uid()`, `addedAt: Date.now()`.
  Also export `readDroppedItems(dataTransfer)` helper and `extractImagesFromClipboard(e: ClipboardEvent)`.

## `Dropzone({studyId})`
The empty-state hero shown in the viewer area when the study has no images: a large, beautiful, dark (viewer is dark)
drop target — subtle dashed rounded rect, an icon (lucide `ScanLine` or `FileImage`), title "Add X-ray images",
subtitle "Drag and drop PNG, JPEG or DICOM files, paste from clipboard, or", `.btn-primary` "Choose Files…". Supports
drag-over highlight state, keyboard activation, multiple files, paste (⌘V) anywhere while mounted, processing spinner and
error display. Calls `useApp.getState().addImages(studyId, imgs)`.

## `ImageViewer()` — the heart of the app
Reads the active study/image from the store. If no active study → nothing (Agent 5 shows its own empty state). If study has
no images → render `<Dropzone>`. Otherwise:
- Dark canvas area (`--viewer-bg`) filling its container; image fit-to-view centered, `zoom` & `panX/panY` from `store.viewer`.
- Interactions: wheel/trackpad pinch zoom around cursor (ctrl+wheel = pinch on mac), drag to pan, double-click to toggle fit/2×,
  **right-drag (or Alt+drag) adjusts window/level** (horizontal = contrast, vertical = brightness), keyboard: `+`/`-` zoom,
  `0` fit, `i` invert, `o` toggle overlay, `r` reset, arrow keys prev/next image. Apply brightness/contrast/invert via CSS
  `filter` on the image only (not overlays).
- **Finding overlays**: for each finding with a bbox, draw a rounded rectangle in its severity color (`[data-severity]` / `--c`)
  with a numbered marker chip (1-based index in the analysis findings order) and, on hover/selected, a label pill with the
  title. Hovered (`hoveredFindingId`) → brighter + thicker; selected (`selectedFindingId`) → solid stroke + subtle fill + other
  boxes dimmed. Clicking a box calls `selectFinding(id)` and `setInspectorTab('findings')`. Hovering calls `hoverFinding`.
  Overlays must stay locked to the image under zoom/pan (place them in the same transformed container, in % units).
  When a finding is selected from the panel, smoothly pan so it's visible (optional zoom-to-fit the box on double-click in list — expose
  nothing, just react to `selectedFindingId` changes).
- **Analyzing state**: when the active image `status==='analyzing'`, show an elegant scanning effect over the image (a soft
  horizontal light sweep, restrained, not sci-fi) and a HUD capsule with spinner + `progressText`.
- **HUD** (glass, `--viewer-hud`, bottom-center floating toolbar): zoom out / zoom % / zoom in, fit, window-level presets
  menu or segmented (Default, Lung, Bone, Soft tissue — mapped to brightness/contrast pairs), invert toggle, overlay toggle,
  reset. Top-left corner overlay text in DICOM-viewer style, small and dim: patient name/ID, study date, image name,
  `W: xx C: xx`, zoom %. Top-right: finding count badge with worst severity.
- Include a subtle laterality marker "R" on the image left edge if the analysis `view` is PA/AP (tiny, dim).

## `Filmstrip()`
Horizontal strip under the viewer (dark, ~92px tall): thumbnails (rounded 8px) of each image in the active study with a status
dot (idle gray, analyzing animated blue, done → worst-severity color, error red), selected ring in accent, hover shows remove
(×) button (confirm-less; calls `removeImage`), and a trailing "+" tile that opens the file picker. Also accepts drops.

## `src/lib/annotate.ts`
`renderAnnotatedImage(image, {maxSize=1400})`: draw the image to canvas and burn in each finding box (severity color, 3px,
rounded) with numbered circle markers matching the viewer numbering; return JPEG data URL. Used by the report/print view.

Quality bar: buttery 60fps pan/zoom (use transforms, `will-change`, pointer events with capture), accessible labels on every
icon button, no layout shift. Typecheck: `npx tsc -p tsconfig.app.json --noEmit`. Write `notes/agent2.md`.
