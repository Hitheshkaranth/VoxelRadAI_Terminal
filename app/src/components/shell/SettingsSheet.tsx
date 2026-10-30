// OWNER: Agent 5. SettingsSheet — Model / Connection / Report / Appearance / Data / About.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AlertCircle, RotateCcw, Trash2 } from 'lucide-react'
import { clear } from 'idb-keyval'
import { useApp, DEFAULT_VIEWER, storageInfo } from '../../store'
import { checkConnection } from '../../lib/medgemma'
import { mairaHealth, mairaLoad, mairaUnload } from '../../lib/maira'
import { toast } from './toastStore'
import { Sheet } from './Sheet'
import { useShell } from './shellState'
import type { ConnectionState, Settings } from '../../types'
import './shell.css'

const VERSION = 'v1.0.0'

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  unknown: 'Not connected',
  checking: 'Checking…',
  online: 'Connected',
  offline: 'Offline',
  'model-missing': 'Model id not loaded (exact match required)',
}

const DEFAULT_MAIRA_KINDS = ['effusion', 'nodule / mass', 'atelectasis']

export function SettingsSheet() {
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const openSheet = useApp((s) => s.openSheet)
  const { setSidebarCollapsed, setInspectorCollapsed } = useShell()
  const [open] = useState(true)

  const change = (patch: Partial<Settings>) => updateSettings(patch)

  return (
    <Sheet open={open} onClose={() => openSheet(null)} title="Settings" subtitle="Model, connection, and appearance.">
      <Section title="Model" desc="Local MedGemma 27B served through LM Studio.">
        <div className="sh-settings-row" style={{ flexWrap: 'wrap' }}>
          <Field label="LM Studio base URL" fullWidth>
            <input
              className="input"
              value={settings.baseUrl}
              onChange={(e) => change({ baseUrl: e.target.value })}
              placeholder="/lmstudio/v1"
            />
          </Field>
        </div>

        <ModelControls settings={settings} change={change} />

        <Field label="Temperature">
          <input
            className="sh-range"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={settings.temperature}
            onChange={(e) => change({ temperature: Number(e.target.value) })}
          />
          <div className="sh-field-hint">Lower = more deterministic. 0.2 is a good default.</div>
        </Field>

        <Field label="Max tokens">
          <input
            className="input"
            type="number"
            min={256}
            value={settings.maxTokens}
            onChange={(e) => change({ maxTokens: Number(e.target.value) })}
          />
        </Field>
      </Section>

      <ConnectionControls />

      <SecondReaderControls settings={settings} change={change} />

      <Section title="Report" desc="Default text prefilled into each report.">
        <Field label="Institution">
          <input
            className="input"
            value={settings.institution}
            onChange={(e) => change({ institution: e.target.value })}
            placeholder="Skanda Radiology"
          />
        </Field>
        <Field label="Default radiologist">
          <input
            className="input"
            value={settings.radiologist}
            onChange={(e) => change({ radiologist: e.target.value })}
            placeholder="Dr. Ray"
          />
        </Field>
      </Section>

      <Section title="Appearance">
        <div className="sh-settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
          <Field label="Theme">
            <div className="segmented" role="tablist" aria-label="Theme">
              {(['system', 'light', 'dark'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={settings.theme === t}
                  onClick={() => change({ theme: t })}
                >
                  {t === 'system' ? 'System' : t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Section>

      <DataControls />

      <AboutSection />

      <div className="sh-sheet-foot">
        <button type="button" className="btn btn-primary" onClick={() => {
          openSheet(null)
          setSidebarCollapsed(false)
          setInspectorCollapsed(false)
        }}>
          Done
        </button>
      </div>
    </Sheet>
  )
}

function ModelControls({ settings, change }: { settings: Settings; change: (p: Partial<Settings>) => void }) {
  const [detecting, setDetecting] = useState(false)
  const [modelIds, setModelIds] = useState<string[]>([])
  const [matchNote, setMatchNote] = useState<string | null>(null)

  const detect = async () => {
    setDetecting(true)
    setModelIds([])
    setMatchNote(null)
    try {
      const url = resolveUrl(settings.baseUrl)
      const res = await fetch(`${url}/models`, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { data?: { id?: string }[] }
      const ids = (data.data ?? []).map((m) => m.id).filter((v): v is string => Boolean(v))
      if (!ids.length) throw new Error('No models returned')
      setModelIds(ids)
      // The app needs the exact id; a near match would silently send requests to a different model.
      if (!settings.model) setMatchNote('No model id set — pick one from the list.')
      else if (ids.includes(settings.model)) setMatchNote(`Exact match: “${settings.model}” is loaded.`)
      else setMatchNote(`“${settings.model}” is not loaded under that exact id — pick one from the list.`)
    } catch {
      setModelIds([])
      toast('Could not list models — is LM Studio running?', 'error')
    } finally {
      setDetecting(false)
    }
  }

  return (
    <>
      <div className="sh-settings-row">
        <Field label="Model id">
          <input
            className="input"
            value={settings.model}
            onChange={(e) => change({ model: e.target.value })}
            placeholder="medgemma-27b-it"
          />
        </Field>
        <button type="button" className="btn btn-primary" disabled={detecting} onClick={detect} style={{ alignSelf: 'flex-end', height: '28px' }}>
          {detecting ? <Spinner /> : <RotateCcw />} Detect
        </button>
      </div>

      {modelIds.length > 0 && (
        <div className="sh-settings-row">
          <Field label="Detected models" hint={matchNote ?? undefined}>
            <select
              className="select"
              value={modelIds.includes(settings.model) ? settings.model : ''}
              onChange={(e) => {
                change({ model: e.target.value })
                setMatchNote(`Exact match: “${e.target.value}” is loaded.`)
              }}
            >
              {!modelIds.includes(settings.model) && <option value="" disabled>Select a model…</option>}
              {modelIds.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>
        </div>
      )}
    </>
  )
}

function ConnectionControls() {
  const settings = useApp((s) => s.settings)
  const setConnection = useApp((s) => s.setConnection)
  const [testing, setTesting] = useState(false)
  const [testStatus, setTestStatus] = useState<ConnectionState | null>(null)

  const test = async () => {
    setTesting(true)
    setTestStatus(null)
    const result = await checkConnection(settings)
    setConnection(result)
    setTestStatus(result)
    setTesting(false)
    if (result === 'online') toast('Connection OK', 'success')
  }

  return (
    <Section title="Connection" desc="Test the link to LM Studio.">
      <div className="sh-settings-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          {testStatus ? (
            <div className="sh-about-sub">
              <StatusDot status={testStatus} />{' '}
              {CONNECTION_LABEL[testStatus]}
            </div>
          ) : (
            <div className="sh-about-sub">Not tested yet.</div>
          )}
        </div>
        <button type="button" className="btn btn-primary" disabled={testing} onClick={test} style={{ height: '28px' }}>
          {testing ? <Spinner /> : <AlertCircle />} Test
        </button>
      </div>
    </Section>
  )
}

type MairaStatus = Awaited<ReturnType<typeof mairaHealth>>

function mairaLabel(h: MairaStatus | null): string {
  if (!h) return 'Checking…'
  if (!h.running) return 'Not running'
  if (!h.loaded) return 'Running, not loaded'
  return `Loaded (~${h.memGB ? Math.round(h.memGB) : 14} GB${h.device ? `, ${h.device}` : ''})`
}

/**
 * Optional MAIRA-2 second reader. Health is polled when the sheet opens; the model is only ever loaded by
 * the Load button here — never automatically — because it cannot share 24 GB with MedGemma.
 */
function SecondReaderControls({ settings, change }: { settings: Settings; change: (p: Partial<Settings>) => void }) {
  const maira = settings.maira ?? { enabled: false, kinds: DEFAULT_MAIRA_KINDS }
  const [health, setHealth] = useState<MairaStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setHealth(null)
    try {
      setHealth(await mairaHealth())
    } catch {
      setHealth({ running: false, loaded: false })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    mairaHealth()
      .catch(() => ({ running: false, loaded: false }))
      .then((h) => {
        if (!cancelled) setHealth(h)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const act = async (fn: typeof mairaLoad, done: string) => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await fn()
      setMessage(r.message ?? (r.ok ? done : 'Request failed.'))
    } catch {
      setMessage('Could not reach the MAIRA-2 service.')
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  return (
    <Section
      title="Second reader (MAIRA-2)"
      desc="Optional second model for the classes MedGemma tends to miss. Its findings are cross-checked by the classifier and labelled as second-reader findings."
    >
      <div className="sh-settings-row">
        <div className="field" style={{ flex: 1, minWidth: 0 }}>
          <label className="field-label" htmlFor="sh-maira-enabled">Use second reader</label>
          <div className="sh-field-hint">Off by default. Runs as a batch over analysed images, not per image.</div>
        </div>
        <input
          id="sh-maira-enabled"
          type="checkbox"
          checked={maira.enabled}
          onChange={(e) => change({ maira: { ...maira, enabled: e.target.checked } })}
          style={{ accentColor: 'var(--accent)', width: 16, height: 16 }}
        />
      </div>
      <div className="sh-settings-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sh-about-sub">Finding types it may add: {maira.kinds.join(', ') || '—'}</div>
        </div>
      </div>
      <div className="sh-settings-row" style={{ flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }} aria-live="polite">
          <div className="sh-about-sub">Status: {mairaLabel(health)}</div>
          {message && <div className="sh-about-sub">{message}</div>}
        </div>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void refresh()}>
          <RotateCcw /> Refresh
        </button>
        {health?.running && !health.loaded && (
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void act(mairaLoad, 'MAIRA-2 loaded.')}>
            {busy ? <Spinner /> : null} Load
          </button>
        )}
        {health?.loaded && (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void act(mairaUnload, 'MAIRA-2 unloaded.')}>
            {busy ? <Spinner /> : null} Unload
          </button>
        )}
      </div>
      <div className="sh-settings-row">
        <div className="sh-disclaimer" style={{ flex: 1 }}>
          <AlertCircle />
          <span>
            MAIRA-2 needs about 14 GB and cannot be loaded while MedGemma 27B is loaded in LM Studio on a 24 GB machine.
            Workflow: analyse the study with MedGemma, unload it in LM Studio, load MAIRA-2 here, run the second reader,
            then unload MAIRA-2 before analysing more images.
          </span>
        </div>
      </div>
    </Section>
  )
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  return `${Math.round(n / 1e3)} KB`
}

function DataControls() {
  const studies = useApp((s) => s.studies)
  const [deleting, setDeleting] = useState(false)
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof storageInfo>> | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void storageInfo().then((info) => {
      if (!cancelled) setStorage(info)
    })
    return () => {
      cancelled = true
    }
  }, [studies.length])

  const deleteAll = async () => {
    setDeleting(true)
    try {
      await clear()
      useApp.setState({
        studies: [],
        activeStudyId: null,
        activeImageId: null,
        selectedFindingId: null,
        viewer: DEFAULT_VIEWER,
        sheet: null,
        inspectorTab: 'findings',
      })
      toast('All studies deleted', 'success')
    } finally {
      setDeleting(false)
    }
  }

  const hasStudies = studies.length > 0

  return (
    <Section title="Data" desc="Manage locally stored studies.">
      <div className="sh-settings-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sh-about-sub">
            {storage === undefined
              ? 'Checking storage…'
              : storage === null
                ? 'Storage usage is not available in this browser.'
                : `Storage: ${formatBytes(storage.usage)} used of ${formatBytes(storage.quota)} · persistent: ${storage.persisted ? 'yes' : 'no (the browser may evict data under storage pressure)'}`}
          </div>
        </div>
      </div>
      {!hasStudies ? (
        <div className="sh-about-sub">No studies stored on this device.</div>
      ) : (
        <div className="sh-delete-confirm">
          <Trash2 />
          <div className="sh-delete-note">
            Permanently delete all {studies.length} study{studies.length === 1 ? '' : 's'} and clear IndexedDB?
          </div>
          <button type="button" className="btn btn-sm btn-destructive" disabled={deleting} onClick={deleteAll}>
            {deleting ? <Spinner /> : null} Delete all
          </button>
        </div>
      )}
    </Section>
  )
}

function AboutSection() {
  return (
    <Section title="About" desc="Skanda Radiology decision support.">
      <div className="sh-about">
        <img className="sh-about-logo" src="/skanda-mark.png" alt="" aria-hidden />
        <div className="sh-about-title">Skanda Radiology</div>
        <div className="sh-about-sub">Version {VERSION}</div>
        <div className="sh-disclaimer">
          <AlertCircle />
          <span>
            Skanda Radiology provides AI-generated decision support only. All findings must be reviewed and verified by a
            qualified radiologist before any clinical decision is made. This tool is not a medical device.
          </span>
        </div>
      </div>
    </Section>
  )
}

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="sh-settings-section">
      <div className="sh-settings-section-head">
        <div className="sh-settings-section-title">{title}</div>
        {desc && <div className="sh-settings-section-desc">{desc}</div>}
      </div>
      {children}
    </div>
  )
}

function Field({ label, hint, children, fullWidth }: { label: string; hint?: string; children: ReactNode; fullWidth?: boolean }) {
  return (
    <div className="field" style={fullWidth ? { flex: '1 1 100%' } : undefined}>
      <label className="field-label">{label}</label>
      {children}
      {hint && <div className="sh-field-hint">{hint}</div>}
    </div>
  )
}

function StatusDot({ status }: { status: ConnectionState }) {
  const cls =
    status === 'online' ? 'sh-status-dot--online' :
      status === 'model-missing' ? 'sh-status-dot--missing' :
        status === 'checking' ? 'sh-status-dot--checking' : 'sh-status-dot--offline'
  return <span className={`sh-status-dot ${cls}`} />
}

function Spinner() {
  return <span className="spinner" aria-label="Loading" />
}

function resolveUrl(baseUrl: string): string {
  if (/^https?:\/\//i.test(baseUrl)) return baseUrl
  return `${window.location.origin}${baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`}`
}