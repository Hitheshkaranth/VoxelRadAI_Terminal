// OWNER: Agent 2 (Viewer & intake). Burns finding boxes + numbering into a thumbnail for reports/print.
import type { Finding, Severity, StudyImage } from '../types'

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#ff3b30',
  significant: '#ff9500',
  moderate: '#e6a700',
  minor: '#007aff',
  normal: '#34c759',
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image for annotation.'))
    img.src = url
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/**
 * Draw the image on a canvas and burn in each finding's bounding box (severity colour, 3px, rounded) with
 * numbered circle markers matching the viewer ordering. Returns a JPEG data URL for the report / print view.
 */
export async function renderAnnotatedImage(image: StudyImage, opts?: { maxSize?: number }): Promise<string> {
  const maxSize = opts?.maxSize ?? 1400
  const img = await loadImage(image.dataUrl)
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D is not supported in this browser.')
  }
  ctx.drawImage(img, 0, 0, w, h)

  const findings = image.analysis?.findings ?? []
  findings.forEach((finding: Finding, index: number) => {
    if (!finding.bbox) return
    const { x, y, w: fw, h: fh } = finding.bbox
    const bx = x * w
    const by = y * h
    const bw = Math.max(fw * w, 16)
    const bh = Math.max(fh * h, 16)
    const color = SEVERITY_COLOR[finding.severity] ?? SEVERITY_COLOR.moderate

    ctx.save()
    if (finding.severity !== 'normal' && finding.classifier?.supported !== false) {
      // tint the diagnosed region, matching the viewer highlight
      ctx.globalAlpha = 0.2
      ctx.fillStyle = color
      roundRect(ctx, bx, by, bw, bh, 8)
      ctx.fill()
      ctx.globalAlpha = 1
    }
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.lineJoin = 'round'
    roundRect(ctx, bx, by, bw, bh, 8)
    ctx.stroke()

    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(bx + 12, by + 12, 13, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 16px -apple-system, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(index + 1), bx + 12, by + 13)
    ctx.restore()
  })

  return canvas.toDataURL('image/jpeg', 0.92)
}