// Worklist view state shared by the sidebar, "sign and next" and the N / Shift+N shortcuts,
// so every path walks the queue in exactly the order the reader sees.
import { create } from 'zustand'
import { useApp } from '../../store'
import { adjacentStudy, filterWorklist, nextStudy, parseWorklistPrefs, type WorklistPrefs } from '../../lib/worklist'
import { useShell } from './shellState'
import { toast } from './toastStore'

const KEY = 'voxelrad.worklist'

function loadPrefs(): WorklistPrefs {
  try { return parseWorklistPrefs(localStorage.getItem(KEY)) } catch { return parseWorklistPrefs(null) }
}

interface WorklistNavState {
  query: string
  prefs: WorklistPrefs
  setQuery: (query: string) => void
  setPrefs: (patch: Partial<WorklistPrefs>) => void
}

export const useWorklist = create<WorklistNavState>()((set, get) => ({
  query: '',
  prefs: loadPrefs(),
  setQuery: (query) => set({ query }),
  setPrefs: (patch) => {
    const prefs = { ...get().prefs, ...patch }
    try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* Restricted storage keeps the filter for this session only. */ }
    set({ prefs })
  },
}))

function view() {
  const { query, prefs } = useWorklist.getState()
  return { query, filter: prefs.filter, sort: prefs.sort, facets: prefs }
}

export function visibleStudies() {
  const v = view()
  return filterWorklist(useApp.getState().studies, v.query, v.filter, v.sort, v.facets)
}

export function openStudy(id: string): void {
  useShell.getState().closeVolume()
  useApp.getState().selectStudy(id)
  useShell.getState().setMobileView('viewer')
}

/** N / Shift+N: move through the visible worklist. Returns false at either end. */
export function stepStudy(direction: 1 | -1): boolean {
  const target = adjacentStudy(visibleStudies(), useShell.getState().volumeSource ? null : useApp.getState().activeStudyId, direction)
  if (!target) return false
  openStudy(target.id)
  return true
}

/**
 * Called as a report is signed, before signing reorders the list, so "next" means the study the reader
 * saw below this one. Offered as a toast action rather than jumping, so the signed report stays visible.
 */
export function offerNextStudy(signedId: string): void {
  const next = nextStudy(useApp.getState().studies, signedId, view())
  if (!next) { toast('Report signed. No other unsigned studies in this view.', 'success'); return }
  const name = next.patient.name || next.title
  toast(`Report signed. Next: ${name}`, 'success', { label: 'Open next', run: () => openStudy(next.id) })
}
