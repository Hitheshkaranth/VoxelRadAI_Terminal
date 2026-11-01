import { analysisEligibility } from '../../lib/modality'
// OWNER: Agent 4 (Report). The inspector report editor, sign-off, and print/copy/export bar.
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRightCircle,
  Check,
  ClipboardList,
  Copy,
  Download,
  Edit3,
  EyeOff,
  FileJson,
  FileText,
  GitCompare,
  ListChecks,
  Printer,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Stethoscope,
  Undo2,
  Unlock,
} from 'lucide-react'
import { useActiveStudy, useApp } from '../../store'
import { cancelReport, generateStudyReport, reportSourceKey, useReportJob } from '../../lib/analysis'
import { excludedFindings, isUnconfirmed } from '../../lib/classifier'
import type { PatientInfo, ReportDraft, Study } from '../../types'
import {
  downloadFile,
  exclusionReason,
  reportPatient,
  reportToPlainText,
  studyFileName,
  studyToJson,
} from '../../lib/reportExport'
import { Sheet } from '../shell/Sheet'
import { toast } from '../shell/toastStore'
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

const DISCLAIMER_LINE =
  'AI-generated decision support — findings must be verified by a qualified radiologist before clinical use. Not a diagnosis.'

interface AutoGrowFieldProps {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  placeholder?: string
  label?: string
  hint?: string
  icon?: ReactNode
  emphasis?: boolean
  sectionId?: string
}

/** A textarea that grows to fit its content. Value is the single source of truth; caret stays stable. */
function AutoGrowField({ value, onChange, readOnly, placeholder, label, hint, icon, emphasis, sectionId }: AutoGrowFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fieldId = useId()

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
    <section id={sectionId} className={`rp-sec${readOnly ? ' rp-sec-ro' : ''}${emphasis ? ' rp-sec-em' : ''}`}>
      {label ? (
        <label className="rp-sec-head" htmlFor={fieldId}>
          {icon}
          {label}
        </label>
      ) : null}
      <textarea
        id={fieldId}
        aria-describedby={hint ? `${fieldId}-hint` : undefined}
        ref={ref}
        className="rp-sec-text"
        rows={1}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange?.(e.target.value)}
      />
      {hint ? <div id={`${fieldId}-hint`} className="rp-sec-hint">{hint}</div> : null}
    </section>
  )
}

