import { lazy, Suspense, useEffect, useState } from 'react'
import { Boxes, FileImage, FileText, Plus, HardDrive, Target } from 'lucide-react'
import { track } from '@vercel/analytics'
import { hydrate, useActiveStudy, useApp } from './store'
import { DEMO_MODE } from './lib/session'
import { checkNow } from './lib/connection'
import { runAnalysisForStudy } from './lib/analysis'
import { extractImagesFromClipboard, readDroppedItems } from './lib/imageIntake'
import { addFilesToActiveStudy } from './lib/upload'
import { ClinicalContext } from './components/shell/ClinicalContext'
import { MobileNavigation, MobileHeader } from './components/shell/MobileNavigation'
import { Sidebar } from './components/shell/Sidebar'
import { Toolbar } from './components/shell/Toolbar'
import { Inspector } from './components/shell/Inspector'
import { PatientSheet } from './components/shell/PatientSheet'
import { SettingsSheet } from './components/shell/SettingsSheet'
import { ModelsSheet } from './components/shell/ModelsSheet'
import { Toasts } from './components/shell/Toasts'
import { analyzeImageAction, routeDroppedFiles, useShell } from './components/shell/shellState'
import { ErrorBoundary } from './components/shell/ErrorBoundary'
import { VOLUME_SAMPLES } from './lib/volumeSources'
import { loadRememberedAcquisitions, withRememberedAcquisition } from './lib/volumeAcquisition'
import { VolumeJobIndicator } from './components/shell/VolumeJobIndicator'
import { ImageContext } from './components/viewer/ImageContext'
import { ImageViewer } from './components/viewer/ImageViewer'
import { Filmstrip } from './components/viewer/Filmstrip'
const TemplatesSheet = lazy(() => import('./components/report/TemplatesSheet').then((m) => ({ default: m.TemplatesSheet })))

const VolumeViewer = lazy(() => import('./components/viewer/VolumeViewer').then((module) => ({ default: module.VolumeViewer })))

function useTheme() {
  const material = useApp((s) => s.settings.material ?? 'glass')
  useEffect(() => { document.documentElement.dataset.material = material }, [material])
}

function useConnectionPolling() {
  const baseUrl = useApp((s) => s.settings.baseUrl)
  const model = useApp((s) => s.settings.model)
  const hydrated = useApp((s) => s.hydrated)
  useEffect(() => {
    if (!hydrated) return
    // A settings change re-checks visibly; the background poll and window focus stay quiet.
    void checkNow()
    const poll = () => void checkNow({ quiet: true })
    const t = setInterval(poll, 20_000)
    window.addEventListener('focus', poll)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', poll)
    }
  }, [baseUrl, model, hydrated])
}

/** "(2 analysing) RadGenis" while reads run, so progress is visible from another tab. */
function useDocumentTitle() {
  const analysing = useApp((s) => s.studies.reduce((n, st) => n + st.images.filter((i) => i.status === 'analyzing').length, 0))
  useEffect(() => {
    document.title = analysing ? `(${analysing} analysing) RadGenis` : 'RadGenis'
  }, [analysing])
}

