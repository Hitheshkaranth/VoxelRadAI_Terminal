// Rich-text editor for one report section. Stores sanitized HTML and keeps a plain-text copy in sync.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Bold, Heading, Italic, List, ListOrdered, RemoveFormatting, Underline } from 'lucide-react'
import { htmlToPlain, plainToHtml, sanitizeReportHtml } from '../../lib/richText'
import type { ReportFieldKey } from '../../types'
import { useSectionEditors, type SectionEditorHandle } from '../../lib/sectionEditors'
import { domFields, fieldRange, highlightFields, moveToField, selectionOffsets, type DomField } from '../../lib/fieldDom'
import { expandMacro, macroShortcut } from '../../lib/macros'
import { allMacros, ensureExamLibrary } from '../../lib/examLibrary'
import { capitaliseWords } from '../../lib/dictation'
import { deleteLastSentence, replaceLastInserted } from './dictationEditing'

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
  // Picklist field currently selected: its options show as buttons and number keys 1–9 pick one.
  const choiceField = useRef<DomField | null>(null)
  const [choices, setChoices] = useState<string[] | null>(null)

  const showChoices = (field: DomField | null) => {
    choiceField.current = field?.kind === 'choice' ? field : null
    setChoices(field?.kind === 'choice' ? field.options : null)
  }
  const goToField = (direction: 1 | -1, within?: { start: number; end: number }) => {
    const el = ref.current
    if (!el) return null
    const field = moveToField(el, direction, within)
    showChoices(field)
    return field
  }
  // Insert text at the caret, then select the first field it brought in so Tab-filling can start right away.
  const insertWithFields = (text: string) => {
    const el = ref.current
    if (!el) return
    const start = selectionOffsets(el)?.start ?? 0
    run('insertText', text)
    const end = selectionOffsets(el)?.end ?? start
    emit()
    goToField(1, { start, end })
  }
  const expandShortcut = (): boolean => {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    if (!selection?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || !ref.current?.contains(node)) return false
    const shortcut = macroShortcut((node.textContent ?? '').slice(0, selection.anchorOffset))
    const text = shortcut ? expandMacro(shortcut.name, allMacros()) : null
    if (!shortcut || text == null) return false
    selection.setBaseAndExtent(node, selection.anchorOffset - shortcut.length, node, selection.anchorOffset)
    insertWithFields(text)
    return true
  }
  const pickChoice = (option: string) => {
    const field = choiceField.current
    showChoices(null)
    // Only replace the field if it is still there unchanged.
    if (!field || !field.node.isConnected || field.node.data.slice(field.localStart, field.localEnd) !== `[${field.label}]`) return
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(fieldRange(field))
    run('insertText', option)
    emit()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (readOnly || event.nativeEvent.isComposing) return
    if ((event.key === ' ' || event.key === 'Tab') && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && expandShortcut()) {
      event.preventDefault()
      return
    }
    if (event.key === 'Tab' || event.key === 'F2') {
      // Tab leaves the editor as usual when the section has no fields.
      if (event.key === 'Tab' && !(ref.current && domFields(ref.current).length)) return
      event.preventDefault()
      goToField(event.shiftKey ? -1 : 1)
      return
    }
    const n = Number(event.key)
    if (choices && n >= 1 && n <= choices.length && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const field = choiceField.current
      const sel = ref.current ? selectionOffsets(ref.current) : null
      if (field && sel && sel.start === field.start && sel.end === field.end) {
        event.preventDefault()
        pickChoice(choices[n - 1])
        return
      }
    }
    if (choices && !['Shift', 'Meta', 'Control', 'Alt'].includes(event.key)) showChoices(null)
  }

  // Only rewrite the DOM when the value changed from outside (new draft, undo, another tab), so the caret stays put.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || value === lastEmitted.current) return
    el.innerHTML = plain.trim() || html ? value : ''
    lastEmitted.current = value
    highlightFields(sectionKey, el)
  }, [value, plain, html, sectionKey])
  useEffect(() => () => highlightFields(sectionKey, null), [sectionKey])

  const emit = () => {
    const el = ref.current
    if (!el) return
    const clean = sanitizeReportHtml(el.innerHTML)
    lastEmitted.current = clean
    onChange(clean, htmlToPlain(clean))
    highlightFields(sectionKey, el)
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
      nextField: (direction = 1) => {
        if (!ref.current) return false
        const outside = !ref.current.contains(window.getSelection()?.anchorNode ?? null)
        if (outside) ref.current.focus({ preventScroll: true })
        return !!goToField(direction)
      },
      insertMacro: (name) => {
        ensureExamLibrary()
        const text = expandMacro(name, allMacros())
        if (readOnly || text == null) return false
        placeCaretAtEndIfOutside()
        const selection = window.getSelection()
        let before = ''
        if (selection?.rangeCount && ref.current) {
          const range = document.createRange()
          range.selectNodeContents(ref.current)
          range.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset)
          before = range.toString()
        }
        const spaced = before && !/\s$/.test(before) ? ` ${text}` : text
        insertWithFields(spaced)
        lastInserted.current = spaced
        return true
      },
      prevField: () => {
        if (!ref.current) return false
        if (!ref.current.contains(window.getSelection()?.anchorNode ?? null)) ref.current.focus({ preventScroll: true })
        return !!goToField(-1)
      },
      deleteLastSentence: () => {
        if (readOnly || !ref.current) return
        placeCaretAtEndIfOutside()
        lastInserted.current = ''
        if (deleteLastSentence(ref.current)) emit()
      },
      capitaliseLast: () => {
        if (readOnly) return
        placeCaretAtEndIfOutside()
        const next = capitaliseWords(lastInserted.current)
        if (replaceLastInserted(lastInserted.current, next)) { lastInserted.current = next; emit() }
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
      {!readOnly && active && choices ? (
        <div className="rte-choices" role="group" aria-label="Choose a value for this field">
          {choices.map((option, i) => (
            <button key={option + i} type="button" className="rte-choice" onMouseDown={(event) => event.preventDefault()} onClick={() => pickChoice(option)}>
              {i < 9 ? <kbd>{i + 1}</kbd> : null}{option}
            </button>
          ))}
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
        onFocus={() => { ensureExamLibrary(); useSectionEditors.getState().setActive(sectionKey) }}
        onInput={emit}
        onKeyDown={onKeyDown}
        onBlur={() => showChoices(null)}
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
