import { analysisEligibility } from '../../lib/modality'
// OWNER: Agent 3 (Findings Inspector). Orchestrates the five analysis states.
import { useCallback, useState } from 'react'
import type { AnalysisResult, ConnectionState, FindingReview, Settings, Study } from '../../types'
import {
  AlertCircle,
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Info,
  ListChecks,
  ListTree,
  Layers,
  Play,
  RotateCcw,
  ScanLine,
  Scissors,
  Stethoscope,
  Users,
} from 'lucide-react'
import { useApp, useActiveImage } from '../../store'
import { cancelAnalysis, runAnalysis, runAnalysisForStudy, runSecondReader } from '../../lib/analysis'
import { findingCounts } from '../../lib/classifier'
import { checkNow } from '../../lib/connection'
import { toast } from '../shell/toastStore'
import { analyzeImageAction } from '../shell/shellState'
import { AnalysisProgress } from './AnalysisProgress'
import { FindingList } from './FindingList'
import { BlindSpotNote, SummaryHeader } from './SummaryHeader'
import './findings.css'

/** Median wall time of finished analyses (all studies), or the benchmark's 77 s before there are any. */
const FALLBACK_ETA_MS = 77_000
function medianDuration(studies: Study[]): number {
  const d = studies
    .flatMap((s) => s.images.map((i) => i.analysis?.durationMs ?? 0))
    .filter((x) => x > 0)
    .sort((a, b) => a - b)
  if (!d.length) return FALLBACK_ETA_MS
  const m = d.length >> 1
  return d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2
}

const blocked = (c: ConnectionState) => c === 'offline' || c === 'model-missing'

function connectionNote(c: ConnectionState, model: string): string {
  return c === 'offline'
    ? 'LM Studio is not reachable. Start its local server, then check again.'
    : `Model “${model}” is not loaded in LM Studio. Load it, then check again.`
}

async function recheck() {
  const c = await checkNow()
  toast(
    c === 'online' ? 'Connected to LM Studio' : c === 'model-missing' ? 'LM Studio is up, but the model is not loaded' : 'LM Studio is not reachable',
    c === 'online' ? 'success' : 'error',
  )
}

function EmptyState() {
  return (
    <div className="fd-empty">
      <div className="fd-empty-mark"><ScanLine /></div>
      <div className="fd-empty-title">Select or add an image</div>
      <div className="fd-empty-sub">Choose a view from the filmstrip or drop new images onto the viewer to begin.</div>
    </div>
  )
}

function ConnectionBlock({ connection, model }: { connection: ConnectionState; model: string }) {
  if (!blocked(connection)) return null
  return (
    <div className="fd-hint fd-hint--warn" role="note">
      <AlertTriangle />
      <span>{connectionNote(connection, model)}</span>
      <button className="fd-hint-link" onClick={() => void recheck()}>
        Check
      </button>
    </div>
  )
}

function IdleState({ studyId, imageId, unanalyzed }: { studyId: string; imageId: string; unanalyzed: number }) {
  const indication = useApp((s) => s.studies.find((x) => x.id === studyId)?.patient.indication)
  const connection = useApp((s) => s.connection)
  const model = useApp((s) => s.settings.model)
  const off = blocked(connection)
  return (
    <div className="fd-idle">
      <div className="fd-idle-head">
        <div className="fd-idle-badge"><Brain /></div>
        <div>
          <h2 className="fd-idle-title">Image analysis</h2>
          <p className="fd-idle-sub">
            {model} drafts findings for review. CT and MRI analysis covers the displayed image, not unseen slices.
          </p>
        </div>
      </div>
      <div className="fd-idle-actions">
        <button className="btn btn-primary btn-lg" disabled={off} onClick={() => analyzeImageAction(studyId, imageId)}>
          <Play /> Analyze Image
        </button>
        {unanalyzed > 1 && (
          <button className="btn btn-lg fd-idle-secondary" disabled={off} onClick={() => runAnalysisForStudy(studyId)}>
            <Layers /> Analyze All ({unanalyzed})
          </button>
        )}
      </div>
      <ConnectionBlock connection={connection} model={model} />
      {!indication && (
        <div className="fd-hint">
          <Info />
          <span>Add clinical indication for a more focused read.</span>
          <button className="fd-hint-link" onClick={() => useApp.getState().openSheet('patient')}>
            Add →
          </button>
        </div>
      )}
    </div>
  )
}

