/** Shortcuts must never consume text editing, select controls, or modified browser commands. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="dialog"]')
}
export const READING_SHORTCUTS = [
  ['↑ / ↓', 'Previous / next slice (Shift: 5)'], ['PgUp / PgDn', 'Back / forward a tenth of the stack'], ['Home / End', 'First / last slice'],
  ['Space', 'Play / pause slices'], ['F', 'Fit full image'], ['P / W', 'Pan / window tool'],
  ['M', 'Single / three-plane layout'], ['H', 'Toggle overlays'], ['Hold Alt', 'Temporarily hide overlays'],
  ['1–9', 'Display window presets'], ['L / E', 'Length / ellipse ROI tool'], ['Esc', 'Stop measuring'],
  ['J / K', 'Next / previous pending finding'], ['A / R', 'Accept / reject selected finding'], ['N / Shift+N', 'Next / previous study in worklist'], ['?', 'Show shortcuts'],
]

/** Widgets that use arrow keys themselves (tabs, menus, radio groups, sliders); slice keys leave them alone. */
export function ownsArrowKeys(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('[role="tablist"], [role="radiogroup"], [role="menu"], [role="menubar"], [role="listbox"], [role="slider"], [role="grid"], [role="tree"]')
}

/** Keys that move through a slice stack. Hold to scroll; Shift steps 5; Page keys jump a tenth of the stack. */
export function sliceKeyTarget(key: string, index: number, count: number, shift = false): number | null {
  const last = Math.max(0, count - 1)
  const page = Math.max(1, Math.round(count / 10))
  const step = shift ? 5 : 1
  let next: number
  switch (key) {
    case 'ArrowDown': case 'ArrowRight': next = index + step; break
    case 'ArrowUp': case 'ArrowLeft': next = index - step; break
    case 'PageDown': next = index + page; break
    case 'PageUp': next = index - page; break
    case 'Home': next = 0; break
    case 'End': next = last; break
    default: return null
  }
  return Math.min(last, Math.max(0, next))
}
