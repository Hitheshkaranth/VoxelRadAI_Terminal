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
