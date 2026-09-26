# Agent 3 — Findings Inspector (analysis UX)

You own: `src/components/findings/*` (FindingsPanel.tsx + any new files there, `findings.css`), `notes/agent3.md`.
CSS prefix: `fd-`. Read `SWARM.md`, `src/types.ts`, `src/store.ts`, `src/styles/*.css`, and the stub signatures in
`src/lib/analysis.ts` (`runAnalysis`, `cancelAnalysis`, `runAnalysisForStudy`) first. Keep export: `FindingsPanel()` (no props).
It renders inside the right inspector (380px wide, scrollable, light/dark themed — NOT the dark viewer).

States for the active image:
1. **No active image** → quiet empty state ("Select or add an image to begin").
2. **idle** → an inviting card: title "Ready for analysis", short explainer ("MedGemma 27B will perform a systematic review
   and localize abnormalities. Runs locally — no data leaves this Mac."), primary `.btn-primary .btn-lg` "Analyze Image"
   (calls `runAnalysis(studyId, imageId)`), secondary "Analyze All (n)" when the study has >1 un-analyzed images. Show a
   hint if patient indication is empty: "Add clinical indication for a more focused read" with a link-button calling
   `openSheet('patient')`.
3. **analyzing** → elegant progress: spinner, stage text from `image.progressText`, an indeterminate progress bar, elapsed
   seconds timer, "Cancel" button (`cancelAnalysis`). Skeleton placeholders of finding cards below.
4. **error** → error card with the message, "Try Again" button, and hint to check LM Studio.
5. **done** → the analysis:
   - **Summary header card**: urgency pill (Routine / Priority / Urgent — green/orange/red), counts per severity as a small
     stacked severity bar + legend, meta row: modality · body part · view · image quality, model + duration (e.g. "medgemma-27b-it · 47 s").
   - **Impression** block (prominent, headline type).
   - **Findings list**: grouped by severity in SEVERITY_ORDER with small section headers. Each finding card: number chip (1-based
     index in `analysis.findings` order — must match the viewer's numbers), title, severity badge, location + category, a
     confidence meter (thin bar + percentage), description (clamped to 3 lines, expand on select), recommendation if present,
     and an icon indicating whether it's localized on the image (bbox) or diffuse. Hover → `hoverFinding(id)` (and null on
     leave); click → `selectFinding(id)` toggles; selected card gets accent ring and expands. Keyboard: cards focusable,
     Enter selects, ↑/↓ move selection.
   - **Pertinent negatives**: checklist style with green check icons.
   - **Differential diagnosis**: numbered list.
   - **Recommendations** list.
   - Footer actions: "Re-analyze" (plain), "Create Report →" (primary; calls `setInspectorTab('report')`).
   - Collapsible "Model output" disclosure showing `rawText` in monospace (for auditability).
   - Always-visible small disclaimer at bottom: "AI-generated decision support. Findings must be verified by a qualified radiologist."
- Scroll the selected finding card into view when `selectedFindingId` changes from the viewer (smooth, `block:'nearest'`).

Design: Apple Health / macOS Settings feel — grouped cards on `--bg-grouped`-ish inspector background, SF type hierarchy,
hairlines, restrained color used only for severity. Smooth expand/collapse (grid-template-rows trick), 60fps.
Typecheck: `npx tsc -p tsconfig.app.json --noEmit`. Write `notes/agent3.md`.
