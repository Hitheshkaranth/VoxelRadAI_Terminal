import { useEffect, useState } from 'react'
import { maskAlphaUrl } from '../../lib/maskOverlay'

/** A finding's outline mask (whole-slice PNG from the reader) drawn on its own source slice inside the 0-1000 region
 *  overlay. Other slices / planes keep the box intersection; the outline is only shown where it was traced. */
export function RegionOutline({ mask, id }: { mask: string; id: string }) {
  const [edge, setEdge] = useState<string | null>(null)
  const [area, setArea] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    maskAlphaUrl(mask, 'outline').then((u) => live && setEdge(u)).catch(() => {})
    maskAlphaUrl(mask, 'fill').then((u) => live && setArea(u)).catch(() => {})
    return () => { live = false }
  }, [mask])
  if (!edge) return null
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_')
  return <g className="volume-region-outline">
    <defs>
      <mask id={`edge-${safe}`} maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000"><image href={edge} x="0" y="0" width="1000" height="1000" preserveAspectRatio="none" /></mask>
      {area && <mask id={`area-${safe}`} maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000"><image href={area} x="0" y="0" width="1000" height="1000" preserveAspectRatio="none" /></mask>}
    </defs>
    {area && <rect className="volume-outline-fill" x="0" y="0" width="1000" height="1000" mask={`url(#area-${safe})`} />}
    <rect className="volume-outline-edge" x="0" y="0" width="1000" height="1000" mask={`url(#edge-${safe})`} />
  </g>
}
