import { ShellButton } from '../shell/ShellButton'
// OWNER: Agent 4 (Report). The formal, print-perfect A4 report overlay (portal to document.body).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import { SEVERITY_LABEL } from '../../types'
import type { Finding, Heatmap, Settings, Study, StudyImage } from '../../types'
import { renderAnnotatedImage, renderFindingHeatmap } from '../../lib/annotate'
import { HEAT_ACCURACY, findingHeat } from '../../lib/heatmap'
import { isExcluded, isUnconfirmed } from '../../lib/classifier'
import { reliabilityFor } from '../../lib/reliability'
import { DISCLAIMER, analyzedImages, examSummary, exclusionReason, reportPatient, splitFindings } from '../../lib/reportExport'
import { cssString, sanitizeReportHtml } from '../../lib/richText'
import { layoutOf, sectionTitle, templateForReport, useTemplates } from '../../lib/reportTemplates'
import { examTypeLine } from '../../lib/systematicReport'
import { SystematicBody, SystematicLetterhead, SystematicSignatory } from './SystematicReport'
import type { ReportFieldKey } from '../../types'
import { TemplateHeader } from './TemplateHeader'
import { addendumHeading, correctionNote, currentAddenda } from '../../lib/reportVersions'
import { criticalCommLine } from '../../lib/reportQa'
import './print.css'

interface PrintReportProps {
  study: Study
  settings: Settings
  onClose: () => void
}

const ACCESSION = (studyId: string): string => studyId.replace(/-/g, '').slice(0, 10).toUpperCase()

