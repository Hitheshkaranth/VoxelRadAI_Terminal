// "Saved · 2 min ago" / "Saving…" / "Not saved: …" beside the study title on the hosted site.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, Check, CloudUpload } from 'lucide-react'
import { autoSaveState, startAutoSave, subscribeAutoSave } from '../../lib/autoSave'
import { SERVER_MODE } from '../../lib/session'
import { useApp } from '../../store'

const ago = (at: number, now: number) => {
  const s = Math.max(0, Math.round((now - at) / 1000))
  return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function AutoSaveStatus({ studyId }: { studyId: string | undefined }) {
  useEffect(() => { startAutoSave() }, [])
  const state = useSyncExternalStore(subscribeAutoSave, () => autoSaveState(studyId))
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t) }, [])
  if (!SERVER_MODE || !state) return null
  const problem = state.status === 'conflict' || state.status === 'too-large' || state.status === 'error'
  const text = state.status === 'saved' ? `Saved${state.at ? ` · ${ago(state.at, now)}` : ''}`
    : state.status === 'saving' ? 'Saving…' : state.status === 'pending' ? 'Unsaved changes' : 'Not saved'
  return <button type="button" className="autosave" data-status={state.status} role="status" aria-live="polite"
    title={state.message ?? (state.status === 'saved' ? 'Patient details, scans, findings and report are saved to your account.' : 'Changes are saved to your account automatically.')}
    onClick={problem ? () => useApp.getState().openSheet('settings') : undefined} disabled={!problem}>
    {problem ? <AlertTriangle aria-hidden="true" /> : state.status === 'saved' ? <Check aria-hidden="true" /> : <CloudUpload aria-hidden="true" />}
    <span>{text}</span>
  </button>
}
