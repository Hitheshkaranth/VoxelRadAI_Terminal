// Per-user opt-in for model-improvement capture. Shown only where the server operator has turned capture on.
import { useEffect, useState } from 'react'
import { readTrainingConsent, saveTrainingConsent } from '../../lib/trainingCapture'
import type { TrainingConsent as Consent } from '../../lib/trainingPrivacy'
import { SERVER_MODE } from '../../lib/session'
import { toast } from './toastStore'

export function TrainingConsent() {
  const [state, setState] = useState<Consent | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!SERVER_MODE) return
    let cancelled = false
    void readTrainingConsent().then((value) => { if (!cancelled) setState(value) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  if (!state?.serverEnabled) return null

  const change = async (consent: boolean) => {
    setSaving(true)
    try {
      setState(await saveTrainingConsent(consent))
      toast(consent ? 'Sharing de-identified cases is on' : 'Sharing turned off. Nothing new will be kept.', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save your choice.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sh-settings-section">
      <div className="sh-settings-section-head">
        <div className="sh-settings-section-title">Model improvement</div>
        <div className="sh-settings-section-desc">Optional. Off until you turn it on. Reading and reporting work the same either way.</div>
      </div>
      <div className="sh-settings-row">
        <div className="field" style={{ flex: 1, minWidth: 0 }}>
          <label className="field-label" htmlFor="sh-training-consent">Share de-identified cases to improve future models</label>
          <div className="sh-field-hint">
            {state.consent && state.consentedAt ? `On since ${new Date(state.consentedAt).toLocaleDateString()}.` : 'Off.'}
          </div>
        </div>
        <input
          id="sh-training-consent"
          type="checkbox"
          checked={state.consent}
          disabled={saving}
          onChange={(e) => void change(e.target.checked)}
          style={{ accentColor: 'var(--accent)', width: 16, height: 16 }}
        />
      </div>
      <div className="sh-about-sub">
        When on, this server keeps: a copy of each analysed image (only DICOM images that explicitly declare no burned-in text;
        a missing declaration, PNG and JPEG uploads send text only), sampled CT/MRI slices the model read, the AI findings with your accept and
        dismiss decisions, the AI draft beside your signed report, and dictation phrases that fail, are undone or are
        corrected, with their audio. Patient name, ID, referring physician, contact details, ID-like numbers and full
        dates are removed from text; only an age band and sex are kept. Text or other identifiers inside image pixels
        are not removed, so an image can still identify a patient. Records stay on this server for the retention period
        your administrator sets and may be copied to the operator's private training store. Turning this off stops new
        capture; records already kept are not deleted. Model output remains candidate findings for your review.
      </div>
    </div>
  )
}
