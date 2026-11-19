// Template fields inside a contenteditable report section: find, select and highlight them without
// changing the DOM (highlights use the CSS Custom Highlight API, so stored HTML stays clean).
import { listFields, pickField, type FieldRange } from './examTemplates'

export interface DomField extends FieldRange {
  node: Text
  /** Offsets within the node; start/end are offsets in the editor's whole text. */
  localStart: number
  localEnd: number
}

/** Fields are matched per text node, so a field split by formatting is not treated as one. */
export function domFields(root: HTMLElement): DomField[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const out: DomField[] = []
  let base = 0
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    for (const f of listFields(node.data)) out.push({ ...f, node, localStart: f.start, localEnd: f.end, start: base + f.start, end: base + f.end })
    base += node.data.length
  }
  return out
}

/** Offset of a DOM position in the editor's text (same counting as domFields). */
export function textOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(root)
  range.setEnd(node, offset)
  return range.toString().length
}

export function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null
  return { start: textOffset(root, range.startContainer, range.startOffset), end: textOffset(root, range.endContainer, range.endOffset) }
}

export function fieldRange(field: DomField): Range {
  const range = document.createRange()
  range.setStart(field.node, field.localStart)
  range.setEnd(field.node, field.localEnd)
  return range
}

export function selectField(field: DomField) {
  const selection = window.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(fieldRange(field))
  field.node.parentElement?.scrollIntoView({ block: 'nearest' })
}

/** Select the next/previous field from the caret; with `within`, only fields inside that text span. */
export function moveToField(root: HTMLElement, direction: 1 | -1, within?: { start: number; end: number }): DomField | null {
  let fields = domFields(root)
  if (within) fields = fields.filter((f) => f.start >= within.start && f.end <= within.end)
  const sel = selectionOffsets(root) ?? { start: 0, end: 0 }
  const field = within ? fields[0] ?? null : pickField(fields, sel.start, sel.end, direction)
  if (field) selectField(field)
  return field
}

// One shared highlight; each editor replaces its own ranges.
const ranges = new Map<string, Range[]>()
export function highlightFields(key: string, root: HTMLElement | null) {
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return
  if (root) ranges.set(key, domFields(root).map(fieldRange))
  else ranges.delete(key)
  CSS.highlights.set('report-field', new Highlight(...[...ranges.values()].flat()))
}
