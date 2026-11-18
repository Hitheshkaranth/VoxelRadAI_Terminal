// Rich-text editor for one report section. Stores sanitized HTML and keeps a plain-text copy in sync.
import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Bold, Heading, Italic, List, ListOrdered, RemoveFormatting, Underline } from 'lucide-react'
import { htmlToPlain, plainToHtml, sanitizeReportHtml } from '../../lib/richText'
import type { ReportFieldKey } from '../../types'
import { useSectionEditors, type SectionEditorHandle } from '../../lib/sectionEditors'

interface Props {
  sectionKey: ReportFieldKey
  label: string
  icon?: ReactNode
  emphasis?: boolean
  html?: string
  plain: string
  readOnly?: boolean
  placeholder?: string
  onChange: (html: string, plain: string) => void
}

const run = (command: string, value?: string) => document.execCommand(command, false, value)

export function RichSectionEditor({ sectionKey, label, icon, emphasis, html, plain, readOnly, placeholder, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const lastEmitted = useRef<string | null>(null)
  const lastInserted = useRef('')
  const labelId = useId()
  const active = useSectionEditors((s) => s.active === sectionKey)
  const value = html ?? plainToHtml(plain)

  // Only rewrite the DOM when the value changed from outside (new draft, undo, another tab), so the caret stays put.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || value === lastEmitted.current) return
    el.innerHTML = plain.trim() || html ? value : ''
    lastEmitted.current = value
  }, [value, plain, html])

  const emit = () => {
    const el = ref.current
    if (!el) return
    const clean = sanitizeReportHtml(el.innerHTML)
    lastEmitted.current = clean
    onChange(clean, htmlToPlain(clean))
  }

  useEffect(() => {
    const placeCaretAtEndIfOutside = (force = false) => {
      const el = ref.current
      if (!el) return
      // Check before focusing: focus() itself puts the caret at the start of the editor.
      const before = window.getSelection()
      const inside = !!before?.anchorNode && el.contains(before.anchorNode)
      el.focus({ preventScroll: true })
      const selection = window.getSelection()
      if (selection && (force || !inside)) {
        const range = document.createRange()
        range.selectNodeContents(el)
        range.collapse(false)
        selection.removeAllRanges()
        selection.addRange(range)
      }
    }
    const handle: SectionEditorHandle = {
      focus: () => {
        // Moving to a section by voice continues at its end.
        placeCaretAtEndIfOutside(true)
        ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      },
      insertText: (text) => {
        if (readOnly) return
        placeCaretAtEndIfOutside()
        // Text before the caret, measured with a range so it works when the caret sits between elements.
        const selection = window.getSelection()
        let before = ''
        if (selection?.rangeCount && ref.current) {
          const range = document.createRange()
          range.selectNodeContents(ref.current)
          range.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset)
          before = range.toString()
        }
        const spaced = before && !/\s$/.test(before) && !/^[.,:;]/.test(text) ? ` ${text}` : text
        run('insertText', spaced)
        lastInserted.current = spaced
        emit()
      },
      exec: (command) => {
        if (readOnly) return
        placeCaretAtEndIfOutside()
        if (command === 'newline') run('insertParagraph')
        if (command === 'undo') {
          // Remove exactly the last dictated phrase. The browser's own undo can merge several phrases.
          const inserted = lastInserted.current
          const selection = window.getSelection()
          lastInserted.current = ''
          if (!inserted || !selection) return
          for (let i = 0; i < inserted.length; i++) selection.modify('extend', 'backward', 'character')
          if (selection.toString().replace(/\s+/g, ' ') === inserted.replace(/\s+/g, ' ')) run('delete')
          else selection.collapseToEnd()
        }
        if (command === 'bullet') run('insertUnorderedList')
        if (command === 'numbered') run('insertOrderedList')
        emit()
      },
    }
    useSectionEditors.getState().register(sectionKey, handle)
    return () => useSectionEditors.getState().register(sectionKey, null)
  }, [sectionKey, readOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  const tool = (title: string, icon: ReactNode, action: () => void) => (
    <button
      type="button"
      className="rte-tool"
      title={title}
      aria-label={title}
      // Keep the selection inside the editor while clicking the toolbar.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        action()
        emit()
      }}
    >
      {icon}
    </button>
  )

  return (
    <section
      id={`report-${sectionKey}`}
      className={`rp-sec rte${readOnly ? ' rp-sec-ro' : ''}${emphasis ? ' rp-sec-em' : ''}${active && !readOnly ? ' rte-active' : ''}`}
    >
      <div className="rp-sec-head">
        {icon}
        <span id={labelId}>{label}</span>
      </div>
      {!readOnly && active ? (
        <div className="rte-toolbar" role="toolbar" aria-label={`${label} formatting`}>
          {tool('Bold (⌘B)', <Bold size={14} />, () => run('bold'))}
          {tool('Italic (⌘I)', <Italic size={14} />, () => run('italic'))}
          {tool('Underline (⌘U)', <Underline size={14} />, () => run('underline'))}
          {tool('Subheading', <Heading size={14} />, () => run('formatBlock', '<h4>'))}
          {tool('Bulleted list', <List size={14} />, () => run('insertUnorderedList'))}
          {tool('Numbered list', <ListOrdered size={14} />, () => run('insertOrderedList'))}
          {tool('Clear formatting', <RemoveFormatting size={14} />, () => { run('removeFormat'); run('formatBlock', '<p>') })}
        </div>
      ) : null}
      <div
        ref={ref}
        className="rp-sec-text rte-body"
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelId}
        aria-readonly={readOnly || undefined}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        spellCheck
        onFocus={() => useSectionEditors.getState().setActive(sectionKey)}
        onInput={emit}
        onPaste={(event) => {
          // Paste as sanitized formatting only (no styles, links or images from other apps).
          event.preventDefault()
          const pastedHtml = event.clipboardData.getData('text/html')
          const pastedText = event.clipboardData.getData('text/plain')
          run('insertHTML', pastedHtml ? sanitizeReportHtml(pastedHtml) : plainToHtml(pastedText))
          emit()
        }}
      />
    </section>
  )
}
