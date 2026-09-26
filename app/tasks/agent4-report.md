# Agent 4 — Radiology Report (editor, print/PDF, export)

You own: `src/components/report/*` (ReportPanel.tsx, PrintReport.tsx, `report.css`, `print.css`, any new files there),
`src/lib/reportExport.ts` (new), `notes/agent4.md`. CSS prefix: `rp-`. Read `SWARM.md`, `src/types.ts`, `src/store.ts`,
`src/styles/*.css`, `src/lib/annotate.ts` (stub: `renderAnnotatedImage`), `src/lib/analysis.ts` first. Keep export: `ReportPanel()` (no props).

Agent 1 is adding to `src/lib/analysis.ts` these exports — import and use exactly:
`generateStudyReport(studyId: string): Promise<void>`, `cancelReport(): void`, and a zustand hook
`useReportJob` returning `{ running: boolean; progressText?: string; error?: string }`.
(They already exist as stubs in analysis.ts.)

## `ReportPanel()` (inside the 380px inspector)
- If no analyzed images in the study: empty state explaining "Analyze at least one image to draft a report", with count of
  analyzed/total images.
- If no report yet: card with "Draft Report" primary button (→ `generateStudyReport`) describing it will synthesize all
  analyzed images + patient context into a structured report. Show `useReportJob` progress (spinner + text + Cancel) and errors.
- Report editor (when `study.report` exists): header card with patient summary (name, ID, age/sex, date, indication — "Edit"
  link calls `openSheet('patient')`), then editable sections as auto-growing textareas with section labels:
  CLINICAL INDICATION (read-only from patient, shown), TECHNIQUE, COMPARISON, FINDINGS, IMPRESSION, RECOMMENDATIONS.
  Edits write through `setReport(studyId, {field})` (debounce not required; keep caret stable). Show "Edited" / "AI draft"
  status and last-updated time. "Regenerate" (with confirm via a small inline confirm state, not window.confirm) .
- **Sign-off**: radiologist name field (defaults from settings.radiologist) + "Sign Report" button → sets `signed:true, signedAt`.
  Signed reports become read-only with a green "Signed by X · date" seal and an "Unlock to edit" button.
- **Export bar**: "Preview & Print / PDF" (opens the print view), "Copy" (plain text to clipboard with feedback toast-like
  inline check), "Download .txt", "Download JSON" (full study incl. analyses, without dataUrls optional) — implement in
  `src/lib/reportExport.ts` (`reportToPlainText(study, settings)`, `downloadFile(name, content, mime)`, `studyToJson(study)`).

## `PrintReport` — the formal document
A full-screen overlay (portal to `document.body`) showing an A4-proportioned, print-perfect report page on a gray backdrop
with a floating glass toolbar ("Print / Save as PDF" → `window.print()`, "Close", Esc closes). Contents:
- Letterhead: institution (`settings.institution`), "Diagnostic Radiology Report", report date, accession-like study id (short).
- Patient demographic grid (Name, Patient ID, Age/Sex, Study Date, Referring Physician), Clinical indication/history.
- Exam: modality/body part/view(s) from analyses.
- Key images: for each analyzed image, `renderAnnotatedImage(image)` thumbnail (max 2 per row) with a numbered legend of findings
  (number, title, severity, location) under each.
- Technique, Comparison, Findings, Impression (bold, numbered), Recommendations.
- Findings summary table: #, Finding, Location, Severity (colored dot), Confidence.
- Signature block (signed name/date or "UNSIGNED — PRELIMINARY AI DRAFT" watermark-style banner if unsigned).
- Footer disclaimer: "This report was drafted with AI assistance (MedGemma 27B, run locally) and ...must be reviewed..." and page numbering via CSS.
`print.css`: `@media print` hides everything except the report page (`body > *:not(.rp-print-root) { display:none }`),
`@page { size: A4; margin: 14mm }`, exact colors (`print-color-adjust: exact`), avoid breaking inside sections/images.
Typography: serif-free, SF, clinical and elegant; black text on white regardless of app theme.

Typecheck: `npx tsc -p tsconfig.app.json --noEmit`. Write `notes/agent4.md`.
