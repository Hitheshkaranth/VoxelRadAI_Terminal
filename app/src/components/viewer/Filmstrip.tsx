// OWNER: Agent 2 (Viewer & intake). Horizontal thumbnail strip beneath the viewer.
import { useCallback, useState } from 'react'
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import type { Severity, StudyImage } from '../../types'
import { SEVERITY_ORDER } from '../../types'
import { filesToStudyImages, pickImageFiles, readDroppedItems } from '../../lib/imageIntake'
import { useActiveStudy, useApp } from '../../store'
import './viewer.css'

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'var(--sev-critical)',
  significant: 'var(--sev-significant)',
  moderate: 'var(--sev-moderate)',
  minor: 'var(--sev-minor)',
  normal: 'var(--sev-normal)',
}

function worstSeverity(images: StudyImage[]): Severity {
  let worst: Severity | null = null
  for (const img of images) {
    const sevs = img.analysis?.findings.map((f) => f.severity) ?? []
    const sev = SEVERITY_ORDER.find((x) => sevs.includes(x)) ?? 'normal'
    if (!worst || SEVERITY_ORDER.indexOf(sev) < SEVERITY_ORDER.indexOf(worst)) worst = sev
  }
  return worst ?? 'normal'
}

function statusDot(img: StudyImage): string {
  if (img.status === 'error') return 'var(--red)'
  if (img.status === 'done') return SEVERITY_COLOR[worstSeverity([img])]
  return 'transparent'
}

export function Filmstrip() {
  const study = useActiveStudy()
  const activeImageId = useApp((s) => s.activeImageId)
  const [busy, setBusy] = useState(false)
  const studyId = study?.id ?? ""

  const onPick = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.size > 0)
      if (!images.length) return
      setBusy(true)
      try {
        const imgs = await filesToStudyImages(images)
        useApp.getState().addImages(studyId, imgs)
      } finally {
        setBusy(false)
      }
    },
    [studyId],
  )

  const removeImage = useCallback(
    (imageId: string) => {
      useApp.getState().removeImage(studyId, imageId)
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
        return (
          <div
            key={img.id}
            className={['vw-thumb', selected ? 'vw-selected' : ''].filter(Boolean).join(' ')}
            role="button"
            tabIndex={0}
            aria-label={`Select ${img.name}`}
            aria-current={selected}
            onClick={() => useApp.getState().selectImage(img.id)}
            onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                useApp.getState().selectImage(img.id)
              }
            }}
          >
            <img src={img.dataUrl} alt={img.name} draggable={false} />
            <button
              type="button"
              className="vw-remove"
              aria-label={`Remove ${img.name}`}
              onClick={(e) => {
                e.stopPropagation()
                removeImage(img.id)
              }}
            >
              <X />
            </button>
            <div
              className={['vw-dot', img.status === 'analyzing' ? 'vw-analyzing' : ''].filter(Boolean).join(' ')}
              style={{ background: statusDot(img) }}
              aria-label={img.status}
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
        >
          <Plus />
        </div>
      )}
    </div>
  )
}