const NEW_STUDY_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥N' : 'Alt+N'

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return
      // Shortcuts must not fire while the user is typing (e.g. Cmd+Enter in a report field would start an analysis).
      const target = e.target as HTMLElement | null
      if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return
      // New study is Alt/Option+N: browsers reserve Ctrl/Cmd+N for a new window and cannot be stopped from opening one.
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyN') {
        e.preventDefault()
        useShell.getState().closeVolume(); useApp.getState().createStudy(); useShell.getState().setMobileView('viewer')
        return
      }
      if (!e.metaKey && !e.ctrlKey) return
      const st = useApp.getState()
      const shell = useShell.getState()
      const k = e.key.toLowerCase()
      if (k === ',') st.openSheet('settings')
      else if (k === 'i' && e.altKey) shell.toggleInspector()
      else if (k === 'i' && st.activeStudyId) st.openSheet('patient')
      else if (k === '\\') shell.toggleSidebar()
      else if (k === 'enter' && st.activeStudyId && !shell.volumeSource) {
        if (e.shiftKey) runAnalysisForStudy(st.activeStudyId)
        else if (st.activeImageId) analyzeImageAction(st.activeStudyId, st.activeImageId)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Drop files anywhere / paste anywhere → add to the active study. Also stops Chrome from navigating to a dropped file. */
function useGlobalUpload() {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setDragging(true)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      depth = 0
      setDragging(false)
      if (!hasFiles(e)) return
      e.preventDefault()
      // readDroppedItems also walks dropped folders (DICOM series exports).
      void readDroppedItems(e.dataTransfer!).then(routeDroppedFiles)
    }
    // Capture phase so nested drop targets can't swallow the event and leave the overlay stuck.
    const reset = () => {
      depth = 0
      setDragging(false)
    }
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return
      const files = extractImagesFromClipboard(e)
      if (files.length) {
        e.preventDefault()
        void addFilesToActiveStudy(files)
      }
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('drop', reset, true)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('drop', reset, true)
      window.removeEventListener('paste', onPaste)
    }
  }, [])
  return dragging
}

