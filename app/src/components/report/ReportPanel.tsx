// OWNER: Agent 4 (Report). The inspector report editor, sign-off, and print/copy/export bar.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Download, Edit3, FileText, Printer, RefreshCw, ShieldCheck, Unlock } from 'lucide-react'
import { useActiveStudy, useApp } from '../../store'
import { cancelReport, generateStudyReport, useReportJob } from '../../lib/analysis'
import type { ReportDraft, Study } from '../../types'
import { downloadFile, reportToPlainText, studyFileName, studyToJson } from '../../lib/reportExport'
import { PrintReport } from './PrintReport'
import './report.css'

type ReportFieldKey = 'technique' | 'comparison' | 'findings' | 'impression' | 'recommendations'

const REPORT_FIELDS: { key: ReportFieldKey; label: string }[] = [
  { key: 'technique', label: 'Technique' },
  { key: 'comparison', label: 'Comparison' },
  { key: 'findings', label: 'Findings' },
  { key: 'impression', label: 'Impression' },
  { key: 'recommendations', label: 'Recommendations' },
]

interface AutoGrowFieldProps {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  placeholder?: string
  label?: string
  hint?: string
}

/** A textarea that grows to fit its content. Value is the single source of truth; caret stays stable. */
function AutoGrowField({ value, onChange, readOnly, placeholder, label, hint }: AutoGrowFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const adjust = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useLayoutEffect(adjust, [adjust])

  return (
    <div className="rp-field">
      {label ? (
        <div className="rp-field-label">{label}</div>
      ) : null}
      <textarea
        ref={ref}
        className="rp-field-textarea"
        rows={1}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange?.(e.target.value)}
      />
      {hint ? <div className="rp-field-hint">{hint}</div> : null}
    </div>
  )
}

function StatusChip({ userEdited, signed }: { userEdited: boolean; signed: boolean }) {
  if (signed) return null
  if (userEdited) {
    return (
      <span className="rp-pill rp-pill-edited">
        <Check size={12} /> Edited
      </span>
    )
  }
  return (
    <span className="rp-pill rp-pill-draft">
      <FileText size={12} /> AI draft
    </span>
  )
}

