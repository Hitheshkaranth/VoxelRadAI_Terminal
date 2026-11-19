// Pure DICOM pixel → 8-bit grey conversion (uncompressed, single-channel). DOM-free so Node can test it.

export interface DicomPixelMeta {
  rows: number
  cols: number
  bitsAllocated: 8 | 16
  /** Significant bits per sample (≤ bitsAllocated); the high bits are masked off. */
  bitsStored: number
  /** 0 = unsigned, 1 = two's complement signed (sign bit is bit bitsStored-1). */
  pixelRepresentation: 0 | 1
  bigEndian: boolean
  slope: number
  intercept: number
  windowCenter?: number
  windowWidth?: number
  /** MONOCHROME1: low values are white, so the output is inverted. */
  mono1: boolean
  /** Pixel Padding Value (0028,0120), in stored-value units: marks non-image pixels (e.g. outside the CT bore). */
  paddingValue?: number
  /** Pixel Padding Range Limit (0028,0121): with paddingValue, every stored value in the closed range is padding. */
  paddingRangeLimit?: number
}

/** True when a stored (pre-rescale) value is padding, per PS3.3 C.7.5.1.1.2. */
export function isPaddingValue(stored: number, padding?: number, limit?: number): boolean {
  if (padding == null || !Number.isFinite(padding)) return false
  if (limit == null || !Number.isFinite(limit)) return stored === padding
  return stored >= Math.min(padding, limit) && stored <= Math.max(padding, limit)
}

/** DICOM PS3.3 C.11.2.1.2.1 LINEAR VOI function, mapped onto 0..255. Width below 1 is invalid. */
export function linearVoi(x: number, center: number, width: number): number {
  const c = center - 0.5
  const w = width - 1
  if (w <= 0) return x <= c ? 0 : 255
  if (x <= c - w / 2) return 0
  if (x > c + w / 2) return 255
  return ((x - c) / w + 0.5) * 255
}

/** Grey level per pixel (rows*cols, row-major) for the first frame in `raw`. */
export function dicomPixelsToGray(raw: Uint8Array, meta: DicomPixelMeta): Uint8ClampedArray {
  const n = meta.rows * meta.cols
  const bytes = meta.bitsAllocated / 8
  if (raw.length < n * bytes) throw new Error('The DICOM pixel data is truncated.')
  const stored = Math.min(Math.max(1, Math.round(meta.bitsStored) || meta.bitsAllocated), meta.bitsAllocated)
  const mask = stored >= 32 ? 0xffffffff : (1 << stored) - 1
  const signBit = 1 << (stored - 1)
  const slope = Number.isFinite(meta.slope) && meta.slope !== 0 ? meta.slope : 1
  const intercept = Number.isFinite(meta.intercept) ? meta.intercept : 0

  const values = new Float64Array(n)
  // Padding is excluded from the auto window, otherwise a -2000 bore fill would flatten real anatomy.
  const padding = new Uint8Array(n)
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < n; i++) {
    let v: number
    if (bytes === 1) v = raw[i]
    else {
      const lo = raw[i * 2]
      const hi = raw[i * 2 + 1]
      v = meta.bigEndian ? (lo << 8) | hi : (hi << 8) | lo
    }
    v &= mask
    if (meta.pixelRepresentation === 1 && v & signBit) v -= 1 << stored
    if (isPaddingValue(v, meta.paddingValue, meta.paddingRangeLimit)) { padding[i] = 1; continue }
    v = v * slope + intercept
    values[i] = v
    if (v < min) min = v
    if (v > max) max = v
  }

  const ww = meta.windowWidth
  const wc = meta.windowCenter
  const useWindow = ww != null && Number.isFinite(ww) && ww >= 1 && wc != null && Number.isFinite(wc)
  const lo = min
  const span = max - min || 1

  const out = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) {
    // Padding renders as background black in both photometric interpretations.
    if (padding[i]) { out[i] = 0; continue }
    const g = useWindow ? linearVoi(values[i], wc, ww) : Math.min(255, Math.max(0, ((values[i] - lo) / span) * 255))
    out[i] = meta.mono1 ? 255 - g : g
  }
  return out
}
