// Send a measurement line to the report: the active section editor, else Findings, else the clipboard.
import { useSectionEditors } from './sectionEditors'

export type InsertResult = 'inserted' | 'copied' | 'unavailable'

export async function insertIntoReport(text: string): Promise<InsertResult> {
  const { active, editors } = useSectionEditors.getState()
  const editor = (active && editors[active]) || editors.findings
  if (editor) { editor.insertText(text); return 'inserted' }
  try { await navigator.clipboard.writeText(text); return 'copied' } catch { return 'unavailable' }
}

export const insertResultLabel = (result: InsertResult) =>
  result === 'inserted' ? 'Inserted into report' : result === 'copied' ? 'No report section open · copied to clipboard' : 'Could not insert or copy'
