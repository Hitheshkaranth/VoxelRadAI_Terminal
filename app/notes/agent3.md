# Agent 3 — Findings Inspector

## What I built
The Findings tab of the right inspector (380px, light/dark, scrollable). `FindingsPanel()` takes no props and
renders one of five states derived from the active image's `status`:

- **empty** — no active image (`src/components/findings/FindingsPanel.tsx:28`)
- **idle** — "Ready for analysis" card with primary *Analyze Image* and, when the study has >1 un-analyzed images,
  a secondary *Analyze All (n)* hint when the patient indication is empty.
- **analyzing** — spinner, `image.progressText` stage, indeterminate progress bar, live elapsed timer, *Cancel*.
- **error** — error card with the message, *Try Again*, and a *Check connection* action.
- **done** — `SummaryHeader` (urgency pill, stacked severity bar + legend, meta row, model/duration), Impression,
  the keyboard-navigable findings list, plus Pertinent negatives / Differential / Recommendations, a collapsible
  *Model output* disclosure (monospace `rawText`), *Re-analyze* / *Create Report* footer, and the always-on
  disclaimer.

Subcomponents: `SummaryHeader`, `FindingList` (grouping + keyboard nav), `FindingCard`, `AnalysisProgress`. All
styles live in `findings.css`, every class prefixed `fd-`.

## Integrator notes
- **State source**: everything is driven by `useActiveImage()` + `useApp(s => s.selectedFindingId/hoveredFindingId)`.
  No props, no local analysis state to keep in sync.
- **Finding numbers matter**: the chip number is the 1-based index of `analysis.findings` and is preserved across
  severity groups, so it must match the burned-in numbers Agent 2 draws on the image (`renderAnnotatedImage`).
- **Selection / focus**: click toggles selection; `Enter`/`Space` force-select; `↑`/`↓` move focus between cards.
  When `selectedFindingId` changes (including from the viewer selecting a box), the card scrolls into view
  (`block:'nearest', behavior:'smooth'`). Cards are `tabIndex`-gated so only the first is focusable at a time.
- **Hover linkage**: cards emit `hoverFinding(id | null)`; the viewer should highlight the corresponding box.
- **Engine calls** (Agent 1, `src/lib/analysis.ts`): `runAnalysis`, `runAnalysisForStudy`, `cancelAnalysis`.
- **Sheet/store helpers**: `useApp.getState().openSheet('patient')` for the indication hint, `setInspectorTab('report')`
  for *Create Report →*.
- **Reduced motion**: `.fd-disclosure` grid transition and the skeleton pulse are both gated off under
  `prefers-reduced-motion` (the CSS disables their animations).
- **Typecheck**: `npx tsc -p tsconfig.app.json --noEmit` passes clean on my files. The only remaining errors in the
  project are the still-unimplemented stubs owned by the other four agents.