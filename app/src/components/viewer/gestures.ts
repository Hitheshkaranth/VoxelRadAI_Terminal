export interface TouchPoint { x: number; y: number }
export interface ViewTransform { zoom: number; panX: number; panY: number }
export interface PinchAnchor {
  distance: number
  center: TouchPoint
  view: ViewTransform
}

export function touchGeometry(a: TouchPoint, b: TouchPoint) {
  return {
    distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
    center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  }
}

/** Preserve the image point beneath the initial centroid while zooming and translating. */
export function pinchTransform(anchor: PinchAnchor, a: TouchPoint, b: TouchPoint): ViewTransform {
  const current = touchGeometry(a, b)
  const zoom = Math.min(8, Math.max(0.5, anchor.view.zoom * current.distance / anchor.distance))
  const ratio = zoom / anchor.view.zoom
  return {
    zoom,
    panX: current.center.x - (anchor.center.x - anchor.view.panX) * ratio,
    panY: current.center.y - (anchor.center.y - anchor.view.panY) * ratio,
  }
}
