# Agent 5 — App Shell, Design System Application, Studies & Settings

You own: `src/App.tsx`, `src/index.css`, `src/components/shell/*` (Sidebar.tsx, Toolbar.tsx, Inspector.tsx, PatientSheet.tsx,
SettingsSheet.tsx, `shell.css`, and any new files there e.g. Sheet.tsx, Toasts), `public/favicon.svg`, `notes/agent5.md`.
CSS prefix: `sh-`. Read `SWARM.md`, `src/types.ts`, `src/store.ts`, `src/styles/*.css`, and the stub signatures in
`src/lib/*.ts` + `src/components/**` first. Keep exports: `Sidebar()`, `Toolbar()`, `Inspector()`, `PatientSheet()`,
`SettingsSheet()` — all prop-less.

## App.tsx
- On mount: `hydrate()` from store; show nothing (or a subtle launch fade) until `hydrated`. Apply theme: set
  `document.documentElement.dataset.theme` to 'light'/'dark' from `settings.theme` (system → follow `prefers-color-scheme`
  with a listener).
- Connection: call `checkConnection(settings)` from `src/lib/medgemma.ts` on mount, every 20s, and on settings change →
  `setConnection`.
- Layout: CSS grid, full viewport, no page scroll: sidebar | (toolbar over [viewer column | inspector]). Viewer column =
  `<ImageViewer/>` (flex 1) + `<Filmstrip/>` (only when study has images). Inspector hidden when no active study.
  Collapsible sidebar (⌘\\ or toolbar button) and inspector (⌘⌥I / toolbar button) with smooth width animation.
- No studies at all → a welcoming center empty state: app icon, "Skanda Radiology", one-line description, "New Study" primary
  button, 3 small feature rows (Local MedGemma 27B · Localized findings · Structured reports) with icons.
- Render `<PatientSheet/>` / `<SettingsSheet/>` according to `sheet`.
- Global shortcuts: ⌘N new study, ⌘, settings, ⌘I patient info, ⌘⏎ analyze active image (`runAnalysis`), ⌘⇧⏎ analyze all.

## Sidebar (vibrancy `.glass` over window bg, 256px)
Traffic-light-free but mac-like: top area with app name small + "New Study" icon button; search field (filters by title,
patient name, ID); studies list grouped "Today / Previous 7 Days / Older", each row: title (patient name if set), secondary
line (ID · date · n images), a trailing status glyph (worst severity dot if analyzed, spinner if any analyzing).
Selected row = accent-soft rounded highlight. Context actions on hover: rename (inline edit), delete (inline "Delete?" confirm).
Bottom: connection status row (dot + "MedGemma 27B · Connected/Offline/Model not loaded") and settings gear.

## Toolbar (52px, glass, hairline bottom border)
Left: sidebar toggle, study title (editable on double-click), patient chip (avatar initials circle + name/age/sex or
"Add patient details" → `openSheet('patient')`). Right: "Analyze All" (disabled if nothing to analyze; shows progress count
"Analyzing 2 of 4" while running), connection pill, inspector toggle, settings gear.

## Inspector
Right pane (380px, `--bg-grouped` background, left hairline): top segmented control Findings | Report (store
`inspectorTab`), badge on Findings with count; body renders `<FindingsPanel/>` or `<ReportPanel/>` in a scroll container.

## PatientSheet & SettingsSheet — macOS sheets
A shared `Sheet` component: centered modal card sliding/scaling in from the top (spring), dim backdrop with blur, Esc/backdrop
closes, focus trap, return focus. PatientSheet: form grid (Name, Patient ID, Age, Sex segmented, Study date, Referring
physician, Clinical indication textarea, Clinical history textarea), live-saving to `updatePatient`; "Done" button. Explain
that indication improves AI accuracy. SettingsSheet: sections — Model (LM Studio base URL, model id with a "Detect" button
that lists models from `GET {baseUrl}/models` into a select, temperature slider 0–1, max tokens), Connection test button with
status, Report (institution name, default radiologist name), Appearance (System/Light/Dark segmented), Data (Delete all
studies with inline confirm — clears store and IndexedDB via `idb-keyval` `clear()`), About (version, disclaimer).

## index.css
Global reset, `html,body,#root{height:100%}`, overflow hidden, font smoothing, selection color, focus rings, scrollbar
styling, app grid layout classes (prefix `sh-`). The whole thing must feel like a native macOS app (think Xcode/Preview/
Health): calm, precise, gorgeous in both light and dark. Also create `public/favicon.svg` (simple rounded-square icon with
a stylized ribcage/scan glyph in accent blue) and update `index.html` title is already set.

Typecheck: `npx tsc -p tsconfig.app.json --noEmit`. Write `notes/agent5.md`.