export default function App() {
  const hydrated = useApp((s) => s.hydrated)
  const [detailsReady, setDetailsReady] = useState(false)
  const sheet = useApp((s) => s.sheet)
  const hasStudies = useApp((s) => s.studies.length > 0)
  const study = useActiveStudy()
  const activeImageId = useApp((s) => s.activeImageId)
  const { sidebarCollapsed, inspectorCollapsed, mobileView, volumeSource } = useShell()
  // /workspace#templates (from the profile page) opens the report letterhead and template editor.
  const [templatesOpen, setTemplatesOpen] = useState(() => window.location.hash === '#templates')
  const institution = useApp((s) => s.settings.institution)
  useEffect(() => {
    const follow = () => { if (window.location.hash === '#templates') setTemplatesOpen(true) }
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [])
  const closeTemplates = () => { setTemplatesOpen(false); if (window.location.hash === '#templates') window.history.replaceState(null, '', window.location.pathname + window.location.search) }

  useEffect(() => {
    // Remembered scan acquisition details load with the workspace, before the volume viewer first renders.
    hydrate().then(() => loadRememberedAcquisitions().catch(() => {})).then(() => {
      const open = useShell.getState().volumeSource
      if (open) { const withDetails = withRememberedAcquisition(open); if (withDetails !== open) useShell.setState({ volumeSource: withDetails }) }
      setDetailsReady(true)
      requestAnimationFrame(() => document.documentElement.classList.add('sh-ready'))
    })
  }, [])
  useEffect(() => {
    const followAddress = () => {
      const id = new URLSearchParams(window.location.hash.slice(1)).get('volume')
      const source = VOLUME_SAMPLES.find((sample) => sample.id === id)
      if (source) useShell.getState().openVolume(source)
      else if (useShell.getState().volumeSource) useShell.getState().closeVolume()
    }
    window.addEventListener('hashchange', followAddress)
    return () => window.removeEventListener('hashchange', followAddress)
  }, [])
  useEffect(() => {
    // The demo keeps its case list visible so visitors can move between the recorded reads.
    if (activeImageId && !volumeSource && !DEMO_MODE) useShell.getState().setSidebarCollapsed(true)
  }, [activeImageId, volumeSource])
  useTheme()
  useConnectionPolling()
  useDocumentTitle()
  useShortcuts()
  const dragging = useGlobalUpload()

  if (!hydrated || !detailsReady) return null

  return (
    <div className="sh-app" data-mobile-view={study || volumeSource ? mobileView : 'studies'}>
      <MobileHeader />
      {templatesOpen && <Suspense fallback={null}><TemplatesSheet open onClose={closeTemplates} institution={institution} /></Suspense>}
      <div className={`sh-sidebar-frame${sidebarCollapsed ? ' sh-collapsed' : ''}`}>
        <div style={{ width: 'var(--sidebar-w)', height: '100%' }}>
          <Sidebar />
        </div>
      </div>

      <main className={`sh-content${volumeSource || study ? ' scan-content' : ''}`}>
        <VolumeJobIndicator />
        {volumeSource ? <Suspense fallback={<p role="status">Loading volume viewer…</p>}><VolumeViewer key={`${volumeSource.id}:${JSON.stringify(volumeSource.acquisition ?? null)}`} source={volumeSource} /></Suspense> : study ? (
          <>
            <Toolbar />
            <details className="scan-patient-context" open={DEMO_MODE || undefined}><summary>Patient &amp; clinical context</summary><ClinicalContext /></details>
            <div className="sh-reading">
              <section className="sh-viewer-col" aria-label="Image viewer">
                <div className="scan-image-surface" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                  <ImageContext />
                  <ErrorBoundary label="Viewer" resetKey={activeImageId}>
                    <ImageViewer />
                  </ErrorBoundary>
                </div>
                {study.images.length > 0 && <details className="image-series-tray"><summary>Images ({study.images.length})</summary><Filmstrip /></details>}
              </section>
              <div className={`sh-inspector-frame${inspectorCollapsed ? ' sh-collapsed' : ''}`}>
                <div style={{ width: 'var(--inspector-w)', height: '100%' }}>
                  <ErrorBoundary label="Inspector" resetKey={activeImageId}>
                    <Inspector />
                  </ErrorBoundary>
                </div>
              </div>
            </div>
          </>
        ) : (
          <Welcome hasStudies={hasStudies} />
        )}
      </main>

      <MobileNavigation />
      {sheet === 'patient' && <PatientSheet />}
      {sheet === 'settings' && <SettingsSheet />}
      {sheet === 'models' && <ModelsSheet />}
      <Toasts />
      {dragging && (
        <div className="sh-dropveil" aria-hidden>
          <div className="sh-dropveil-card">
            <FileImage strokeWidth={1.5} />
            <div>Drop to add images</div>
            <span>{study ? `to “${study.patient.name || study.title}”` : 'A new study will be created'}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Welcome({ hasStudies }: { hasStudies: boolean }) {
  const createStudy = useApp((s) => s.createStudy)
  return (
    <div className="sh-empty">
      <img className="sh-empty-logo" src="/skanda-mark.png" alt="RadGenis" />
      <h1 className="sh-empty-title">RadGenis</h1>
      <p className="sh-empty-desc">
        {hasStudies
          ? 'Select a study from the sidebar, or start a new one.'
          : 'Review X-ray, CT and MRI images in one workspace. Add a study or open a sample, review the evidence, and prepare a report.'}
      </p>
      <button className="btn btn-primary btn-lg" onClick={() => createStudy()}>
        <Plus strokeWidth={2} /> New Study
        <span className="kbd" style={{ color: 'inherit', borderColor: 'currentColor', opacity: 0.7 }}>{NEW_STUDY_KEY}</span>
      </button>
      <div className="sh-empty-features">
        <div className="sh-empty-feature"><HardDrive strokeWidth={1.75} /> Studies saved in this browser</div>
        <div className="sh-empty-feature"><Target strokeWidth={1.75} /> Review findings against the scan</div>
        <div className="sh-empty-feature"><FileText strokeWidth={1.75} /> Structured, signable reports</div>
      </div>
      <button type="button" className="btn btn-sm" onClick={() => { useApp.getState().openSheet('models'); track('open_models', { from: 'welcome' }) }}>
        <Boxes strokeWidth={1.75} /> Open models &amp; benchmarks
      </button>
    </div>
  )
}
