// Registry of mounted report-section editors, so dictation can write into the active one.
import { create } from 'zustand'
import type { ReportFieldKey } from '../types'

export interface SectionEditorHandle {
  focus: () => void
  insertText: (text: string) => void
  exec: (command: 'newline' | 'undo' | 'bullet' | 'numbered') => void
  // Optional voice-command hooks; dictation falls back gracefully when an editor does not provide them.
  nextField?: () => boolean | void
  prevField?: () => boolean | void
  insertMacro?: (name: string) => boolean | void
  deleteLastSentence?: () => void
  capitaliseLast?: () => void
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
