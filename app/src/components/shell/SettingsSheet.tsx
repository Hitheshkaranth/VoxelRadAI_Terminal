// OWNER: Agent 5. SettingsSheet — Model / Connection / Report / Appearance / Data / About.
import { useState, type ReactNode } from 'react'
import { AlertCircle, RotateCcw, Trash2 } from 'lucide-react'
import { clear } from 'idb-keyval'
import { useApp, DEFAULT_VIEWER } from '../../store'
import { checkConnection } from '../../lib/medgemma'
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
  'model-missing': 'Model not loaded',
}

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

  const detect = async () => {
    setDetecting(true)
    setModelIds([])
    try {
      const url = resolveUrl(settings.baseUrl)
      const res = await fetch(`${url}/models`, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { data?: { id?: string }[] }
      const ids = (data.data ?? []).map((m) => m.id).filter((v): v is string => Boolean(v))
      if (!ids.length) throw new Error('No models returned')
      setModelIds(ids)
      if (settings.model && !ids.includes(settings.model)) {
        // keep current selection; user may pick from the list
      }
    } catch (err) {
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
          <Field label="Detected models">
            <select
              className="select"
              value={settings.model}
              onChange={(e) => change({ model: e.target.value })}
            >
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
    if (result !== 'offline' && result !== 'model-missing') toast('Connection OK', 'success')
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

function DataControls() {
  const studies = useApp((s) => s.studies)
  const [deleting, setDeleting] = useState(false)

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