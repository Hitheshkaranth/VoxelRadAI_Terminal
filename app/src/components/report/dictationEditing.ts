// Caret-level edits for voice commands in a contenteditable report section ("delete last sentence", "capitalise that").
import { lastSentenceStart } from '../../lib/dictation'

const run = (command: string, value?: string) => document.execCommand(command, false, value)

/** The paragraph or list item holding the caret, so a sentence edit never reaches into the previous block. */
function caretBlock(root: HTMLElement, node: Node): Node {
  let current: Node | null = node
  while (current && current !== root) {
    if (current instanceof HTMLElement && /^(P|LI|DIV|H\d|BLOCKQUOTE)$/.test(current.tagName)) return current
    current = current.parentNode
  }
  return root
}

/** Delete from the start of the last sentence before the caret. Returns false when there was nothing to delete. */
export function deleteLastSentence(root: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return false
  const caret = selection.getRangeAt(0)
  const range = document.createRange()
  range.selectNodeContents(caretBlock(root, caret.startContainer))
  range.setEnd(caret.startContainer, caret.startOffset)
  const before = range.toString()
  const count = before.length - lastSentenceStart(before)
  if (!count || !before.trim()) return false
  for (let i = 0; i < count; i++) selection.modify('extend', 'backward', 'character')
  // Only delete if the selection is exactly the sentence we measured (inline markup can shift characters).
  if (selection.toString().replace(/\s+/g, ' ') !== before.slice(before.length - count).replace(/\s+/g, ' ')) {
    selection.collapseToEnd()
    return false
  }
  run('delete')
  return true
}

/** Replace the phrase just before the caret, if it is still `inserted`. Returns false when it was edited since. */
export function replaceLastInserted(inserted: string, replacement: string): boolean {
  const selection = window.getSelection()
  if (!inserted || !selection) return false
  for (let i = 0; i < inserted.length; i++) selection.modify('extend', 'backward', 'character')
  if (selection.toString().replace(/\s+/g, ' ') !== inserted.replace(/\s+/g, ' ')) {
    selection.collapseToEnd()
    return false
  }
  run('insertText', replacement)
  return true
}
