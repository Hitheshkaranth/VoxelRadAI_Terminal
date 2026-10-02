// OWNER: Agent 4 (Report). The formal, print-perfect A4 report overlay (portal to document.body).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import { SEVERITY_LABEL } from '../../types'
import type { Settings, Study, StudyImage } from '../../types'
import { renderAnnotatedImage } from '../../lib/annotate'
import { isExcluded } from '../../lib/classifier'
import { reliabilityFor } from '../../lib/reliability'
import { DISCLAIMER, analyzedImages, examSummary, exclusionReason, reportPatient, splitFindings } from '../../lib/reportExport'
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

export function PrintReport({ study, settings, onClose }: PrintReportProps) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const exam = examSummary(study)
  const analyzed = analyzedImages(study)
  const patient = reportPatient(study)
  const report = study.report
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const amendments = report?.amendments ?? []

  const examLine = [exam.modality, exam.bodyPart, ...exam.views].filter(Boolean).join(' · ')
  const accession = ACCESSION(study.id)

  return createPortal(
    <div className="rp-print-root">
      <div className="rp-print-backdrop">
        <div className="rp-print-toolbar glass">
          <span className="rp-print-toolbar-label">Preview &amp; Print</span>
          <div className="rp-print-toolbar-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.print()}
            >
              <Printer size={15} />
              Print / Save as PDF
            </button>
            <button type="button" className="btn btn-plain" onClick={onClose}>
              Close
            </button>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="rp-print-scroll">
          <div className="rp-print-page" role="document">
            <div className="rp-print-inner">
              <header className="rp-lh">
                <div className="rp-lh-name">{settings.institution || 'Diagnostic Radiology'}</div>
                <div className="rp-lh-sub">
                  {report?.signed ? 'Radiology Report — AI-assisted, radiologist-signed' : 'Radiology Report — AI-assisted draft'}
                </div>
                <div className="rp-lh-meta">
                  Report date: {new Date().toLocaleDateString()} · Accession: {accession}
                </div>
              </header>

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

              {analyzed.length > 0 && (
                <Section title="Key Images">
                  <div className="rp-images">
                    {analyzed.map((img, i) => (
                      <ImageKey key={img.id} image={img} index={i} src={thumbs[img.id] ?? ''} ready={!!thumbs[img.id]} />
                    ))}
                  </div>
                </Section>
              )}

              <Section title="Technique">
                <TextBlock value={study.report?.technique} />
              </Section>

              <Section title="Comparison">
                <TextBlock value={study.report?.comparison} />
              </Section>

              <Section title="Findings">
                <TextBlock value={study.report?.findings} />
              </Section>

              <Section title="Impression">
                {splitLines(study.report?.impression).length > 1 ? (
                  <ol className="rp-ordered">
                    {splitLines(study.report?.impression).map((line, i) => (
                      <li key={i}>
                        <strong>{line.replace(/^\d+[.)]\s*/, '')}</strong>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <TextBlock value={study.report?.impression} />
                )}
              </Section>

              <Section title="Recommendations">
                <TextBlock value={study.report?.recommendations} />
              </Section>

              {included.length > 0 && (
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
                      {included.map(({ ref, finding: f }) => {
                        const rel = reliabilityFor(f)
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

              {excluded.length > 0 && (
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
              </div>

              <footer className="rp-footer">
                <span className="rp-footer-disclaimer">
                  {DISCLAIMER} Drafted with AI assistance (MedGemma 27B, run locally
                  {included.some((r) => r.finding.source === 'maira2') ? ', with MAIRA-2 as second reader' : ''}).
                </span>
              </footer>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}