// OWNER: Agent 5. Shared shell-layout state (collapsible sidebar / inspector) so
// App, Toolbar and Inspector can drive the same animation without store coupling.
import { VOLUME_SAMPLES, type VolumeSource } from '../../lib/volumeSources'
import { create } from 'zustand'
import { useApp } from '../../store'
import { runAnalysis } from '../../lib/analysis'
import { addFilesToActiveStudy } from '../../lib/upload'
import { uid } from '../../store'

export type MobileView = 'studies' | 'viewer' | 'findings' | 'report'

interface ShellState {
  volumeSource: VolumeSource | null
  openVolume: (source: VolumeSource) => void
  closeVolume: () => void
  mobileView: MobileView
  setMobileView: (view: MobileView) => void
  sidebarCollapsed: boolean
  inspectorCollapsed: boolean
  toggleSidebar: () => void
  toggleInspector: () => void
  setSidebarCollapsed: (v: boolean) => void
  setInspectorCollapsed: (v: boolean) => void
}

const initialVolume = VOLUME_SAMPLES.find((source) => source.id === new URLSearchParams(window.location.hash.slice(1)).get('volume')) ?? null
const compactDesktop = () => window.matchMedia('(min-width: 1024px) and (max-width: 1279px)').matches
function volumeAddress(source: VolumeSource | null) {
  const url = new URL(window.location.href)
  url.hash = source && !source.file ? `volume=${source.id}` : ''
  window.history.replaceState(null, '', url)
}

export const useShell = create<ShellState>()((set, get) => ({
  volumeSource: initialVolume,
  openVolume: (volumeSource) => { volumeAddress(volumeSource); set({ volumeSource, mobileView: 'viewer' }) },
  closeVolume: () => { volumeAddress(null); set({ volumeSource: null }) },
  mobileView: initialVolume ? 'viewer' : 'studies',
  setMobileView: (mobileView) => {
    if (!get().volumeSource && (mobileView === 'findings' || mobileView === 'report')) useApp.getState().setInspectorTab(mobileView)
    set({ mobileView })
  },
  sidebarCollapsed: false,
  inspectorCollapsed: true,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed, ...(compactDesktop() && s.sidebarCollapsed ? { inspectorCollapsed: true } : {}) })),
  toggleInspector: () => set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed, ...(compactDesktop() && s.inspectorCollapsed ? { sidebarCollapsed: true } : {}) })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v, ...(compactDesktop() && !v ? { inspectorCollapsed: true } : {}) }),
  setInspectorCollapsed: (v) => set({ inspectorCollapsed: v, ...(compactDesktop() && !v ? { sidebarCollapsed: true } : {}) }),
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

/** One routing rule for dropped files, wherever they land: an .nrrd opens as a volume; images join the active study. */
export function routeDroppedFiles(files: File[]): void {
  const volumeFile = files.find((file) => file.name.toLowerCase().endsWith('.nrrd'))
  const images = files.filter((file) => file !== volumeFile)
  if (images.length) {
    if (!volumeFile) useShell.getState().closeVolume()
    void addFilesToActiveStudy(images)
  }
  if (volumeFile) useShell.getState().openVolume({ id: uid(), title: volumeFile.name, modality: 'Volume', file: volumeFile })
}