function initials(name?: string) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return parts.length ? (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() : '?'
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function samePatient(a: PatientInfo, b: PatientInfo): boolean {
  return (Object.keys(a) as (keyof PatientInfo)[]).every((k) => a[k] === b[k])
}

function StatusChip({ edited, signed }: { edited: boolean; signed: boolean }) {
  if (signed) return null
  if (edited) {
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

/** Things a reviewer should know before signing. Empty → sign straight away. */
function signChecklist(study: Study, report: ReportDraft, stale: boolean): string[] {
  const items: string[] = []
  const total = study.images.length
  const analysed = study.images.filter((img) => img.analysis != null)
  if (analysed.length < total) items.push(`${total - analysed.length} of ${total} images not analysed.`)
  const unreviewed = analysed.flatMap((img) =>
    (img.analysis?.findings ?? []).filter((f) => f.severity !== 'normal' && isUnconfirmed(f)),
  )
  if (unreviewed.length)
    items.push(`${plural(unreviewed.length, 'AI finding')} not supported by the classifier cross-check and not yet reviewed (in the draft as unconfirmed).`)
  const truncated = analysed.filter((img) => img.analysis?.truncated)
  if (truncated.length)
    items.push(`${plural(truncated.length, 'analysis', 'analyses')} cut off at the token limit — findings may be incomplete.`)
  const noCheck = analysed.filter((img) => {
    const s = img.analysis?.classifierStatus
    return s === 'unavailable' || s === 'error'
  })
  if (noCheck.length) items.push(`Classifier cross-check did not run for ${plural(noCheck.length, 'image')}.`)
  const empty = REPORT_FIELDS.filter((f) => !report[f.key].trim()).map((f) => f.label)
  if (empty.length) items.push(`Empty section${empty.length === 1 ? '' : 's'}: ${empty.join(', ')}.`)
  if (stale) items.push('The draft is out of date: images, reviews or patient details changed since drafting.')
  return items
}

/** AI findings left out of the draft. Collapsed to a count; expands to each one with a Re-include action. */
function ExcludedBanner({ study, locked }: { study: Study; locked: boolean }) {
  const setFindingReview = useApp((s) => s.setFindingReview)
  const [open, setOpen] = useState(false)
  const excluded = excludedFindings(study).filter((e) => e.finding.severity !== 'normal')
  if (!excluded.length) return null

  return (
    <section className="rp-card rp-excl" aria-label="AI findings excluded from the draft">
      <button type="button" className="rp-excl-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <EyeOff size={14} />
        <span className="rp-excl-title">
          Excluded from draft: {plural(excluded.length, 'AI finding')}
        </span>
        <span className="rp-excl-toggle">{open ? 'hide' : 'view'}</span>
      </button>
      {open ? (
        <ul className="rp-excl-list">
          {excluded.map(({ imageId, imageName, finding }) => (
            <li key={imageId + finding.id} className="rp-excl-item">
              <div className="rp-excl-body">
                <div className="rp-excl-name">
                  {finding.title || 'Finding'}
                  {finding.source === 'maira2' ? <span className="rp-excl-src"> · MAIRA-2</span> : null}
                </div>
                <div className="rp-excl-meta">
                  {imageName} · {exclusionReason(finding)}
                </div>
              </div>
              {!locked ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setFindingReview(study.id, imageId, finding.id, 'accepted')}
                >
                  Re-include
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {open && !locked ? (
        <div className="rp-excl-hint">Re-including a finding marks the draft out of date; regenerate to use it.</div>
      ) : null}
    </section>
  )
}

export function ReportPanel() {
  const study = useActiveStudy() as Study | null
  const settings = useApp((s) => s.settings)
  const reportJob = useReportJob()
  const setReport = useApp((s) => s.setReport)
  const updatePatient = useApp((s) => s.updatePatient)
  const openSheet = useApp((s) => s.openSheet)

  const [confirmRegen, setConfirmRegen] = useState(false)
  const [confirmUnlock, setConfirmUnlock] = useState(false)
  const [checklist, setChecklist] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [anonymise, setAnonymise] = useState(false)

  const report = study?.report ?? null
  const signed = report?.signed ?? false
  const stale = !!(study && report?.sourceKey && report.sourceKey !== reportSourceKey(study))

  const analyzedCount = useMemo(
    () => (study ? study.images.filter((img) => img.analysis != null).length : 0),
    [study],
  )
  const totalCount = study?.images.length ?? 0

  const onFieldChange = useCallback(
    (key: ReportFieldKey) => (value: string) => {
      if (!study) return
      // `edited` persists so the Edited / AI draft chip survives reloads.
      setReport(study.id, { [key]: value, ...(report?.edited ? {} : { edited: true }) } as Partial<ReportDraft>)
    },
    [study, report, setReport],
  )

  const sign = useCallback((overrides: string[] = []) => {
    if (!study || !report) return
    setChecklist(null)
    setReport(study.id, {
      signed: true,
      // Record what was signed past so the override stays visible on the signed report.
      signOverrides: overrides.length ? overrides : undefined,
      signedAt: Date.now(),
      radiologist: report.radiologist.trim(),
      // Freeze the patient header: later edits to patient details must not change a signed report.
      patientSnapshot: { ...study.patient },
      // Signing accepts the current draft; there is nothing left to undo back to.
      previous: undefined,
    })
  }, [study, report, setReport])

  const onSign = useCallback(() => {
    if (!study || !report) return
    const items = signChecklist(study, report, stale)
    if (items.length) setChecklist(items)
    else sign()
  }, [study, report, stale, sign])

  const onUnlock = useCallback(() => {
    if (!study || !report) return
    setConfirmUnlock(false)
    const amendment = { signedAt: report.signedAt ?? 0, unlockedAt: Date.now(), by: report.radiologist }
    setReport(study.id, { signed: false, signedAt: undefined, signOverrides: undefined, amendments: [...(report.amendments ?? []), amendment] })
  }, [study, report, setReport])

  const onRegenerate = useCallback(() => {
    if (!study) return
    setConfirmRegen(false)
    // generateStudyReport keeps the current draft in report.previous for Undo.
    void generateStudyReport(study.id)
  }, [study])

  const onUndoRegenerate = useCallback(() => {
    if (!study || !report?.previous) return
    setReport(study.id, { ...report.previous, previous: undefined })
  }, [study, report, setReport])

  const plain = useMemo(() => (study ? reportToPlainText(study, settings) : ''), [study, settings])

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(plain)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
      toast('Clipboard unavailable. Use Text to download the report.', 'error')
    }
  }, [plain])

  const onDownloadTxt = useCallback(() => {
    if (!study) return
    downloadFile(studyFileName(study, 'txt'), plain, 'text/plain')
  }, [study, plain])

  const onDownloadJson = useCallback(() => {
    if (!study) return
    const json = JSON.stringify(studyToJson(study, { anonymise, institution: settings.institution }), null, 2)
    downloadFile(studyFileName(anonymise ? { ...study, title: 'anonymised-study' } : study, 'json'), json, 'application/json')
  }, [study, settings, anonymise])

  // Reset transient UI state when the active study changes.
  const studyKey = study?.id ?? ''
  const [prevStudy, setPrevStudy] = useState(studyKey)
  if (prevStudy !== studyKey) {
    setPrevStudy(studyKey)
    setConfirmRegen(false)
    setConfirmUnlock(false)
    setChecklist(null)
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

  if (!report && study.images.length > 0 && study.images.every((image) => !analysisEligibility(image).supported)) {
    return <div className="rp-panel"><h2 className="preview-heading">Report unavailable</h2><p className="preview-note">These images are available for preview. Analysis supports chest X-rays and CT/MRI images.</p></div>
  }

  if (analyzedCount === 0 && !report) {
    return (
      <div className="rp-panel">
        <div className="rp-empty">
          <div className="rp-empty-ico">
            <FileText />
          </div>
          <div className="rp-empty-title">Draft your report</div>
          <div className="rp-empty-text">
            Analyze at least one image to draft a report. {settings.model} will synthesize all analyzed images and patient
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
                {settings.model} will synthesize all {analyzedCount} analyzed image{analyzedCount === 1 ? '' : 's'} and the
                patient context into a structured, editable, signable report.
                {analyzedCount < totalCount ? ` ${totalCount - analyzedCount} image${totalCount - analyzedCount === 1 ? ' is' : 's are'} not analyzed yet and will be left out.` : ''}
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
        <div className="rp-disclaimer">{DISCLAIMER_LINE}</div>
      </div>
    )
  }

  // Report editor. Once signed the header shows the patient details frozen at signing.
  const patient = reportPatient(study)
  const patientChangedSinceSign = signed && !!report.patientSnapshot && !samePatient(report.patientSnapshot, study.patient)
  const updatedLabel = report.updatedAt ? new Date(report.updatedAt).toLocaleString() : ''
  const amendments = report.amendments ?? []
  const completedSections = REPORT_FIELDS.filter((field) => report[field.key].trim()).length
  const reviewFindings = study.images.flatMap((img) => img.analysis?.findings ?? []).filter((f) => f.severity !== 'normal')
  const reviewedFindings = reviewFindings.filter((f) => !!f.review).length

  return (
    <div className="rp-panel">
      <header className="rp-workspace-title"><div><h1>{signed ? 'Signed report' : 'Report draft'}</h1></div></header>
      <div className={`rp-pin${signed ? ' rp-pin-signed' : ''}`} role="note">
        {signed ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}
        {signed
          ? 'Signed report · AI-assisted decision support'
          : 'Unsigned AI draft — decision support, verify before use'}
      </div>

      <section className="rp-card rp-patient">
        <div className="rp-patient-top">
          <div className="rp-patient-id">
            <div className="rp-avatar" aria-hidden>
              {initials(patient.name)}
            </div>
            <div>
              <div className="rp-patient-name">{patient.name || 'Unnamed patient'}</div>
              <div className="rp-patient-sub">
                {[patient.patientId, [patient.age, patient.sex].filter(Boolean).join(' · ')].filter(Boolean).join('  ·  ') ||
                  'No demographics recorded'}
              </div>
            </div>
          </div>
          <button type="button" className="btn btn-plain btn-sm" onClick={() => openSheet('patient')}>
            <Edit3 size={14} /> Edit
          </button>
        </div>
        <div className="rp-meta-row">
          <StatusChip edited={!!report.edited} signed={signed} />
          <span className="rp-report-meta">
            {patient.studyDate ? `Study ${patient.studyDate} · ` : ''}Updated {updatedLabel}
          </span>
        </div>
        {patientChangedSinceSign ? (
          <div className="rp-patient-note">
            Patient details were changed after signing. The signed report keeps the details shown here; unlock to amend.
          </div>
        ) : null}
      </section>

      {stale && !signed ? (
        <section className="rp-card rp-banner rp-banner-warn" role="status">
          <AlertTriangle size={15} className="rp-banner-ico" />
          <div className="rp-banner-text">
            Report is out of date: images, reviews or patient details changed since drafting.
          </div>
          <button type="button" className="btn btn-sm" disabled={reportJob.running} onClick={onRegenerate}>
            <RefreshCw size={13} /> Regenerate
          </button>
        </section>
      ) : null}

      {reportJob.running ? (
        <section className="rp-card rp-banner" role="status">
          <div className="spinner" />
          <div className="rp-banner-text">{reportJob.progressText ?? 'Drafting report…'}</div>
          <button type="button" className="btn btn-sm btn-destructive" onClick={cancelReport}>
            Cancel
          </button>
        </section>
      ) : reportJob.error ? (
        <div className="rp-progress-error">{reportJob.error}</div>
      ) : null}

      {report.previous && !signed && !reportJob.running ? (
        <section className="rp-card rp-banner">
          <RefreshCw size={14} className="rp-banner-ico rp-banner-ico-muted" />
          <div className="rp-banner-text">Draft regenerated. The previous version is kept until you undo or sign.</div>
          <button type="button" className="btn btn-sm" onClick={onUndoRegenerate}>
            <Undo2 size={13} /> Undo regenerate
          </button>
        </section>
      ) : null}

      {signed ? (
        <section className="rp-card rp-seal">
          <div className="rp-seal-row">
            <div className="rp-seal-ico">
              <ShieldCheck />
            </div>
            <div className="rp-seal-text">
              <span className="rp-seal-name">Signed by {report.radiologist || 'radiologist'}</span>
              <span className="rp-seal-date">{report.signedAt ? new Date(report.signedAt).toLocaleString() : '—'}</span>
              {report.signOverrides?.length ? (
                <span className="rp-seal-date">Signed past: {report.signOverrides.join('; ')}</span>
              ) : null}
            </div>
            {!confirmUnlock ? (
              <button type="button" className="btn btn-plain btn-sm" onClick={() => setConfirmUnlock(true)}>
                <Unlock size={14} /> Unlock
              </button>
            ) : null}
          </div>
          {confirmUnlock ? (
            <div className="rp-confirm">
              <span className="rp-confirm-text">
                Unlock this signed report for amendment? It becomes an editable draft again and the unlock is recorded in
                the amendment history.
              </span>
              <div className="rp-confirm-actions">
                <button type="button" className="btn btn-sm" onClick={() => setConfirmUnlock(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-destructive btn-sm" onClick={onUnlock}>
                  Unlock
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rp-readiness" aria-label="Report progress">
        <span>{completedSections}/{REPORT_FIELDS.length} sections</span>
        <span>{reviewedFindings}/{reviewFindings.length} findings reviewed</span>
        <span>{analyzedCount}/{totalCount} images analyzed</span>
      </section>
      <nav className="rp-section-nav" aria-label="Report sections">
        {REPORT_FIELDS.map((field) => <button key={field.key} type="button" onClick={() => {
          const section = document.getElementById(`report-${field.key}`)
          section?.scrollIntoView({ block: 'start', behavior: 'instant' })
          section?.querySelector('textarea')?.focus({ preventScroll: true })
        }}>{field.label}</button>)}
      </nav>

      <AutoGrowField
        value={patient.indication}
        readOnly={signed}
        icon={<ClipboardList />}
        label="Clinical Indication"
        placeholder="No indication recorded — add one here or in patient details."
        hint={!signed && report.sourceKey ? 'Changing the indication marks the draft out of date.' : undefined}
        onChange={(value) => updatePatient(study.id, { indication: value })}
      />

      {REPORT_FIELDS.map((field) => (
        <div key={field.key} className="rp-field-wrap">
          {field.key === 'findings' ? <ExcludedBanner study={study} locked={signed} /> : null}
          <AutoGrowField
            value={report[field.key]}
            sectionId={`report-${field.key}`}
            icon={field.icon}
            emphasis={field.emphasis}
            label={field.label}
            readOnly={signed}
            placeholder={`Add ${field.label.toLowerCase()}…`}
            onChange={onFieldChange(field.key)}
          />
        </div>
      ))}

      {!signed ? (
        <section className="rp-card rp-signoff">
          <div className="rp-sec-head">
            <ShieldCheck />
            Radiologist sign-off
          </div>
          <p className="rp-signoff-hint">Review the draft and enter your name to sign. Signing locks the report and records the patient details.</p>
          <div className="rp-signoff-row">
            <input
              className="input"
              value={report.radiologist}
              aria-label="Radiologist name"
              placeholder="Radiologist name"
              onChange={(e) => setReport(study.id, { radiologist: e.target.value } as Partial<ReportDraft>)}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!report.radiologist.trim() || reportJob.running}
              onClick={onSign}
            >
              Sign report
            </button>
          </div>
          {confirmRegen ? (
            <div className="rp-confirm">
              <span className="rp-confirm-text">
                Replace this report with a new draft from {plural(analyzedCount, 'analyzed image')}? The current draft
                is kept so you can undo.
              </span>
              <div className="rp-confirm-actions">
                <button type="button" className="btn btn-sm" onClick={() => setConfirmRegen(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-destructive btn-sm" onClick={onRegenerate}>
                  Regenerate
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-plain btn-sm rp-regen"
              disabled={reportJob.running || analyzedCount === 0}
              onClick={() => setConfirmRegen(true)}
            >
              <RefreshCw size={14} /> Regenerate draft
            </button>
          )}
        </section>
      ) : null}

      {amendments.length ? (
        <section className="rp-card rp-amend">
          <div className="rp-sec-head">Amendment history</div>
          <ul className="rp-amend-list">
            {amendments.map((a, i) => (
              <li key={i}>
                Signed {new Date(a.signedAt).toLocaleString()}, unlocked {new Date(a.unlockedAt).toLocaleString()} by{' '}
                {a.by || '—'}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rp-card rp-export">
        <h2 className="rp-export-title">Export report</h2>
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
        <label className="rp-anon">
          <input type="checkbox" checked={anonymise} onChange={(e) => setAnonymise(e.target.checked)} />
          Anonymise JSON (removes name, patient ID, referring physician and file names)
        </label>
      </section>

      <div className="rp-disclaimer">{DISCLAIMER_LINE}</div>

      <Sheet
        open={checklist != null}
        onClose={() => setChecklist(null)}
        title="Before you sign"
        subtitle="These items are unresolved. You can go back and fix them, or sign anyway."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setChecklist(null)}>
              Go back
            </button>
            <button type="button" className="btn btn-primary" onClick={() => sign(checklist ?? [])}>
              Sign anyway
            </button>
          </>
        }
      >
        <ul className="rp-check-list">
          {(checklist ?? []).map((item) => (
            <li key={item} className="rp-check-item">
              <AlertTriangle size={14} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Sheet>

      {previewOpen ? (
        <PrintReport study={study} settings={settings} onClose={() => setPreviewOpen(false)} />
      ) : null}
    </div>
  )
}
