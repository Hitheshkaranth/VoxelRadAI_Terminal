import { ScanButton } from './ScanButton'
// OWNER: Agent 2 (Viewer & intake). Horizontal thumbnail strip beneath the viewer.
import { useCallback, useState } from 'react'
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import type { StudyImage } from '../../types'
import { SEVERITY_LABEL } from '../../types'
import { pickImageFiles, readDroppedItems } from '../../lib/imageIntake'
import { addFilesToActiveStudy } from '../../lib/upload'
import { cancelImages } from '../../lib/analysis'
import { findingCounts, worstSeverity } from '../../lib/classifier'
import { useActiveStudy, useApp } from '../../store'
import { toast } from '../shell/toastStore'
import { countLabel } from '../shell/shellState'
import './viewer.css'

/** Dot colour + accessible name, from the same helpers the inspector uses. */
function statusDot(img: StudyImage): { className: string; color?: string; label: string } {
  if (img.status === 'analyzing') return { className: 'vw-analyzing', label: 'Analyzing' }
  if (img.status === 'error') return { className: 'vw-error', label: 'Analysis failed' }
  if (img.status !== 'done' || !img.analysis) return { className: 'vw-unread', label: 'Not analyzed yet' }
  const sev = worstSeverity(img.analysis.findings) ?? 'normal'
  const { active, flagged } = findingCounts(img.analysis)
  return {
    className: '',
    color: `var(--sev-${sev})`,
    label: active || flagged ? `${SEVERITY_LABEL[sev]} · ${countLabel(active, flagged)}` : 'No acute findings',
  }
}

export function Filmstrip() {
  const study = useActiveStudy()
  const activeImageId = useApp((s) => s.activeImageId)
  const [busy, setBusy] = useState(false)
  const studyId = study?.id ?? ''

  // Shared intake path so unreadable files surface as toasts instead of failing silently.
  const onPick = useCallback(async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    try {
      await addFilesToActiveStudy(files)
    } finally {
      setBusy(false)
    }
  }, [])

  const removeImage = useCallback(
    (imageId: string) => {
      const st = useApp.getState()
      const s = st.studies.find((x) => x.id === studyId)
      const index = s?.images.findIndex((i) => i.id === imageId) ?? -1
      const img = s?.images[index]
      if (!img) return
      cancelImages([imageId])
      st.removeImage(studyId, imageId)
      // An interrupted run cannot resume, so a restored film comes back unread (its earlier result, if any, is kept).
      const restored: StudyImage =
        img.status === 'analyzing'
          ? { ...img, status: 'idle', progressText: undefined, stage: undefined, analysisStartedAt: undefined }
          : img
      toast(`Removed ${img.name}`, 'info', {
        label: 'Undo',
        run: () => {
          const cur = useApp.getState()
          if (!cur.studies.some((x) => x.id === studyId)) return
          cur.addImages(studyId, [restored])
          // addImages appends; put the film back where it was.
          useApp.setState((u) => ({
            studies: u.studies.map((x) => {
              if (x.id !== studyId) return x
              const rest = x.images.filter((i) => i.id !== restored.id)
              rest.splice(Math.min(index, rest.length), 0, restored)
              return { ...x, images: rest }
            }),
          }))
        },
      })
    },
    [studyId],
  )

  const onDrop = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      readDroppedItems(e.dataTransfer).then((files) => {
        if (files.length) void onPick(files)
      })
    },
    [onPick],
  )

  if (!study || study.images.length === 0) return null

  return (
    <div
      className="vw-strip"
      onDragEnter={(e) => e.preventDefault()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {study.images.map((img) => {
        const selected = img.id === activeImageId
        const dot = statusDot(img)
        return (
          <div
            key={img.id}
            className={['vw-thumb', selected ? 'vw-selected' : ''].filter(Boolean).join(' ')}
            role="button"
            tabIndex={0}
            aria-label={`Select ${img.name} — ${dot.label}`}
            aria-current={selected}
            onClick={() => useApp.getState().selectImage(img.id)}
            onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
              if (e.target !== e.currentTarget) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                useApp.getState().selectImage(img.id)
              }
            }}
          >
            <img src={img.dataUrl} alt="" draggable={false} />
            <ScanButton
              type="button"
              className="vw-remove"
              aria-label={`Remove ${img.name}`}
              onClick={(e) => {
                e.stopPropagation()
                removeImage(img.id)
              }}
            >
              <X />
            </ScanButton>
            <div
              className={['vw-dot', dot.className].filter(Boolean).join(' ')}
              style={dot.color ? { background: dot.color } : undefined}
              role="img"
              aria-label={dot.label}
              title={dot.label}
            />
          </div>
        )
      })}
      {busy ? (
        <div className="vw-add" role="status" aria-label="Processing images">
          <Loader2 />
        </div>
      ) : (
        <div
          className="vw-add"
          role="button"
          tabIndex={0}
          aria-label="Add more images"
          onClick={() => void pickImageFiles().then((files) => void onPick(files))}
          onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              void pickImageFiles().then((files) => void onPick(files))
            }
          }}
        >
          <Plus />
        </div>
      )}
    </div>
  )
}
