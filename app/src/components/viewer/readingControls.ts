/** Shortcuts must never consume text editing, select controls, or modified browser commands. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="dialog"]')
}
export const READING_SHORTCUTS = [
  ['Space', 'Play / pause slices'], ['F', 'Fit full image'], ['P / W', 'Pan / window tool'],
  ['M', 'Single / three-plane layout'], ['H', 'Toggle overlays'], ['Hold Alt', 'Temporarily hide overlays'],
  ['1–9', 'Display window presets'], ['L / E', 'Length / ellipse ROI tool'], ['Esc', 'Stop measuring'],
  ['J / K', 'Next / previous pending finding'], ['A / R', 'Accept / reject selected finding'], ['N / Shift+N', 'Next / previous study in worklist'], ['?', 'Show shortcuts'],
]
