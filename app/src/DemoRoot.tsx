import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowRight, FlaskConical } from 'lucide-react'
import { track } from '@vercel/analytics'
import { ThemeController } from './components/shell/ThemeSwitch'
import { TooltipProvider } from './components/ui/tooltip'
import { clearWorkspace, configureStorageScope } from './lib/workspaceStorage'
import { normalizeAnalysis } from './lib/parse'
import { useApp } from './store'
import { useShell } from './components/shell/shellState'
import type { StudyImage } from './types'
import './demo.css'

const App = lazy(() => import('./App'))

interface DemoCase { id: string; title: string; note: string; labels: string[]; image: string; width: number; height: number; raw: string; durationMs: number }

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})

/** Loads the recorded cases as ordinary studies, parsed by the same normalizer a live read uses. */
async function seed(): Promise<void> {
  const { cases } = await (await fetch('/demo/cases.json', { cache: 'no-cache' })).json() as { cases: DemoCase[] }
  const store = useApp.getState()
  const loaded = await Promise.all(cases.map(async (c) => ({ c, dataUrl: await toDataUrl(await (await fetch(c.image)).blob()) })))
  // createStudy prepends, so add in reverse to keep case 1 at the top of the list.
  for (const [index, { c, dataUrl }] of [...loaded.entries()].reverse()) {
    const studyId = store.createStudy(`Demo ${index + 1} · ${c.title}`)
    const labels = c.labels.join(', ')
    store.updatePatient(studyId, { name: `${index + 1}. ${c.title}`, patientId: c.id, indication: `Reference (3 radiologists): ${labels}. ${c.note}`, clinicalHistory: 'Public ChestX-Det test film. Recorded Skanda read from the published benchmark; nothing was run live.' })
    const image: StudyImage = { id: crypto.randomUUID(), name: `${c.id}.jpg`, mime: 'image/jpeg', dataUrl, width: c.width, height: c.height, addedAt: Date.now(), status: 'idle', sourceModality: 'CR', sourceBodyPart: 'CHEST' }
    store.addImages(studyId, [image])
    store.setImageAnalysis(studyId, image.id, normalizeAnalysis(JSON.parse(c.raw), { rawText: c.raw, model: 'skanda (recorded)', durationMs: c.durationMs }))
  }
  // Seeding writes every study in the same millisecond; space their times so "Recently updated" keeps case order.
  const base = Date.now()
  useApp.setState((st) => ({ studies: st.studies.map((study, i) => ({ ...study, updatedAt: base - i * 1000, createdAt: base - i * 1000 })) }))
  const first = useApp.getState().studies[0]
  if (first) store.selectStudy(first.id)
  // Show the case list and the findings panel; the workspace hides both by default.
  if (window.matchMedia('(min-width: 1024px)').matches) useShell.getState().setSidebarCollapsed(false)
  useShell.getState().setInspectorCollapsed(false)
}

/** Public, account-free workspace at /demo. Uses its own browser store, emptied on every visit. */
export function DemoRoot() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const hydrated = useApp((s) => s.hydrated)
  const seeded = useRef(false)
  useEffect(() => {
    document.documentElement.classList.add('demo-mode')
    track('demo_open')
    configureStorageScope('demo')
    void clearWorkspace().catch(() => {}).finally(() => setReady(true))
  }, [])
  useEffect(() => {
    if (!hydrated || seeded.current) return
    seeded.current = true
    seed().catch(() => setError('The demo cases could not be loaded. Reload to try again.'))
  }, [hydrated])
  return <>
    <ThemeController />
    <div className="demo-bar" role="note">
      <FlaskConical aria-hidden="true" />
      <span><strong>Demo workspace.</strong> <span className="demo-bar-long">Six held-out chest films with recorded Skanda reads, including a miss and a false alarm. Live analysis is off and nothing leaves your browser.</span></span>
      {error && <span className="demo-bar-error" role="alert">{error}</span>}
      <a href="/#access" onClick={() => track('access_cta', { from: 'demo' })}>Request access <ArrowRight aria-hidden="true" /></a>
      <a className="demo-bar-home" href="/">RadGenie home</a>
    </div>
    <TooltipProvider delayDuration={350}>
      {ready && <Suspense fallback={<p role="status" className="demo-loading">Loading the demo workspace…</p>}><App /></Suspense>}
    </TooltipProvider>
  </>
}
