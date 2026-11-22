// Lets dictation reach the guideline helper: "open guideline" opens the top suggestion pre-filled, "insert guideline"
// inserts what the reader can see in the open helper.
import { create } from 'zustand'
import type { GuidelineSuggestion } from './guidelineSuggest'

export interface GuidelineHelperHandle {
  /** Open the helper pre-filled from the suggestion (or blank). */
  open: (suggestion?: GuidelineSuggestion) => void
  /** Insert the helper's sentence. 'closed' when the helper is not open, 'incomplete' when it has no result yet. */
  insert: () => 'inserted' | 'closed' | 'incomplete'
  close: () => void
}

export const useGuidelineBus = create<{
  suggestions: GuidelineSuggestion[]
  handle: GuidelineHelperHandle | null
  setSuggestions: (suggestions: GuidelineSuggestion[]) => void
  register: (handle: GuidelineHelperHandle | null) => void
}>((set) => ({
  suggestions: [],
  handle: null,
  setSuggestions: (suggestions) => set({ suggestions }),
  register: (handle) => set({ handle }),
}))
