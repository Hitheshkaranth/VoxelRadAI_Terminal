// OWNER: Agent 3 (Findings Inspector). Orchestrates the five analysis states.
import { useCallback, useEffect, useState } from 'react'
import type { AnalysisResult } from '../../types'
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
  Stethoscope,
} from 'lucide-react'
import { useApp, useActiveImage } from '../../store'
import { cancelAnalysis, runAnalysis, runAnalysisForStudy } from '../../lib/analysis'
import { AnalysisProgress } from './AnalysisProgress'
import { FindingList } from './FindingList'
import { SummaryHeader } from './SummaryHeader'
import './findings.css'

function EmptyState() {
  return (
    <div className="fd-empty">
      <div className="fd-empty-mark"><ScanLine /></div>
      <div className="fd-empty-title">Select or add an image</div>
      <div className="fd-empty-sub">Choose a view from the filmstrip or drop new images onto the viewer to begin.</div>
    </div>
  )
}

function IdleState({ studyId, imageId, unanalyzed }: { studyId: string; imageId: string; unanalyzed: number }) {
  const indication = useApp((s) => s.studies.find((x) => x.id === studyId)?.patient.indication)
  return (
    <div className="fd-idle">
      <div className="fd-idle-head">
        <div className="fd-idle-badge"><Brain /></div>
        <div>
          <h2 className="fd-idle-title">Ready for analysis</h2>
          <p className="fd-idle-sub">
            MedGemma 27B will perform a systematic review and localize abnormalities. Runs locally — no data leaves this Mac.
          </p>
        </div>
      </div>
      <div className="fd-idle-actions">
        <button className="btn btn-primary btn-lg" onClick={() => runAnalysis(studyId, imageId)}>
          <Play /> Analyze Image
        </button>
        {unanalyzed > 1 && (
          <button className="btn btn-lg fd-idle-secondary" onClick={() => runAnalysisForStudy(studyId)}>
            <Layers /> Analyze All ({unanalyzed})
          </button>
        )}
      </div>
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

function ErrorState({ studyId, imageId, error }: { studyId: string; imageId: string; error: string }) {
  return (
    <div className="fd-error">
      <div className="fd-error-head">
        <div className="fd-error-mark"><AlertTriangle /></div>
        <div>
          <div className="fd-error-title">Analysis couldn’t finish</div>
          <p className="fd-error-msg">{error || 'The model did not return a result.'}</p>
        </div>
      </div>
      <div className="fd-error-hint">Check that LM Studio is running and the medgemma-27b-it model is loaded.</div>
      <div className="fd-error-actions">
        <button className="btn btn-primary" onClick={() => runAnalysis(studyId, imageId)}>
          <RotateCcw /> Try Again
        </button>
        <button className="btn" onClick={() => useApp.getState().setConnection('checking')}>
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

function FindingsDone({ analysis, studyId, imageId }: { analysis: AnalysisResult; studyId: string; imageId: string }) {
  const selectedFindingId = useApp((s) => s.selectedFindingId)
  const hoveredFindingId = useApp((s) => s.hoveredFindingId)
  const hoverFinding = useApp((s) => s.hoverFinding)
  const selectFinding = useApp((s) => s.selectFinding)
  const setInspectorTab = useApp((s) => s.setInspectorTab)

  const forceSelect = useCallback((id: string) => selectFinding(id), [selectFinding])
  const toggle = useCallback(
    (id: string) => {
      selectFinding(selectedFindingId === id ? null : id)
    },
    [selectFinding, selectedFindingId],
  )

  return (
    <div className="fd-done">
      <SummaryHeader analysis={analysis} />

      <Sec icon={<Stethoscope />} title="Impression">
        <div className="fd-impression">
          <p>{analysis.impression || '—'}</p>
        </div>
      </Sec>

      <FindingList
        analysis={analysis}
        selectedFindingId={selectedFindingId}
        hoveredFindingId={hoveredFindingId}
        onSelect={forceSelect}
        onToggle={toggle}
        onHover={hoverFinding}
      />

      <Sec icon={<ListChecks />} title="Pertinent negatives">
        <div className="fd-list">
          {analysis.pertinentNegatives.map((n, i) => (
            <div className="fd-list-row fd-neg" key={i}>
              <Check strokeWidth={2.5} />
              <span>{n}</span>
            </div>
          ))}
        </div>
      </Sec>

      <Sec icon={<ListTree />} title="Differential diagnosis">
        <div className="fd-list">
          {analysis.differential.map((d, i) => (
            <div className="fd-list-row" key={i}>
              <span className="fd-list-num">{i + 1}</span>
              <span>{d}</span>
            </div>
          ))}
        </div>
      </Sec>

      <Sec icon={<Stethoscope />} title="Recommendations">
        <div className="fd-list">
          {analysis.recommendations.map((r, i) => (
            <div className="fd-list-row" key={i}>
              <ChevronRight />
              <span>{r}</span>
            </div>
          ))}
        </div>
      </Sec>

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

      <div className="fd-footer">
        <button className="btn btn-plain fd-footer-btn" onClick={() => runAnalysis(studyId, imageId)}>
          <RotateCcw /> Re-analyze
        </button>
        <button className="btn btn-primary fd-footer-btn" onClick={() => setInspectorTab('report')}>
          <FileText /> Create Report
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
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!image || image.status !== 'analyzing') {
      setElapsed(0)
      return
    }
    const start = Date.now()
    setElapsed(0)
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(id)
  }, [image?.id, image?.status])

  if (!image) return <EmptyState />

  const studyId = study?.id ?? ''
  const imageId = image.id
  const unanalyzed = study?.images.filter((i) => i.status !== 'done').length ?? 0

  let block: React.ReactNode
  switch (image.status) {
    case 'analyzing':
      block = <AnalysisProgress stage={image.progressText ?? ''} elapsed={elapsed} onCancel={() => cancelAnalysis(imageId)} />
      break
    case 'error':
      block = <ErrorState studyId={studyId} imageId={imageId} error={image.error ?? ''} />
      break
    case 'done':
      block = image.analysis ? <FindingsDone analysis={image.analysis} studyId={studyId} imageId={imageId} /> : <EmptyState />
      break
    default:
      block = <IdleState studyId={studyId} imageId={imageId} unanalyzed={unanalyzed} />
  }

  return <div className="fd-root"><div className="fd-inner">{block}</div></div>
}