export function ReportPanel() {
  const study = useActiveStudy() as Study | null
  const settings = useApp((s) => s.settings)
  const reportJob = useReportJob()
  const setReport = useApp((s) => s.setReport)
  const openSheet = useApp((s) => s.openSheet)

  const [confirmRegen, setConfirmRegen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [userEdited, setUserEdited] = useState(false)

  const report = study?.report ?? null
  const signed = report?.signed ?? false
  const patient = study?.patient ?? null

  const analyzedCount = useMemo(
    () => (study ? study.images.filter((img) => img.analysis != null).length : 0),
    [study],
  )
  const totalCount = study?.images.length ?? 0

  const onFieldChange = useCallback(
    (key: ReportFieldKey) => (value: string) => {
      if (!study) return
      setReport(study.id, { [key]: value } as Partial<ReportDraft>)
      setUserEdited(true)
    },
    [study, setReport],
  )

  const onSign = useCallback(() => {
    if (!study || !report) return
    setReport(study.id, { signed: true, signedAt: Date.now(), radiologist: report.radiologist })
  }, [study, report, setReport])

  const onUnlock = useCallback(() => {
    if (!study || !report) return
    setReport(study.id, { signed: false, signedAt: undefined })
  }, [study, setReport])

  const onRegenConfirm = useCallback(() => {
    if (!study) return
    setConfirmRegen(false)
    setUserEdited(false)
    generateStudyReport(study.id)
  }, [study])

  const plain = useMemo(() => (study ? reportToPlainText(study, settings) : ''), [study, settings])

  const onCopy = useCallback(async () => {
    await navigator.clipboard.writeText(plain)
    setCopied(true)
  }, [plain])

  const onDownloadTxt = useCallback(() => {
    if (!study) return
    downloadFile(studyFileName(study, 'txt'), plain, 'text/plain')
  }, [study, plain])

  const onDownloadJson = useCallback(() => {
    if (!study) return
    const json = JSON.stringify(studyToJson(study, settings, { includeDataUrls: false }), null, 2)
    downloadFile(studyFileName(study, 'json'), json, 'application/json')
  }, [study, settings])

  // Reset transient UI state when the active study changes.
  const studyKey = study?.id ?? ''
  const [prevStudy, setPrevStudy] = useState(studyKey)
  if (prevStudy !== studyKey) {
    setPrevStudy(studyKey)
    setConfirmRegen(false)
    setUserEdited(false)
    setCopied(false)
    setPreviewOpen(false)
  }

  if (!study) {
    return (
      <div className="rp-panel">
        <div className="rp-empty">
          <div className="rp-empty-ico">
            <FileText />
          </div>
          <div className="rp-empty-title">No study open</div>
          <div className="rp-empty-text">Select or create a study to view or draft its report.</div>
        </div>
      </div>
    )
  }

  if (analyzedCount === 0) {
    return (
      <div className="rp-panel">
        <div className="rp-empty">
          <div className="rp-empty-ico">
            <FileText />
          </div>
          <div className="rp-empty-title">Draft your report</div>
          <div className="rp-empty-text">
            Analyze at least one image to draft a report. MedGemma will synthesize all analyzed images and patient
            context into a structured, signable report.
          </div>
          <div className="rp-empty-count">{analyzedCount} of {totalCount} images analyzed</div>
        </div>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="rp-panel">
        <div className="card rp-draft-card">
          {reportJob.running ? (
            <div className="rp-progress">
              <div className="rp-progress-row">
                <div className="spinner" />
                <span className="rp-progress-text">{reportJob.progressText ?? 'Drafting report…'}</span>
              </div>
              <div className="rp-progress-bar">
                <span />
              </div>
            </div>
          ) : (
            <>
              <div className="rp-draft-title">Draft report from analyzed images</div>
              <div className="rp-draft-text">
                MedGemma will synthesize all {analyzedCount} analyzed image{analyzedCount === 1 ? '' : 's'} and the
                patient context into a structured, editable, signable report.
              </div>
            </>
          )}
          {reportJob.error ? <div className="rp-progress-error">{reportJob.error}</div> : null}
          <div className="rp-actions" style={{ marginTop: 'var(--sp-4)' }}>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={reportJob.running}
              onClick={() => generateStudyReport(study.id)}
            >
              {reportJob.running ? <div className="spinner" /> : <FileText size={16} />}{' '}
              {reportJob.running ? 'Drafting…' : 'Draft Report'}
            </button>
            {reportJob.running ? (
              <button type="button" className="btn btn-destructive" onClick={cancelReport}>
                Cancel
              </button>
            ) : null}
          </div>
        </div>
        <div className="rp-disclaimer">
          AI-generated decision support — findings must be verified by a qualified radiologist before clinical use.
        </div>
      </div>
    )
  }

  // Report editor.
  const updatedLabel = report.updatedAt ? new Date(report.updatedAt).toLocaleString() : ''

  return (
    <div className="rp-panel">
      <div className="card">
        <div className="rp-report-head">
          <div>
            <div className="rp-report-subtitle">Patient</div>
            <div className="rp-patient-name">{patient?.name || 'Untitled patient'}</div>
          </div>
          <button type="button" className="btn btn-plain btn-sm" onClick={() => openSheet('patient')}>
            <Edit3 size={14} /> Edit
          </button>
        </div>

        <div className="rp-summary">
          <div className="rp-summary-cell">
            <span className="rp-summary-label">Patient ID</span>
            <span className="rp-summary-value">{patient?.patientId || '—'}</span>
          </div>
          <div className="rp-summary-cell">
            <span className="rp-summary-label">Age / Sex</span>
            <span className="rp-summary-value">
              {[patient?.age, patient?.sex].filter(Boolean).join(' /') || '—'}
            </span>
          </div>
          <div className="rp-summary-cell">
            <span className="rp-summary-label">Study Date</span>
            <span className="rp-summary-value">{patient?.studyDate || '—'}</span>
          </div>
          <div className="rp-summary-cell">
            <span className="rp-summary-label">Indication</span>
            <span className="rp-summary-value">{patient?.indication ? 'Added' : '—'}</span>
          </div>
        </div>
      </div>

      <div className="rp-status">
        <StatusChip userEdited={userEdited} signed={signed} />
        <span className="rp-report-meta">Updated {updatedLabel}</span>
      </div>

      {signed ? (
        <div className="rp-seal">
          <div className="rp-seal-ico">
            <ShieldCheck />
          </div>
          <div className="rp-seal-text">
            <span className="rp-seal-name">Signed by {report.radiologist || 'radiologist'}</span>
            <span className="rp-seal-date">
              {report.signedAt ? new Date(report.signedAt).toLocaleString() : '—'}
            </span>
          </div>
          <div className="rp-seal-actions">
            <button type="button" className="btn btn-plain btn-sm" onClick={onUnlock}>
              <Unlock size={14} /> Unlock to edit
            </button>
          </div>
        </div>
      ) : (
        <div className="rp-rad-row">
          <div className="rp-field">
            <div className="rp-field-label">Radiologist</div>
            <textarea
              className="rp-field-textarea"
              rows={1}
              value={report.radiologist}
              aria-label="Radiologist name"
              placeholder="Add radiologist name…"
              onChange={(e) => {
                setReport(study.id, { radiologist: e.target.value } as Partial<ReportDraft>)
              }}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!report.radiologist.trim()}
            onClick={onSign}
          >
            <ShieldCheck size={15} /> Sign Report
          </button>
        </div>
      )}

      <AutoGrowField
        value={patient?.indication ?? ''}
        readOnly
        label="Clinical Indication"
        placeholder="No indication recorded"
        hint="Taken from the patient record."
      />

      {REPORT_FIELDS.map((field) => (
        <AutoGrowField
          key={field.key}
          value={report[field.key]}
          label={field.label}
          placeholder={`Add ${field.label.toLowerCase()}…`}
          onChange={onFieldChange(field.key)}
        />
      ))}

      {confirmRegen ? (
        <div className="rp-confirm">
          <span className="rp-confirm-text">
            Regenerate this report from all {analyzedCount} analyzed image{analyzedCount === 1 ? '' : 's'}? Any edits
            since the last draft will be replaced.
          </span>
          <button type="button" className="btn btn-destructive btn-sm" onClick={onRegenConfirm}>
            Confirm
          </button>
          <button type="button" className="btn btn-plain btn-sm" onClick={() => setConfirmRegen(false)}>
            Cancel
          </button>
        </div>
      ) : null}

      <div className="rp-actions">
        <button
          type="button"
          className="btn btn-plain btn-sm"
          disabled={reportJob.running}
          onClick={() => setConfirmRegen(true)}
        >
          <RefreshCw size={14} /> Regenerate
        </button>
      </div>

      <div className="rp-export">
        <button
          type="button"
          className="btn btn-primary rp-btn-full"
          onClick={() => setPreviewOpen(true)}
        >
          <Printer size={15} /> Preview &amp; Print / PDF
        </button>
        <button type="button" className="btn btn-sm" onClick={onCopy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn btn-sm" onClick={onDownloadTxt}>
          <Download size={14} /> Download .txt
        </button>
        <button type="button" className="btn btn-sm" onClick={onDownloadJson}>
          <Download size={14} /> Download JSON
        </button>
      </div>

      {copied ? (
        <div className="rp-toast">
          <Check size={14} /> Copied to clipboard
        </div>
      ) : null}

      <div className="rp-disclaimer">
        AI-generated decision support — findings must be verified by a qualified radiologist before clinical use.
      </div>

      {previewOpen ? (
        <PrintReport study={study} settings={settings} onClose={() => setPreviewOpen(false)} />
      ) : null}
    </div>
  )
}