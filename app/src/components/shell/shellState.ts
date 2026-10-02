// OWNER: Agent 5. Shared shell-layout state (collapsible sidebar / inspector) so
// App, Toolbar and Inspector can drive the same animation without store coupling.
import { create } from 'zustand'
import { useApp } from '../../store'
import { runAnalysis } from '../../lib/analysis'

interface ShellState {
  sidebarCollapsed: boolean
  inspectorCollapsed: boolean
  toggleSidebar: () => void
  toggleInspector: () => void
  setSidebarCollapsed: (v: boolean) => void
  setInspectorCollapsed: (v: boolean) => void
}

export const useShell = create<ShellState>()((set) => ({
  sidebarCollapsed: false,
  inspectorCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleInspector: () => set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setInspectorCollapsed: (v) => set({ inspectorCollapsed: v }),
}))
/**
 * The one "analyse this image" path used by the inspector buttons and ⌘↩. A finished image is re-run with
 * force; when a report has been drafted the reader confirms first, because the draft no longer matches.
 * Returns false when nothing was started.
 */
export function analyzeImageAction(studyId: string, imageId: string): boolean {
  const study = useApp.getState().studies.find((s) => s.id === studyId)
  const image = study?.images.find((i) => i.id === imageId)
  if (!study || !image || image.status === 'analyzing') return false
  if (image.status === 'done') {
    if (study.report && !window.confirm('Re-running will make the drafted report out of date. Continue?')) return false
    runAnalysis(studyId, imageId, { force: true })
  } else runAnalysis(studyId, imageId)
  return true
}

/** "2 findings · 1 flagged" — the one wording used everywhere a count is shown. */
export function countLabel(active: number, flagged: number): string {
  return `${active} finding${active === 1 ? '' : 's'}${flagged ? ` · ${flagged} flagged` : ''}`
}
