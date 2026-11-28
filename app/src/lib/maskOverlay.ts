// Outline masks → alpha images the viewer tints with each finding's severity colour (CSS mask-image), so colours stay in
// the stylesheet. Skanda's masks arrive at 256² over the whole image; they are upscaled with smoothing and re-thresholded
// so edges stay smooth at viewer zoom, then either kept whole (fill) or reduced to an edge band (outline).

export type MaskMode = 'fill' | 'outline'

const SIZE = 768 // working resolution: smooth at typical zoom, cheap to compute (~0.6 MP)
const cache = new Map<string, Promise<string>>()

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('mask image failed to load'))
    img.src = src
  })
}

async function build(src: string, mode: MaskMode): Promise<string> {
  const img = await load(src)
  const c = document.createElement('canvas')
  c.width = c.height = SIZE
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // A light blur before the threshold rounds off the 256² staircase (≈ one source pixel; skipped where unsupported).
  if ('filter' in ctx) ctx.filter = `blur(${(SIZE / 256) * 1.2}px)`
  ctx.drawImage(img, 0, 0, SIZE, SIZE)
  if ('filter' in ctx) ctx.filter = 'none'
  const px = ctx.getImageData(0, 0, SIZE, SIZE)
  const on = new Uint8Array(SIZE * SIZE)
  for (let i = 0; i < on.length; i++) on[i] = px.data[i * 4] >= 128 ? 1 : 0
  const out = ctx.createImageData(SIZE, SIZE)
  // Edge band: a pixel inside the mask with an outside pixel within r (≈ 2.5 px at a fit-to-screen film).
  const r = 3
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x
      if (!on[i]) continue
      let keep = mode === 'fill'
      if (!keep) {
        for (let dy = -r; dy <= r && !keep; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r * r) continue
            const yy = y + dy
            const xx = x + dx
            if (yy < 0 || xx < 0 || yy >= SIZE || xx >= SIZE || !on[yy * SIZE + xx]) {
              keep = true
              break
            }
          }
        }
      }
      if (keep) {
        const o = i * 4
        out.data[o] = out.data[o + 1] = out.data[o + 2] = 255
        out.data[o + 3] = 255
      }
    }
  }
  ctx.putImageData(out, 0, 0)
  return c.toDataURL('image/png')
}

/** FNV-1a over the whole data URL (PNG tails are identical, so a prefix or suffix would collide). */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

/** Alpha image (white, opaque where drawn) for one mask and mode; cached per mask. */
export function maskAlphaUrl(src: string, mode: MaskMode): Promise<string> {
  const key = `${mode}:${src.length}:${hash(src)}`
  let p = cache.get(key)
  if (!p) {
    p = build(src, mode)
    cache.set(key, p)
    if (cache.size > 200) cache.delete(cache.keys().next().value!)
  }
  return p
}

const anchors = new Map<string, Promise<{ x: number; y: number } | null>>()

/**
 * Where a finding's number belongs on its outline: the top of the largest traced region (stray specks ignored), as
 * 0–1 image coordinates. The model's box can be much looser than its outline, so a corner of the box may sit outside
 * the body; the outline's own top edge never does. Null when the mask is empty or cannot be read.
 */
export function maskAnchor(src: string): Promise<{ x: number; y: number } | null> {
  const key = `${src.length}:${hash(src)}`
  let p = anchors.get(key)
  if (!p) {
    p = load(src).then((img) => {
      const N = 256
      const c = document.createElement('canvas')
      c.width = c.height = N
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(img, 0, 0, N, N)
      const px = ctx.getImageData(0, 0, N, N).data
      const label = new Int32Array(N * N).fill(-1)
      let best: { size: number; top: number; xs: number[] } | null = null
      const stack: number[] = []
      for (let start = 0; start < N * N; start++) {
        if (label[start] !== -1 || px[start * 4] < 128) continue
        label[start] = start
        stack.push(start)
        let size = 0, top = N, xs: number[] = []
        while (stack.length) {
          const i = stack.pop()!
          size++
          const y = (i / N) | 0, x = i % N
          if (y < top) { top = y; xs = [x] } else if (y === top) xs.push(x)
          for (const j of [i - 1, i + 1, i - N, i + N]) {
            if (j < 0 || j >= N * N || label[j] !== -1 || px[j * 4] < 128) continue
            if ((j === i - 1 || j === i + 1) && ((j / N) | 0) !== y) continue
            label[j] = start
            stack.push(j)
          }
        }
        if (!best || size > best.size) best = { size, top, xs }
      }
      if (!best || best.size < 4) return null
      best.xs.sort((a, b) => a - b)
      return { x: (best.xs[best.xs.length >> 1] + 0.5) / N, y: (best.top + 0.5) / N }
    }).catch(() => null)
    anchors.set(key, p)
    if (anchors.size > 200) anchors.delete(anchors.keys().next().value!)
  }
  return p
}