/** Turn the raw error into the most likely fix. */
function errorHint(error: string, settings: Settings): string {
  if (/out.of.memory|insufficient memory|kIOGPUCommandBufferCallbackErrorOutOfMemory/i.test(error))
    return 'The model ran out of GPU memory while reading the image. Use a smaller model or quantization, reduce image processing size, and reload it in LM Studio.'
  if (/no output for|stopped responding/i.test(error))
    return 'The model did not produce output in time. Check LM Studio for memory errors before retrying; a connected server may still be unable to run the model.'
  if (/fetch|network|ECONN|refused|offline|reach|connect|timed? ?out|50[234]/i.test(error))
    return `LM Studio did not respond at ${settings.baseUrl}. Check that its local server is running.`
  if (/model|not found|404|no models? loaded/i.test(error))
    return `Check that “${settings.model}” is loaded in LM Studio (Settings → model name must match exactly).`
  if (/pars|json|schema|truncat|cut off|finish/i.test(error))
    return 'The model’s answer could not be read as findings, so nothing was recorded — the image is not marked normal. Trying again usually works.'
  if (/decod|dicom|image|pixel|canvas/i.test(error))
    return 'The image could not be decoded. Try exporting it as PNG or JPEG, or a DICOM with standard pixel data.'
  return `Check that LM Studio is running and “${settings.model}” is loaded.`
}

function ErrorState({ studyId, imageId, error }: { studyId: string; imageId: string; error: string }) {
  const settings = useApp((s) => s.settings)
  return (
    <div className="fd-error">
      <div className="fd-error-head">
        <div className="fd-error-mark"><AlertTriangle /></div>
        <div>
          <div className="fd-error-title">Analysis couldn’t finish</div>
          <p className="fd-error-msg">{error || 'The model did not return a result.'}</p>
        </div>
      </div>
      <div className="fd-error-hint">{errorHint(error, settings)}</div>
      <div className="fd-error-actions">
        <button className="btn btn-primary" onClick={() => runAnalysis(studyId, imageId)}>
          <RotateCcw /> Try Again
        </button>
        <button className="btn" onClick={() => void recheck()}>
          Check connection
        </button>
      </div>
    </div>
  )
}

function Sec({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="fd-section">
      <div className="fd-section-header">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </section>
  )
}

