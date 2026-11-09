import { useActiveImage, useActiveStudy, useApp } from '../../store'

export function ImageContext() {
  const image = useActiveImage()
  const study = useActiveStudy()
  if (!image || !study) return null
  const dicom = image.sourceFrameCount !== undefined
  return <div className="image-context">
    <span className="image-context-name" title={image.name}>{image.name}</span>
    {dicom ? <span className="image-context-type">{image.sourceModality || 'DICOM'} · {image.sourceFrameCount! > 1 ? `Frame ${(image.sourceFrameIndex ?? 0) + 1}/${image.sourceFrameCount}` : 'Single-frame preview'}</span> :
      <label className="image-type-label">Image type
        <select aria-label="Image type" value={image.sourceModality || ''}
          disabled={!!image.analysis || image.status === 'analyzing' || !!study.report}
          onChange={(e) => useApp.getState().setImageModality(study.id, image.id, e.target.value)}>
          <option value="">Not specified</option><option value="CR">Chest X-ray</option><option value="CT">CT</option><option value="MR">MRI</option><option value="OT">Other</option>
        </select>
      </label>}
  </div>
}
