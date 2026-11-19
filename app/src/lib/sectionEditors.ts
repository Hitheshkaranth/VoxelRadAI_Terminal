// Registry of mounted report-section editors, so dictation can write into the active one.
import { create } from 'zustand'
import type { ReportFieldKey } from '../types'

export interface SectionEditorHandle {
  focus: () => void
  insertText: (text: string) => void
  exec: (command: 'newline' | 'undo' | 'bullet' | 'numbered') => void
  /** Select the next (or previous) template field; false when the section has none. */
  nextField?: (direction?: 1 | -1) => boolean
  /** Insert a macro's text at the caret; false when no macro has that name. */
  insertMacro?: (name: string) => boolean
}

/** Which section dictation writes into, and a handle per mounted editor. */
export const useSectionEditors = create<{
  active: ReportFieldKey | null
  editors: Partial<Record<ReportFieldKey, SectionEditorHandle>>
  setActive: (key: ReportFieldKey | null) => void
  register: (key: ReportFieldKey, handle: SectionEditorHandle | null) => void
}>((set) => ({
  active: null,
  editors: {},
  setActive: (active) => set({ active }),
  register: (key, handle) =>
    set((state) => {
      const editors = { ...state.editors }
      if (handle) editors[key] = handle
      else delete editors[key]
      return { editors }
    }),
}))

// The section dictation is writing into, or Findings when none is active.
const target = () => {
  const { active, editors } = useSectionEditors.getState()
  return (active && editors[active]) || editors.findings
}

/** Insert a macro by name (or spoken trigger) into the active section. Used by the "insert macro X" voice command. */
export function insertMacro(name: string): boolean {
  return target()?.insertMacro?.(name) ?? false
}

/** Move to the next (or previous) template field in the active section. */
export function gotoField(direction: 1 | -1 = 1): boolean {
  return target()?.nextField?.(direction) ?? false
}
