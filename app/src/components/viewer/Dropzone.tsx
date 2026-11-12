import { ScanButton } from './ScanButton'
// OWNER: Agent 2 (Viewer & intake). Empty-state drop target shown when a study has no images.
import { useCallback, useState } from 'react'
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { FileImage, Loader2, Paperclip } from 'lucide-react'
import { filesToStudyImages, pickImageFiles, readDroppedItems } from '../../lib/imageIntake'
import { useApp } from '../../store'
import { routeDroppedFiles } from '../shell/shellState'
import './viewer.css'

export function Dropzone({ studyId }: { studyId: string }) {
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [added, setAdded] = useState(0)

  const addImages = useCallback((studyId_: string, imgs: Awaited<ReturnType<typeof filesToStudyImages>>) => {
    useApp.getState().addImages(studyId_, imgs)
  }, [])

  const processFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.size > 0)
      if (!images.length) return
      setBusy(true)
      setError('')
      try {
        const imgs = await filesToStudyImages(images)
        addImages(studyId, imgs)
        setAdded(imgs.length)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [addImages, studyId],
  )

  const onDrop = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setDragging(false)
      readDroppedItems(e.dataTransfer).then((files) => {
        // An .nrrd volume dropped here must open as a volume, not be decoded as a 2D image.
        if (files.some((file) => file.name.toLowerCase().endsWith('.nrrd'))) routeDroppedFiles(files)
        else if (files.length) void processFiles(files)
      })
    },
    [processFiles],
  )

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      void pickImageFiles().then((files) => {
        if (files.length) void processFiles(files)
      })
    }
  }

  if (busy) {
    return (
      <div className="vw-stage">
        <div className="vw-drop">
          <div className="vw-drop-progress">
            <Loader2 />
            <div className="vw-title">Processing images…</div>
            <div className="vw-sub">Decoding and preparing each frame.</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="vw-stage">
      <div
        className={['vw-drop', dragging ? 'vw-active' : ''].filter(Boolean).join(' ')}
        role="button"
        tabIndex={0}
        aria-label="Drop images here or choose files"
        onDragEnter={(e) => {
          e.preventDefault()
          if (e.dataTransfer.types?.includes('Files')) setDragging(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (e.dataTransfer.types?.includes('Files')) setDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setDragging(false)
        }}
        onDrop={onDrop}
        onKeyDown={onKey}
        onClick={() => {
          if (error) return
          void pickImageFiles().then((files) => {
            if (files.length) void processFiles(files)
          })
        }}
      >
        {error ? (
          <div className="vw-drop-error">
            <FileImage size={44} opacity={0.6} />
            <div className="vw-title">Could not add that file</div>
            <div className="vw-msg">{error}</div>
            <ScanButton
              type="button"
              className="btn btn-plain"
              onClick={(e) => {
                e.stopPropagation()
                setError('')
              }}
            >
              Dismiss
            </ScanButton>
          </div>
        ) : (
          <>
            <div className="vw-drop-icon">
              <FileImage />
            </div>
            <div className="vw-title">Add images</div>
            <div className="vw-sub">
              Drag and drop PNG, JPEG or DICOM files here, paste from the clipboard, or
            </div>
            <ScanButton
              type="button"
              className="btn btn-primary btn-lg"
              aria-label="Choose files from disk"
              onClick={(e) => {
                e.stopPropagation()
                void pickImageFiles().then((files) => {
                  if (files.length) void processFiles(files)
                })
              }}
            >
              Choose Files…
            </ScanButton>
            {added > 0 && (
              <div className="vw-drop-hint">
                <Paperclip size={13} />
                Added {added} image{added > 1 ? 's' : ''}. Select one to begin analysis.
              </div>
            )}
            <div className="vw-drop-hint">Paste with <span className="vw-kbd">⌘V</span> anywhere while this pane is open.</div>
          </>
        )}
      </div>
    </div>
  )
}