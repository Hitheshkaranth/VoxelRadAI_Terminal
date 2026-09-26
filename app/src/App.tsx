import { useEffect, useState } from 'react'
import { FileImage, FileText, Plus, ScanLine, ShieldCheck, Target } from 'lucide-react'
import { hydrate, useActiveStudy, useApp } from './store'
import { checkConnection } from './lib/medgemma'
import { runAnalysis, runAnalysisForStudy } from './lib/analysis'
import { extractImagesFromClipboard } from './lib/imageIntake'
import { addFilesToActiveStudy } from './lib/upload'
import { Sidebar } from './components/shell/Sidebar'
import { Toolbar } from './components/shell/Toolbar'
import { Inspector } from './components/shell/Inspector'
import { PatientSheet } from './components/shell/PatientSheet'
import { SettingsSheet } from './components/shell/SettingsSheet'
import { Toasts } from './components/shell/Toasts'
import { useShell } from './components/shell/shellState'
import { ErrorBoundary } from './components/shell/ErrorBoundary'
import { ImageViewer } from './components/viewer/ImageViewer'
import { Filmstrip } from './components/viewer/Filmstrip'

function useTheme() {
  const theme = useApp((s) => s.settings.theme)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () =>
      (document.documentElement.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

function useConnectionPolling() {
  const baseUrl = useApp((s) => s.settings.baseUrl)
  const model = useApp((s) => s.settings.model)
  const hydrated = useApp((s) => s.hydrated)
  useEffect(() => {
    if (!hydrated) return
    let alive = true
    const check = async () => {
      const prev = useApp.getState().connection
      if (prev === 'unknown') useApp.getState().setConnection('checking')
      const c = await checkConnection(useApp.getState().settings)
      if (alive) useApp.getState().setConnection(c)
    }
    check()
    const t = setInterval(check, 20_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [baseUrl, model, hydrated])
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return
      const st = useApp.getState()
      const shell = useShell.getState()
      const k = e.key.toLowerCase()
      if (k === 'n' && !e.shiftKey) st.createStudy()
      else if (k === ',') st.openSheet('settings')
      else if (k === 'i' && e.altKey) shell.toggleInspector()
      else if (k === 'i' && st.activeStudyId) st.openSheet('patient')
      else if (k === '\\') shell.toggleSidebar()
      else if (k === 'enter' && st.activeStudyId) {
        if (e.shiftKey) runAnalysisForStudy(st.activeStudyId)
        else if (st.activeImageId) runAnalysis(st.activeStudyId, st.activeImageId)
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
      void addFilesToActiveStudy(Array.from(e.dataTransfer!.files))
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
  const sheet = useApp((s) => s.sheet)
  const hasStudies = useApp((s) => s.studies.length > 0)
  const study = useActiveStudy()
  const activeImageId = useApp((s) => s.activeImageId)
  const { sidebarCollapsed, inspectorCollapsed } = useShell()

  useEffect(() => {
    hydrate().then(() => requestAnimationFrame(() => document.documentElement.classList.add('sh-ready')))
  }, [])
  useTheme()
  useConnectionPolling()
  useShortcuts()
  const dragging = useGlobalUpload()

  if (!hydrated) return null

  return (
    <div className="sh-app">
      <div className={`sh-sidebar-frame${sidebarCollapsed ? ' sh-collapsed' : ''}`}>
        <div style={{ width: 'var(--sidebar-w)', height: '100%' }}>
          <Sidebar />
        </div>
      </div>

      <main className="sh-content">
        {study ? (
          <>
            <Toolbar />
            <div className="sh-reading">
              <section className="sh-viewer-col" aria-label="Image viewer">
                <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                  <ErrorBoundary label="Viewer" resetKey={activeImageId}>
                    <ImageViewer />
                  </ErrorBoundary>
                </div>
                {study.images.length > 0 && <Filmstrip />}
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

      {sheet === 'patient' && <PatientSheet />}
      {sheet === 'settings' && <SettingsSheet />}
      <Toasts />
      {dragging && (
        <div className="sh-dropveil" aria-hidden>
          <div className="sh-dropveil-card">
            <FileImage strokeWidth={1.5} />
            <div>Drop to add X-ray images</div>
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
      <div className="sh-empty-mark">
        <ScanLine strokeWidth={1.5} />
      </div>
      <h1 className="sh-empty-title">Skanda Radiology</h1>
      <p className="sh-empty-desc">
        {hasStudies
          ? 'Select a study from the sidebar, or start a new one.'
          : 'AI-assisted X-ray reading with MedGemma 27B, running entirely on this Mac. Add images, review localized findings, and sign a structured report.'}
      </p>
      <button className="btn btn-primary btn-lg" onClick={() => createStudy()}>
        <Plus strokeWidth={2} /> New Study
        <span className="kbd" style={{ color: 'inherit', borderColor: 'currentColor', opacity: 0.7 }}>⌘N</span>
      </button>
      <div className="sh-empty-features">
        <div className="sh-empty-feature"><ShieldCheck strokeWidth={1.75} /> Local MedGemma 27B — no data leaves this device</div>
        <div className="sh-empty-feature"><Target strokeWidth={1.75} /> Findings localized on the image</div>
        <div className="sh-empty-feature"><FileText strokeWidth={1.75} /> Structured, signable reports</div>
      </div>
    </div>
  )
}
