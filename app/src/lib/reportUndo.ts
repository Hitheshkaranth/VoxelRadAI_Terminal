// Undo of Regenerate: restore the previous draft text, keeping every record made since the snapshot.
import type { ReportDraft } from '../types'

/** Fields that record what happened to the report (sign-offs, addenda, corrections, critical-result calls). They
 * are never rolled back by undoing a regenerate, even when the snapshot predates them. */
export const REPORT_HISTORY_KEYS = ['versions', 'addenda', 'correction', 'amendments', 'criticalComms', 'followUps'] as const

/** The report after undoing Regenerate, or null when there is nothing to undo. */
export function undoRegenerate(report: ReportDraft): ReportDraft | null {
  if (!report.previous) return null
  const restored: ReportDraft = { ...report.previous, previous: undefined }
  for (const key of REPORT_HISTORY_KEYS) (restored as unknown as Record<string, unknown>)[key] = report[key]
  return restored
}
