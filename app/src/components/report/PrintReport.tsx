// OWNER: Agent 4 (Report). The formal, print-perfect A4 report overlay (portal to document.body).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import { SEVERITY_LABEL } from '../../types'
import type { Finding, Settings, Study, StudyImage } from '../../types'
import { renderAnnotatedImage } from '../../lib/annotate'
import { analyzedImages, examSummary } from '../../lib/reportExport'
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
            <li key={f.id}>
              <span className="rp-legend-no">{i + 1}</span>
              <span className="rp-legend-dot" data-severity={f.severity} />
              <span className="rp-legend-text">
                <strong>{f.title || 'Finding'}</strong>
                {f.location ? ` · ${f.location}` : ''}
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

  useEffect(() => {
    let cancelled = false
    Promise.all(analyzed.map((img) => renderAnnotatedImage(img, { maxSize: 640 })))
      .then((urls) => {
        if (cancelled) return
        const map: Record<string, string> = {}
        analyzed.forEach((img, i) => {
          map[img.id] = urls[i]
        })
        setThumbs(map)
      })
    return () => {
      cancelled = true
    }
  }, [study.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const flatFindings: (Finding & { ref: string })[] = []
  analyzed.forEach((img, imgIndex) => {
    const a = img.analysis
    if (a) a.findings.forEach((f, j) => flatFindings.push({ ...f, ref: analyzed.length > 1 ? `${imgIndex + 1}.${j + 1}` : `${j + 1}` }))
  })

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
                <div className="rp-lh-sub">Diagnostic Radiology Report</div>
                <div className="rp-lh-meta">
                  Report date: {new Date().toLocaleDateString()} · Accession: {accession}
                </div>
              </header>

              <div className="rp-demo">
                <div className="rp-demo-cell">
                  <span>Patient Name</span>
                  <strong>{study.patient.name || '—'}</strong>
                </div>
                <div className="rp-demo-cell">
                  <span>Patient ID</span>
                  <strong>{study.patient.patientId || '—'}</strong>
                </div>
                <div className="rp-demo-cell">
                  <span>Age / Sex</span>
                  <strong>
                    {[study.patient.age, study.patient.sex].filter(Boolean).join(' / ') || '—'}
                  </strong>
                </div>
                <div className="rp-demo-cell">
                  <span>Study Date</span>
                  <strong>{study.patient.studyDate || '—'}</strong>
                </div>
                <div className="rp-demo-cell rp-demo-cell-span">
                  <span>Referring Physician</span>
                  <strong>{study.patient.referringPhysician || '—'}</strong>
                </div>
              </div>

              <Section title="Clinical Indication / History">
                <div className="rp-text">
                  <p>{study.patient.indication || '—'}</p>
                  {study.patient.clinicalHistory ? <p>{study.patient.clinicalHistory}</p> : null}
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

              {flatFindings.length > 0 && (
                <section className="rp-section rp-table-section">
                  <h3 className="rp-section-title">Findings Summary</h3>
                  <table className="rp-table">
                    <thead>
                      <tr>
                        <th style={{ width: '2.6rem' }}>#</th>
                        <th>Finding</th>
                        <th>Location</th>
                        <th style={{ width: '8rem' }}>Severity</th>
                        <th style={{ width: '6rem' }}>Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flatFindings.map((f) => (
                        <tr key={f.ref + f.id}>
                          <td>{f.ref}</td>
                          <td>{f.title || '—'}</td>
                          <td>{f.location || '—'}</td>
                          <td>
                            <span className="rp-severity-cell">
                              <span className="rp-dot" data-severity={f.severity} />
                              {SEVERITY_LABEL[f.severity]}
                            </span>
                          </td>
                          <td>{Math.round(f.confidence * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              <div className="rp-signature">
                <Signature signedName={study.report?.radiologist ?? ""} signedAt={study.report?.signedAt} isSigned={!!study.report?.signed} />
              </div>

              <footer className="rp-footer">
                <span className="rp-footer-disclaimer">
                  This report was drafted with AI assistance (MedGemma 27B, run locally). Findings are decision-support only and
                  must be reviewed and verified by a qualified radiologist before clinical use.
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