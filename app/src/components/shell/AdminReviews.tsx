import { ShellButton } from './ShellButton'
import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import type { Study } from '../../types'
import { acceptanceRate, fetchOrganizationReviewRecords, fetchOrganizationReviews, studyReviewRecords, summarizeStudies, toJsonLines, type ReviewGroup, type ReviewSummary } from '../../lib/reviewStats'
import { downloadFile } from '../../lib/reportExport'

const percent = (value: number | null) => value === null ? '–' : `${Math.round(value * 100)}%`

/** Reviewer decisions on model findings, from this browser's studies or the organization's stored studies. */
export function AdminReviews({ scope, studies }: { scope: 'local' | 'organization'; studies: Study[] }) {
  const local = useMemo(() => scope === 'local' ? summarizeStudies(studies) : null, [scope, studies])
  const [remote, setRemote] = useState<ReviewSummary | null>(null)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  useEffect(() => {
    if (scope !== 'organization') return
    const controller = new AbortController()
    void fetchOrganizationReviews(controller.signal).then((value) => { if (!controller.signal.aborted) { setRemote(value); setError('') } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Review data could not be loaded.') })
    return () => controller.abort()
  }, [scope])
  const summary = local ?? remote
  const exportRecords = async () => {
    setExporting(true); setExportMessage('')
    try {
      const records = scope === 'local' ? await studyReviewRecords(studies) : await fetchOrganizationReviewRecords()
      if (!records.length) { setExportMessage('No analysed images to export yet.'); return }
      downloadFile(`voxelrad-reviews-${scope}-${new Date().toISOString().slice(0, 10)}.jsonl`, toJsonLines(records), 'application/x-ndjson')
      setExportMessage(`Exported ${records.length.toLocaleString()} analysed ${records.length === 1 ? 'image' : 'images'}.`)
    } catch (reason) { setExportMessage(reason instanceof Error ? reason.message : 'The export failed. Try again.') }
    finally { setExporting(false) }
  }
  return <section className="admin-reviews" aria-labelledby="admin-reviews-title">
    <h3 className="admin-heading" id="admin-reviews-title">Finding review</h3>
    <p className="admin-note">How often reviewers kept or dismissed model findings. Acceptance is the share of reviewed findings that were accepted; findings nobody reviewed are counted separately.</p>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {!summary && !error && <p className="admin-note" role="status">Loading review data...</p>}
    {summary && <>
      <dl className="admin-metrics">
        <div><dt>Model findings</dt><dd>{summary.totals.total.toLocaleString()}</dd></div>
        <div><dt>Acceptance</dt><dd>{percent(acceptanceRate(summary.totals))}</dd></div>
        <div><dt>Not reviewed</dt><dd>{summary.totals.unreviewed.toLocaleString()}</dd></div>
        <div><dt>Signed reports edited</dt><dd>{summary.reports.signed ? percent(summary.reports.edited / summary.reports.signed) : '–'}</dd></div>
      </dl>
      {summary.totals.total === 0 ? <p className="admin-note">No analysed findings yet. Figures appear once images have been read and reviewed.</p> : <>
        <ReviewTable caption="By modality" rows={summary.byModality} />
        <ReviewTable caption="By model" rows={summary.byModel} />
        <ReviewTable caption="By finding category" rows={summary.byCategory} />
      </>}
    </>}
    <div className="admin-export">
      <div><strong>Training export</strong><p className="admin-note">One JSON line per analysed image: the model's findings, boxes, measurements and each reviewer decision. Patient details, images, outlines, report text and stored IDs are left out; studies are referenced by a one-way code.</p></div>
      <ShellButton className="btn" disabled={exporting} onClick={() => void exportRecords()}><Download aria-hidden="true" />{exporting ? 'Exporting...' : 'Export JSONL'}</ShellButton>
    </div>
    <p className="admin-note" aria-live="polite">{exportMessage}</p>
  </section>
}

function ReviewTable({ caption, rows }: { caption: string; rows: ReviewGroup[] }) {
  return <div className="admin-table-wrap"><table className="admin-table admin-review-table"><caption>{caption}</caption>
    <thead><tr><th scope="col">Group</th><th scope="col">Findings</th><th scope="col">Accepted</th><th scope="col">Dismissed</th><th scope="col">Not reviewed</th><th scope="col">Acceptance</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.name}><th scope="row">{row.name}</th><td>{row.total.toLocaleString()}</td><td>{row.accepted.toLocaleString()}</td><td>{row.dismissed.toLocaleString()}</td><td>{row.unreviewed.toLocaleString()}</td><td>{percent(acceptanceRate(row))}</td></tr>)}</tbody>
  </table></div>
}