function SecondReaderButton({ studyId, analysis }: { studyId: string; analysis: AnalysisResult }) {
  const [busy, setBusy] = useState(false)
  const sr = analysis.secondReader
  const run = async () => {
    setBusy(true)
    try {
      const r = await runSecondReader(studyId)
      if (r.status === 'ok')
        toast(r.added ? `Second reader added ${r.added} finding${r.added === 1 ? '' : 's'}` : 'Second reader found nothing to add', 'success')
      else if (r.status === 'not-loaded') toast('MAIRA-2 is not loaded — load it in Settings first', 'error')
      else if (r.status === 'unavailable') toast('MAIRA-2 service is not running', 'error')
      else toast(`Second reader: ${r.status}`, 'error')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Second reader failed', 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fd-second">
      <button className="btn btn-plain fd-footer-btn" disabled={busy} onClick={() => void run()}>
        {busy ? <span className="spinner" aria-hidden="true" /> : <Users />} Add second reader (MAIRA-2)
      </button>
      {sr && (
        <span className="fd-second-status">
          {sr.status === 'ok' ? `Last run added ${sr.added}` : `Last run: ${sr.status}`}
          {sr.message ? ` · ${sr.message}` : ''}
        </span>
      )}
    </div>
  )
}

function FindingsDone({ analysis, studyId, imageId }: { analysis: AnalysisResult; studyId: string; imageId: string }) {
  const selectedFindingId = useApp((s) => s.selectedFindingId)
  const hoveredFindingId = useApp((s) => s.hoveredFindingId)
  const hoverFinding = useApp((s) => s.hoverFinding)
  const selectFinding = useApp((s) => s.selectFinding)
  const setInspectorTab = useApp((s) => s.setInspectorTab)
  const setFindingReview = useApp((s) => s.setFindingReview)
  const mairaEnabled = useApp((s) => s.settings.maira?.enabled ?? false)
  const offline = useApp((s) => blocked(s.connection))

  const toggle = useCallback(
    (id: string) => selectFinding(useApp.getState().selectedFindingId === id ? null : id),
    [selectFinding],
  )
  const review = useCallback(
    (id: string, r: FindingReview | undefined) => setFindingReview(studyId, imageId, id, r),
    [setFindingReview, studyId, imageId],
  )
  const { flagged } = findingCounts(analysis)

  return (
    <div className="fd-done">
      <SummaryHeader analysis={analysis} />

      {analysis.truncated && (
        <div className="fd-hint fd-hint--warn" role="alert">
          <Scissors />
          <span>Model output was cut off — some findings may be missing; re-analyze.</span>
        </div>
      )}

      <Sec icon={<Stethoscope />} title={flagged > 0 ? 'Model impression (unfiltered)' : 'Impression'}>
        <div className="fd-impression">
          <p>{analysis.impression || '—'}</p>
        </div>
      </Sec>

      <FindingList
        analysis={analysis}
        selectedFindingId={selectedFindingId}
        hoveredFindingId={hoveredFindingId}
        onSelect={selectFinding}
        onToggle={toggle}
        onHover={hoverFinding}
        onReview={review}
      />

      {analysis.pertinentNegatives.length > 0 && <Sec icon={<ListChecks />} title="Pertinent negatives">
        <div className="fd-list">
          {analysis.pertinentNegatives.map((n, i) => (
            <div className="fd-list-row fd-neg" key={i}>
              <Check strokeWidth={2.5} />
              <span>{n}</span>
            </div>
          ))}
        </div>
      </Sec>}
      <BlindSpotNote model={analysis.model} />

      {analysis.differential.length > 0 && <Sec icon={<ListTree />} title="Differential diagnosis">
        <div className="fd-list">
          {analysis.differential.map((d, i) => (
            <div className="fd-list-row" key={i}>
              <span className="fd-list-num">{i + 1}</span>
              <span>{d}</span>
            </div>
          ))}
        </div>
      </Sec>}

      {analysis.recommendations.length > 0 && <Sec icon={<Stethoscope />} title="Recommendations">
        <div className="fd-list">
          {analysis.recommendations.map((r, i) => (
            <div className="fd-list-row" key={i}>
              <ChevronRight />
              <span>{r}</span>
            </div>
          ))}
        </div>
      </Sec>}

      <details className="fd-disc">
        <summary>
          <ChevronDown /> Model output
        </summary>
        <div className="fd-disc-body">
          <div className="fd-disc-inner">
            <div className="fd-disc-content">
              <pre className="fd-raw">{analysis.rawText}</pre>
            </div>
          </div>
        </div>
      </details>

      {mairaEnabled && <SecondReaderButton studyId={studyId} analysis={analysis} />}

      <div className="fd-footer">
        <button
          className="btn btn-plain fd-footer-btn"
          disabled={offline}
          title={offline ? 'LM Studio is offline or the model is not loaded' : undefined}
          onClick={() => analyzeImageAction(studyId, imageId)}
        >
          <RotateCcw /> Re-analyze
        </button>
        <button className="btn btn-primary fd-footer-btn" onClick={() => setInspectorTab('report')}>
          <FileText /> Open report
        </button>
      </div>

      <div className="fd-disclaimer">
        <AlertCircle />
        <span>AI-generated decision support. Findings must be verified by a qualified radiologist.</span>
      </div>
    </div>
  )
}

export function FindingsPanel() {
  const image = useActiveImage()
  const study = useApp((s) => s.studies.find((x) => x.id === s.activeStudyId) ?? null)
  const etaMs = useApp((s) => medianDuration(s.studies))

  if (!image) return <EmptyState />

  const eligibility = analysisEligibility(image)
  if (!eligibility.supported) return <div className="fd-inner"><h2 className="preview-heading">Preview only</h2><p>{eligibility.reason}</p><p className="preview-note">This image can be viewed and compared. CT and MRI interpretation is not available in the connected chest-radiograph pipeline.</p></div>

  const studyId = study?.id ?? ''
  const imageId = image.id
  const unanalyzed = study?.images.filter((i) => i.status !== 'done').length ?? 0

  let block: React.ReactNode
  switch (image.status) {
    case 'analyzing':
      block = (
        <AnalysisProgress
          key={imageId}
          stage={image.stage}
          detail={image.progressText}
          startedAt={image.analysisStartedAt}
          etaMs={etaMs}
          onCancel={() => cancelAnalysis(imageId)}
        />
      )
      break
    case 'error':
      block = <ErrorState studyId={studyId} imageId={imageId} error={image.error ?? ''} />
      break
    case 'done':
      block = image.analysis ? <FindingsDone key={imageId} analysis={image.analysis} studyId={studyId} imageId={imageId} /> : <EmptyState />
      break
    default:
      block = <IdleState studyId={studyId} imageId={imageId} unanalyzed={unanalyzed} />
  }

  return <div className="fd-root"><div className="fd-inner">
    <header className="fd-workspace-title"><div><h1>Findings</h1></div><span className="fd-image-context" title={image.name}>{image.name}</span></header>
    {block}
  </div></div>
}
