// Send a measurement line to the report: the active section editor, else Findings, else the clipboard.
import { useSectionEditors } from './sectionEditors.ts'

export type InsertResult = 'inserted' | 'copied' | 'copied-read-only' | 'unavailable' | 'read-only'

export async function insertIntoReport(text: string): Promise<InsertResult> {
  const { active, editors } = useSectionEditors.getState()
  const editor = (active && editors[active]) || editors.findings
  // A signed (read-only) report refuses the text: fall back to the clipboard and say so.
  if (editor && editor.insertText(text)) return 'inserted'
  try {
    await navigator.clipboard.writeText(text)
    return editor ? 'copied-read-only' : 'copied'
  } catch {
    return editor ? 'read-only' : 'unavailable'
  }
}

const LABELS: Record<InsertResult, string> = {
  inserted: 'Inserted into report',
  copied: 'No report section open · copied to clipboard',
  'copied-read-only': 'Report is signed (read-only) · copied to clipboard',
  'read-only': 'Report is signed (read-only) · could not copy',
  unavailable: 'Could not insert or copy',
}

export const insertResultLabel = (result: InsertResult) => LABELS[result]