function splitLines(value: string | undefined): string[] {
  return (value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function TextBlock({ value }: { value: string | undefined }) {
  const lines = splitLines(value)
  if (!lines.length) return <div className="rp-ghost">Not provided</div>
  return (
    <div className="rp-text">
      {lines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  )
}

/** A report section: sanitized rich text when the radiologist formatted it, otherwise the plain lines. */
function SectionBody({ html, value, ordered }: { html?: string; value?: string; ordered?: boolean }) {
  if (html && value?.trim()) return <div className="rp-text rp-rich" dangerouslySetInnerHTML={{ __html: sanitizeReportHtml(html) }} />
  if (ordered && splitLines(value).length > 1) {
    return (
      <ol className="rp-ordered">
        {splitLines(value).map((line, i) => <li key={i}><strong>{line.replace(/^\d+[.)]\s*/, '')}</strong></li>)}
      </ol>
    )
  }
  return <TextBlock value={value} />
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rp-section">
      <h3 className="rp-section-title">{title}</h3>
      <div className="rp-section-body">{children}</div>
    </section>
  )
}

function Signature({ signedName: name, signedAt, isSigned }: { signedName: string; signedAt?: number; isSigned: boolean }) {
  if (!isSigned) {
    return (
      <div className="rp-unsigned">
        <div className="rp-unsigned-label">UNSIGNED — PRELIMINARY AI DRAFT</div>
        <div className="rp-unsigned-sub">Awaiting radiologist review and signature</div>
      </div>
    )
  }
  const date = signedAt ? new Date(signedAt).toLocaleDateString() : ''
  return (
    <div className="rp-signed">
      <div className="rp-signed-name">{name || '—'}</div>
      <div className="rp-signed-role">Radiologist{date ? ` · ${date}` : ''}</div>
    </div>
  )
}

function ImageKey({ image, index, src, ready }: { image: StudyImage; index: number; src: string; ready: boolean }) {
  const findings = image.analysis?.findings ?? []
  return (
    <figure className="rp-figure">
      <div className="rp-thumb-wrap">
        {ready ? (
          <img className="rp-thumb" src={src} alt={image.name} loading="lazy" />
        ) : (
          <div className="rp-thumb rp-thumb-loading">Rendering…</div>
        )}
      </div>
      {findings.length > 0 && (
        <ol className="rp-legend">
          {findings.map((f, i) => (
            <li key={f.id} className={isExcluded(f) ? 'rp-legend-excluded' : undefined}>
              <span className="rp-legend-no">{i + 1}</span>
              <span className="rp-legend-dot" data-severity={f.severity} />
              <span className="rp-legend-text">
                <strong>{f.title || 'Finding'}</strong>
                {f.location ? ` · ${f.location}` : ''}
                {isExcluded(f) ? ' · not in report' : ''}
                {f.source === 'maira2' ? ' · MAIRA-2 second reader' : ''}
                {f.severity !== 'normal' && !f.bbox ? ' · not localized' : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="rp-figure-caption">Key {index + 1} — {image.name}</div>
    </figure>
  )
}

/** Caption fragment: the finding's strongest classifier evidence in its own region, or that no region was given. */
function regionalNote(heat: Heatmap, finding: Finding): string {
  const fh = findingHeat(heat, finding)
  return fh.regional ? ` · regional evidence ${Math.round(fh.strength * 100)}%` : ' · whole film (no region given)'
}

export function PrintReport({ study, settings, onClose }: PrintReportProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useLayoutEffect(() => { closeRef.current = onClose }, [onClose])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [heatFigs, setHeatFigs] = useState<Record<string, string>>({})
  const exam = examSummary(study)
  const analyzed = analyzedImages(study)
  const analysisModels = [...new Set(analyzed.map((image) => image.analysis?.model).filter(Boolean))].join(', ')
  const patient = reportPatient(study)
  const report = study.report
  const templates = useTemplates((s) => s.templates)
  const loadTemplates = useTemplates((s) => s.load)
  const templatesLoaded = useTemplates((s) => s.loaded)
  useEffect(() => { if (!templatesLoaded) void loadTemplates() }, [templatesLoaded, loadTemplates])
  const template = templateForReport(templates, report)
  const systematic = template && layoutOf(template) === 'systematic' ? template : null
  const body = (key: ReportFieldKey, ordered = false) => (
    <Section key={key} title={sectionTitle(template, key)}>
      <SectionBody html={report?.rich?.[key]} value={report?.[key]} ordered={ordered} />
    </Section>
  )
  const pageStyle = template
    ? `@media print { @page { margin-bottom: ${template.footer.text.trim() ? 22 : 16}mm; ${template.footer.showPageNumbers ? '' : '@bottom-right { content: none; }'} ${template.footer.text.trim() ? `@bottom-left { content: ${cssString(template.footer.text.trim())}; white-space: pre-wrap; font: 9px -apple-system, BlinkMacSystemFont, sans-serif; color: #55555c; width: 70%; }` : ''} } }`
    : ''
  const { included, excluded } = splitFindings(study)

  // Re-render thumbnails only when what is burned into them changes: the analysed set, each analysis,
  // and each finding's include/exclude state (excluded boxes are drawn dotted).
  const thumbKey = analyzed
    .map((img) => `${img.id}:${img.analysis?.createdAt}:${img.analysis?.findings.map((f) => (isExcluded(f) ? 'x' : 'i')).join('')}`)
    .join('|')
  const analyzedRef = useRef(analyzed)
  useEffect(() => {
    analyzedRef.current = analyzed
  })
  useEffect(() => {
    let cancelled = false
    const images = analyzedRef.current
    Promise.all(images.map((img) => renderAnnotatedImage(img, { maxSize: 640 }).catch(() => img.dataUrl)))
      .then((urls) => {
        if (cancelled) return
        const map: Record<string, string> = {}
        images.forEach((img, i) => {
          map[img.id] = urls[i]
        })
        setThumbs(map)
      })
    return () => {
      cancelled = true
    }
  }, [thumbKey])

  // One heatmap figure per finding in the draft whose type the classifier covers.
  const heatRows = included.flatMap((row) => {
    const img = analyzed.find((i) => i.id === row.imageId)
    const kind = row.finding.classifier?.prob != null ? row.finding.classifier.kind : null
    const heat = kind ? img?.analysis?.heatmaps?.[kind] : undefined
    return img && heat ? [{ ...row, image: img, heat, kind: kind! }] : []
  })
  const noHeat = included.filter((row) => !heatRows.some((h) => h.finding.id === row.finding.id))
  const heatKey = heatRows.map((r) => `${r.finding.id}:${r.kind}:${r.image.analysis?.createdAt}:${isUnconfirmed(r.finding)}`).join('|')
  const heatRowsRef = useRef(heatRows)
  useEffect(() => {
    heatRowsRef.current = heatRows
  })
  useEffect(() => {
    let cancelled = false
    const rows = heatRowsRef.current
    Promise.all(rows.map((r) => renderFindingHeatmap(r.image, r.finding, r.ref, r.heat).catch(() => '')))
      .then((urls) => {
        if (cancelled) return
        const map: Record<string, string> = {}
        rows.forEach((r, i) => {
          if (urls[i]) map[r.finding.id] = urls[i]
        })
        setHeatFigs(map)
      })
    return () => {
      cancelled = true
    }
  }, [heatKey])

  useLayoutEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    dialog?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      // Keep viewer shortcuts behind the modal from changing the image while previewing a report.
      e.stopPropagation()
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return }
      if (e.key !== 'Tab' || !dialog) return
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')).filter((node) => node.offsetParent !== null)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (!first) { e.preventDefault(); return }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { e.preventDefault(); first.focus() }
    }
    dialog?.addEventListener('keydown', onKey)
    return () => {
      dialog?.removeEventListener('keydown', onKey)
      before?.focus({ preventScroll: true })
    }
  }, [])

  const amendments = report?.amendments ?? []
  const addenda = currentAddenda(report)
  const corrected = correctionNote(report)

  const examLine = [exam.modality, exam.bodyPart, ...exam.views].filter(Boolean).join(' · ')
  const accession = ACCESSION(study.id)

  return createPortal(
    <div className="rp-print-root" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Report print preview" tabIndex={-1}>
      <div className="rp-print-backdrop">
        <div className="rp-print-toolbar glass">
          <span className="rp-print-toolbar-label">Preview &amp; Print</span>
          <div className="rp-print-toolbar-actions">
            <ShellButton
              type="button"
              className="btn btn-primary"
              onClick={() => window.print()}
            >
              <Printer size={15} />
              Print / Save as PDF
            </ShellButton>
            <ShellButton type="button" className="btn btn-plain" onClick={onClose}>
              Close
            </ShellButton>
            <ShellButton type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <X size={18} />
            </ShellButton>
          </div>
        </div>

        <div className="rp-print-scroll" tabIndex={0} aria-label="Report preview document">
          <div className="rp-print-page" role="document">
            <div className="rp-print-inner">
              {pageStyle ? <style>{pageStyle}</style> : null}
              {systematic ? (
                <>
                  <SystematicLetterhead template={systematic} fallbackInstitution={settings.institution} />
                  <SystematicBody template={systematic} patient={patient} report={report} examType={examTypeLine(analyzed)} reportDate={new Date().toLocaleDateString()} />
                </>
              ) : (
                <>
              <TemplateHeader
                template={template}
                fallbackInstitution={settings.institution}
                subtitle={report?.signed ? 'Radiology Report — AI-assisted, radiologist-signed' : 'Radiology Report — AI-assisted draft'}
                meta={`Report date: ${new Date().toLocaleDateString()} · Accession: ${accession}`}
              />

              <div className="rp-demo">
                <div className="rp-demo-cell">
                  <span>Patient Name</span>
                  <strong>{patient.name || '—'}</strong>
                </div>
                <div className="rp-demo-cell">
                  <span>Patient ID</span>
                  <strong>{patient.patientId || '—'}</strong>
                </div>
                <div className="rp-demo-cell">
                  <span>Age / Sex</span>
                  <strong>
                    {[patient.age, patient.sex].filter(Boolean).join(' / ') || '—'}
                  </strong>
                </div>
                <div className="rp-demo-cell">
                  <span>Study Date</span>
                  <strong>{patient.studyDate || '—'}</strong>
                </div>
                <div className="rp-demo-cell rp-demo-cell-span">
                  <span>Referring Physician</span>
                  <strong>{patient.referringPhysician || '—'}</strong>
                </div>
              </div>

              <Section title="Clinical Indication / History">
                <div className="rp-text">
                  <p>{patient.indication || '—'}</p>
                  {patient.clinicalHistory ? <p>{patient.clinicalHistory}</p> : null}
                </div>
              </Section>

              <Section title="Exam">
                <div className="rp-text">
                  <p>{examLine || '—'}</p>
                </div>
              </Section>
                </>
              )}

              {analyzed.length > 0 && (
                <Section title="Key Images">
                  <div className="rp-images">
                    {analyzed.map((img, i) => (
                      <ImageKey key={img.id} image={img} index={i} src={thumbs[img.id] ?? ''} ready={!!thumbs[img.id]} />
                    ))}
                  </div>
                </Section>
              )}

              {!systematic && heatRows.length > 0 && (
                <Section title="Classifier Heatmaps">
                  <p className="rp-heat-note">
                    One map per finding: where an independent image classifier (TorchXRayVision) found evidence for that
                    finding type, within the finding's own region (its box, or the zone it names). Red = strongest,
                    outlined = hot region, ring = peak; the box is the reading model's. "Regional evidence" is the strongest
                    value in the region relative to the type's peak anywhere on the film: low means the classifier sees
                    little at that location.
                    Coarse: on held-out radiologist-labelled films the peak fell inside the lesion {HEAT_ACCURACY} of the
                    time. A prompt to look, not a localisation.
                  </p>
                  <div className="rp-heat-grid">
                    {heatRows.map((r) => (
                      <figure key={r.finding.id} className="rp-heat-fig">
                        {heatFigs[r.finding.id] ? (
                          <img className="rp-heat-img" src={heatFigs[r.finding.id]} alt={`Heatmap for finding ${r.ref}: ${r.finding.title}`} />
                        ) : (
                          <div className="rp-heat-img rp-thumb-loading">Rendering…</div>
                        )}
                        <figcaption>
                          <span className="rp-legend-no">{r.ref}</span> <strong>{r.finding.title}</strong>
                          <span className="rp-heat-meta">
                            {r.kind} · classifier {Math.round((r.finding.classifier?.prob ?? 0) * 100)}%
                            {isUnconfirmed(r.finding) ? ' · unconfirmed' : r.finding.classifier?.supported ? ' · supported' : ''}
                            {regionalNote(r.heat, r.finding)}
                          </span>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                  {noHeat.length > 0 && (
                    <p className="rp-heat-note">
                      No heatmap (type not covered by the classifier, or classifier not run):{' '}
                      {noHeat.map((r) => `${r.ref} ${r.finding.title}`).join('; ')}.
                    </p>
                  )}
                </Section>
              )}

              {systematic ? null : (
                <>
                  {body('technique')}
                  {body('comparison')}
                  {body('findings')}
                  {body('impression', true)}
                  {body('recommendations')}
                </>
              )}

              {!systematic && included.length > 0 && (
                <section className="rp-section rp-table-section">
                  <h3 className="rp-section-title">AI Findings Summary</h3>
                  <table className="rp-table rp-table-findings">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Finding</th>
                        <th>Location</th>
                        <th>Severity</th>
                        <th title="Share of this kind of model call confirmed in the local benchmark">Benchmark</th>
                        <th title="The model's own confidence; not calibrated">Model-stated (uncalibrated)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {included.map(({ ref, finding: f, imageId }) => {
                        const rel = reliabilityFor(f, analyzed.find((image) => image.id === imageId)?.analysis?.model ?? '')
                        return (
                          <tr key={ref + f.id}>
                            <td>{ref}</td>
                            <td>
                              {f.title || '—'}
                              {f.source === 'maira2' ? <span className="rp-table-note"> (MAIRA-2 second reader)</span> : null}
                            </td>
                            <td>{f.location || '—'}</td>
                            <td>
                              <span className="rp-severity-cell">
                                <span className="rp-dot" data-severity={f.severity} />
                                {SEVERITY_LABEL[f.severity]}
                              </span>
                            </td>
                            <td>{rel ? `${rel.correct}/${rel.total}` : '—'}</td>
                            <td>{Math.round(f.confidence * 100)}%</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <p className="rp-table-foot">
                    Benchmark: how many calls of this kind were confirmed by reference labels in the local benchmark.
                    Model-stated confidence is the model's own figure and is not calibrated.
                  </p>
                </section>
              )}

              {!systematic && excluded.length > 0 && (
                <section className="rp-section rp-table-section rp-excluded-section">
                  <h3 className="rp-section-title">AI findings not included in this report</h3>
                  <table className="rp-table rp-table-excluded">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Finding</th>
                        <th>Image</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {excluded.map(({ ref, imageName, finding: f }) => (
                        <tr key={ref + f.id}>
                          <td>{ref}</td>
                          <td>
                            {f.title || '—'}
                            {f.source === 'maira2' ? <span className="rp-table-note"> (MAIRA-2 second reader)</span> : null}
                          </td>
                          <td>{imageName}</td>
                          <td>{exclusionReason(f)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {report?.criticalComms?.length ? (
                <Section title="Critical result communication">
                  <ul className="rp-amendments rp-critical-comms">
                    {report.criticalComms.map((c) => <li key={c.id}>{criticalCommLine(c)}</li>)}
                  </ul>
                </Section>
              ) : null}

              {amendments.length > 0 && (
                <Section title="Amendments">
                  <ul className="rp-amendments">
                    {amendments.map((a, i) => (
                      <li key={i}>
                        Signed {new Date(a.signedAt).toLocaleString()}, unlocked for amendment{' '}
                        {new Date(a.unlockedAt).toLocaleString()} by {a.by || '—'}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <div className="rp-signature">
                <Signature signedName={report?.radiologist ?? ''} signedAt={report?.signedAt} isSigned={!!report?.signed} />
                {systematic ? <SystematicSignatory template={systematic} signedName={report?.signed ? report.radiologist : ''} /> : null}
              </div>
              {corrected ? <p className="rp-correction-note">{corrected}</p> : null}

              {addenda.map((a) => (
                <section key={a.id} className="rp-addendum">
                  <h3 className="rp-addendum-head">{addendumHeading(a)}</h3>
                  <TextBlock value={a.text} />
                </section>
              ))}

              <footer className="rp-footer">
                {template?.footer.text.trim() ? <span className="rp-footer-template rp-screen-only">{template.footer.text}</span> : null}
                {!template || template.footer.showDisclaimer || !report?.signed ? (
                  <span className="rp-footer-disclaimer">
                    {DISCLAIMER} Drafted with AI assistance ({analysisModels || report?.draftModel || 'model not recorded'}
                    {included.some((r) => r.finding.source === 'maira2') ? ', with MAIRA-2 as second reader' : ''}).
                  </span>
                ) : null}
              </footer>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
