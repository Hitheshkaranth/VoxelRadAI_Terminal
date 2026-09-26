// OWNER: Agent 4 (Report). The inspector report editor, sign-off, and print/copy/export bar.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowRightCircle,
  Check,
  ClipboardList,
  Copy,
  Download,
  Edit3,
  FileJson,
  FileText,
  GitCompare,
  ListChecks,
  Printer,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Stethoscope,
  Unlock,
} from 'lucide-react'
import { useActiveStudy, useApp } from '../../store'
import { cancelReport, generateStudyReport, useReportJob } from '../../lib/analysis'
import type { ReportDraft, Study } from '../../types'
import { downloadFile, reportToPlainText, studyFileName, studyToJson } from '../../lib/reportExport'
import { PrintReport } from './PrintReport'
import './report.css'

type ReportFieldKey = 'technique' | 'comparison' | 'findings' | 'impression' | 'recommendations'

const REPORT_FIELDS: { key: ReportFieldKey; label: string; icon: ReactNode; emphasis?: boolean }[] = [
  { key: 'technique', label: 'Technique', icon: <ScanLine /> },
  { key: 'comparison', label: 'Comparison', icon: <GitCompare /> },
  { key: 'findings', label: 'Findings', icon: <ListChecks /> },
  { key: 'impression', label: 'Impression', icon: <Stethoscope />, emphasis: true },
  { key: 'recommendations', label: 'Recommendations', icon: <ArrowRightCircle /> },
]

interface AutoGrowFieldProps {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  placeholder?: string
  label?: string
  hint?: string
  icon?: ReactNode
  emphasis?: boolean
}

/** A textarea that grows to fit its content. Value is the single source of truth; caret stays stable. */
function AutoGrowField({ value, onChange, readOnly, placeholder, label, hint, icon, emphasis }: AutoGrowFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const adjust = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  // Re-measure whenever the text changes and whenever the panel width changes (wrapping changes height).
  useLayoutEffect(adjust, [adjust, value])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(adjust)
    ro.observe(el)
    return () => ro.disconnect()
  }, [adjust])

  return (
    <section className={`rp-sec${readOnly ? ' rp-sec-ro' : ''}${emphasis ? ' rp-sec-em' : ''}`}>
      {label ? (
        <label className="rp-sec-head">
          {icon}
          {label}
        </label>
      ) : null}
      <textarea
        ref={ref}
        className="rp-sec-text"
        rows={1}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange?.(e.target.value)}
      />
      {hint ? <div className="rp-sec-hint">{hint}</div> : null}
    </section>
  )
}

function initials(name?: string) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return parts.length ? (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() : '?'
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
    setTimeout(() => setCopied(false), 1800)
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
      <section className="rp-card rp-patient">
        <div className="rp-patient-top">
          <div className="rp-patient-id">
            <div className="rp-avatar" aria-hidden>
              {initials(patient?.name)}
            </div>
            <div>
              <div className="rp-patient-name">{patient?.name || 'Unnamed patient'}</div>
              <div className="rp-patient-sub">
                {[patient?.patientId, [patient?.age, patient?.sex].filter(Boolean).join(' · ')].filter(Boolean).join('  ·  ') ||
                  'No demographics recorded'}
              </div>
            </div>
          </div>
          <button type="button" className="btn btn-plain btn-sm" onClick={() => openSheet('patient')}>
            <Edit3 size={14} /> Edit
          </button>
        </div>
        <div className="rp-meta-row">
          <StatusChip userEdited={userEdited} signed={signed} />
          <span className="rp-report-meta">
            {patient?.studyDate ? `Study ${patient.studyDate} · ` : ''}Updated {updatedLabel}
          </span>
        </div>
      </section>

      {signed ? (
        <section className="rp-card rp-seal">
          <div className="rp-seal-ico">
            <ShieldCheck />
          </div>
          <div className="rp-seal-text">
            <span className="rp-seal-name">Signed by {report.radiologist || 'radiologist'}</span>
            <span className="rp-seal-date">{report.signedAt ? new Date(report.signedAt).toLocaleString() : '—'}</span>
          </div>
          <button type="button" className="btn btn-plain btn-sm" onClick={onUnlock}>
            <Unlock size={14} /> Unlock
          </button>
        </section>
      ) : null}

      <AutoGrowField
        value={patient?.indication ?? ''}
        readOnly
        icon={<ClipboardList />}
        label="Clinical Indication"
        placeholder="No indication recorded — add one in patient details."
      />

      {REPORT_FIELDS.map((field) => (
        <AutoGrowField
          key={field.key}
          value={report[field.key]}
          icon={field.icon}
          emphasis={field.emphasis}
          label={field.label}
          readOnly={signed}
          placeholder={`Add ${field.label.toLowerCase()}…`}
          onChange={onFieldChange(field.key)}
        />
      ))}

      {!signed ? (
        <section className="rp-card rp-signoff">
          <div className="rp-sec-head">
            <ShieldCheck />
            Sign-off
          </div>
          <div className="rp-signoff-row">
            <input
              className="input"
              value={report.radiologist}
              aria-label="Radiologist name"
              placeholder="Radiologist name"
              onChange={(e) => setReport(study.id, { radiologist: e.target.value } as Partial<ReportDraft>)}
            />
            <button type="button" className="btn btn-primary" disabled={!report.radiologist.trim()} onClick={onSign}>
              Sign
            </button>
          </div>
          {confirmRegen ? (
            <div className="rp-confirm">
              <span className="rp-confirm-text">
                Replace this report with a new draft from {analyzedCount} analyzed image{analyzedCount === 1 ? '' : 's'}?
                Your edits will be lost.
              </span>
              <div className="rp-confirm-actions">
                <button type="button" className="btn btn-sm" onClick={() => setConfirmRegen(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-destructive btn-sm" onClick={onRegenConfirm}>
                  Regenerate
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-plain btn-sm rp-regen"
              disabled={reportJob.running}
              onClick={() => setConfirmRegen(true)}
            >
              <RefreshCw size={14} /> Regenerate draft
            </button>
          )}
        </section>
      ) : null}

      <section className="rp-card rp-export">
        <button type="button" className="btn btn-primary btn-lg rp-btn-full" onClick={() => setPreviewOpen(true)}>
          <Printer size={16} /> Preview &amp; Print / PDF
        </button>
        <div className="rp-export-row">
          <button type="button" className="btn" onClick={onCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="btn" onClick={onDownloadTxt}>
            <Download size={14} /> Text
          </button>
          <button type="button" className="btn" onClick={onDownloadJson}>
            <FileJson size={14} /> JSON
          </button>
        </div>
      </section>

      <div className="rp-disclaimer">
        AI-generated decision support — findings must be verified by a qualified radiologist before clinical use.
      </div>

      {previewOpen ? (
        <PrintReport study={study} settings={settings} onClose={() => setPreviewOpen(false)} />
      ) : null}
    </div>
  )
}