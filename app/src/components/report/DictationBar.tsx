// Dictation control for the report editor (Sarvam speech-to-text through the server): hands-free or push-to-talk.
import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, HelpCircle, BookText, Undo2, X } from 'lucide-react'
import { ShellButton } from '../shell/ShellButton'
import { toast } from '../shell/toastStore'
import { Dictation, dictationAvailable, type DictationEvent, type DictationState } from '../../lib/dictation'
import { applyVocabulary, loadVocabulary, saveVocabulary, suggestReplacement, upsertVocabulary, vocabularyKeyterms, type VocabularyEntry } from '../../lib/dictationVocabulary'
import {
  MODE_LABEL, describeHotkey, hotkeyAllowed, hotkeyId, hotkeyMatches, loadDictationMode, loadHotkey, saveDictationMode, saveHotkey,
  type DictationMode,
} from '../../lib/dictationHotkey'
import { REPORT_FIELD_KEYS, type ReportFieldKey } from '../../types'
import { useSectionEditors } from '../../lib/sectionEditors'
import { rememberClip, reportUndoneClip } from '../../lib/trainingCapture'
import { DictationVocabulary } from './DictationVocabulary'
import { useApp } from '../../store'

const LANGUAGES = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'unknown', label: 'Auto-detect' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'kn-IN', label: 'Kannada' },
  { code: 'ta-IN', label: 'Tamil' },
  { code: 'te-IN', label: 'Telugu' },
  { code: 'ml-IN', label: 'Malayalam' },
  { code: 'mr-IN', label: 'Marathi' },
  { code: 'bn-IN', label: 'Bengali' },
]
const LANGUAGE_KEY = 'voxelrad.dictationLanguage'
const CHIP_MS = 8000
// A phrase dictated this soon after an undo is treated as the correction of the undone one.
const CORRECTION_WINDOW_MS = 30000

const STATE_LABEL: Record<DictationState, string> = {
  idle: 'Dictation off',
  starting: 'Starting microphone…',
  listening: 'Listening — speak, then pause',
  hearing: 'Hearing you…',
  transcribing: 'Transcribing…',
  error: 'Dictation error',
}

export function DictationBar({ disabled, labels, studyId }: { disabled: boolean; labels: Record<ReportFieldKey, string>; studyId: string }) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [state, setState] = useState<DictationState>('idle')
  const [on, setOn] = useState(false)
  const [holding, setHolding] = useState(false)
  const [level, setLevel] = useState(0)
  const [last, setLast] = useState('')
  const [chip, setChip] = useState<{ text: string; id: number } | null>(null)
  const [panel, setPanel] = useState<'help' | 'vocab' | null>(null)
  const [mode, setMode] = useState<DictationMode>(loadDictationMode)
  const [hotkey, setHotkey] = useState(loadHotkey)
  const [capturing, setCapturing] = useState(false)
  const [vocab, setVocab] = useState<VocabularyEntry[]>(loadVocabulary)
  const [suggestion, setSuggestion] = useState<VocabularyEntry | null>(null)
  const [language, setLanguage] = useState(() => {
    try { return localStorage.getItem(LANGUAGE_KEY) || 'en-IN' } catch { return 'en-IN' }
  })
  const dictation = useRef<Dictation | null>(null)
  const vocabRef = useRef(vocab)
  const undone = useRef<{ text: string; at: number } | null>(null)
  const lastText = useRef('')

  useEffect(() => { void dictationAvailable().then(setAvailable) }, [])
  useEffect(() => () => { void dictation.current?.stop(true) }, [])
  useEffect(() => { if (disabled) void dictation.current?.stop(true) }, [disabled])
  useEffect(() => {
    if (!chip) return
    const timer = window.setTimeout(() => setChip(null), CHIP_MS)
    return () => window.clearTimeout(timer)
  }, [chip])

  const target = (): ReportFieldKey => {
    const { active } = useSectionEditors.getState()
    return active ?? 'findings'
  }
  const focusSection = (key: ReportFieldKey) => {
    useSectionEditors.getState().setActive(key)
    useSectionEditors.getState().editors[key]?.focus()
  }
  const moveSection = (step: number) => {
    const index = REPORT_FIELD_KEYS.indexOf(target())
    focusSection(REPORT_FIELD_KEYS[Math.min(REPORT_FIELD_KEYS.length - 1, Math.max(0, index + step))])
  }

  const updateVocab = (next: VocabularyEntry[]) => {
    setVocab(next)
    saveVocabulary(next)
  }

  const undoLast = () => {
    useSectionEditors.getState().editors[target()]?.exec('undo')
    reportUndoneClip(useApp.getState().studies.find((s) => s.id === studyId))
    if (lastText.current) undone.current = { text: lastText.current, at: Date.now() }
    lastText.current = ''
    setChip(null)
  }

  const turnOff = (discard = false) => {
    const current = dictation.current
    dictation.current = null
    setOn(false)
    setHolding(false)
    void current?.stop(discard)
  }

  const onEvent = (event: DictationEvent, clip: Blob) => {
    const editor = useSectionEditors.getState().editors[target()]
    if (event.kind === 'text') {
      const key = target()
      editor?.insertText(event.text)
      rememberClip({ studyId, section: key, transcript: event.text, blob: clip, language })
      // Re-dictating right after an undo: offer the difference as a vocabulary fix (never applied without a click).
      const previous = undone.current
      undone.current = null
      if (previous && Date.now() - previous.at < CORRECTION_WINDOW_MS) {
        const found = suggestReplacement(previous.text, event.text)
        if (found && !vocabRef.current.some((e) => e.from.toLowerCase() === found.from)) setSuggestion(found)
      }
      lastText.current = event.text
      setLast(event.text)
      setChip({ text: event.text, id: Date.now() })
      return
    }
    const { command } = event
    let label: string = command.kind
    switch (command.kind) {
      case 'stop':
        setLast('“stop dictation”')
        turnOff()
        return
      case 'next':
        moveSection(1)
        break
      case 'previous':
        moveSection(-1)
        break
      case 'goto':
        focusSection(command.section)
        label = `go to ${labels[command.section]}`
        break
      case 'nextField':
      case 'prevField': {
        const step = command.kind === 'nextField' ? editor?.nextField : editor?.prevField
        // Sections without template fields: move between sections instead.
        if (!step || step() === false) moveSection(command.kind === 'nextField' ? 1 : -1)
        else label = command.kind === 'nextField' ? 'next field' : 'previous field'
        break
      }
      case 'macro':
        if (!editor?.insertMacro) toast('Macros are not available in this section.', 'info')
        else if (editor.insertMacro(command.name) === false) toast(`No macro called “${command.name}”.`, 'info')
        label = `macro ${command.name}`
        break
      case 'deleteSentence':
        editor?.deleteLastSentence?.()
        lastText.current = ''
        label = 'delete last sentence'
        break
      case 'capitalise':
        editor?.capitaliseLast?.()
        label = 'capitalise'
        break
      case 'undo':
        undoLast()
        break
      default:
        editor?.exec(command.kind)
    }
    setLast(`Command: ${label}`)
  }
  const eventRef = useRef(onEvent)

  const begin = (manual: boolean) => {
    if (!useSectionEditors.getState().active) focusSection('findings')
    const instance = new Dictation({
      language,
      mode: manual ? 'manual' : 'auto',
      keyterms: vocabularyKeyterms(vocabRef.current),
      correct: (text) => applyVocabulary(text, vocabRef.current),
      onEvent: (event, clip) => eventRef.current(event, clip),
      onLevel: setLevel,
      onState: (next, detail) => {
        setState(next)
        if (next === 'error' && detail) toast(detail, 'error')
        if (next === 'error' && dictation.current === instance && /Microphone/.test(detail ?? '')) { dictation.current = null; setOn(false); setHolding(false) }
      },
    })
    dictation.current = instance
    setOn(true)
    void instance.start()
    return instance
  }

  const toggle = () => {
    if (dictation.current) turnOff()
    else begin(mode !== 'handsfree')
  }

  // Push-to-talk: press opens the microphone if needed and records until release (or the next press in toggle mode).
  const press = () => {
    const instance = dictation.current ?? begin(true)
    if (mode === 'toggle' && instance.holding) instance.release()
    else instance.hold()
    setHolding(instance.holding)
  }
  const releaseHold = () => {
    if (!dictation.current?.holding) return
    dictation.current.release()
    setHolding(false)
  }

  const keyState = useRef({ mode, hotkey, capturing, disabled, available, press, releaseHold, toggle })
  // Long-lived listeners and the running Dictation read the latest values through these refs.
  useEffect(() => {
    vocabRef.current = vocab
    eventRef.current = onEvent
    keyState.current = { mode, hotkey, capturing, disabled, available, press, releaseHold, toggle }
  })
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const k = keyState.current
      if (k.capturing) {
        event.preventDefault()
        const id = hotkeyId(event)
        if (id === 'Escape') { setCapturing(false); return }
        if (!hotkeyAllowed(id)) { toast('Pick a function key, numpad key or a dictation-microphone button; typing keys would fire while you type.', 'info'); return }
        setHotkey(id)
        saveHotkey(id)
        setCapturing(false)
        return
      }
      if (k.disabled || k.available !== true || !hotkeyMatches(event, k.hotkey)) return
      event.preventDefault()
      if (event.repeat) return
      if (k.mode === 'handsfree') k.toggle()
      else k.press()
    }
    const up = (event: KeyboardEvent) => {
      const k = keyState.current
      if (k.mode === 'hold' && hotkeyMatches(event, k.hotkey)) { event.preventDefault(); k.releaseHold() }
    }
    // Losing focus while holding would miss the key-up and leave the microphone recording.
    const blur = () => { if (keyState.current.mode === 'hold') keyState.current.releaseHold() }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
    }
  }, [])

  if (available === false) {
    return (
      <section className="rp-card dict-bar dict-off" aria-label="Dictation">
        <MicOff size={15} />
        <span>Dictation unavailable: the server needs a Sarvam API key, and this browser needs microphone support.</span>
      </section>
    )
  }

  const key = describeHotkey(hotkey)
  const ptt = mode !== 'handsfree'
  const status = !on
    ? ptt ? `${mode === 'hold' ? 'Hold' : 'Press'} ${key} to dictate into the selected section` : `Speak to write into the selected section · ${key} starts`
    : ptt && state === 'listening' ? `${mode === 'hold' ? 'Hold' : 'Press'} ${key} to talk` : STATE_LABEL[state]

  return (
    <section className={`rp-card dict-bar${on ? ' dict-on' : ''}${holding ? ' dict-holding' : ''}`} aria-label="Dictation">
      <div className="dict-actions">
        <ShellButton
          type="button"
          className={`btn ${on ? 'btn-destructive' : 'btn-primary'} btn-sm`}
          disabled={disabled || available === null}
          aria-pressed={on}
          onClick={toggle}
        >
          {on ? <MicOff size={14} /> : <Mic size={14} />} {on ? (ptt ? 'Microphone off' : 'Stop dictation') : ptt ? 'Microphone on' : 'Hands-free dictation'}
        </ShellButton>
        {ptt ? (
          <ShellButton
            type="button"
            className={`btn btn-sm${holding ? ' btn-primary' : ''}`}
            disabled={disabled || available === null}
            aria-pressed={holding}
            onPointerDown={(event) => { event.preventDefault(); press() }}
            onPointerUp={() => { if (mode === 'hold') releaseHold() }}
            onPointerLeave={() => { if (mode === 'hold') releaseHold() }}
            onKeyDown={(event) => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); press() } }}
            onKeyUp={(event) => { if ((event.key === ' ' || event.key === 'Enter') && mode === 'hold') releaseHold() }}
          >
            <Mic size={14} /> {mode === 'hold' ? 'Hold to talk' : holding ? 'Stop talking' : 'Talk'}
          </ShellButton>
        ) : null}
      </div>
      <div className="dict-tools">
        <ShellButton type="button" className="icon-btn" aria-label="Custom vocabulary" aria-expanded={panel === 'vocab'} onClick={() => setPanel((p) => (p === 'vocab' ? null : 'vocab'))}>
          <BookText size={15} />
        </ShellButton>
        <ShellButton type="button" className="icon-btn" aria-label="Voice commands and settings" aria-expanded={panel === 'help'} onClick={() => setPanel((p) => (p === 'help' ? null : 'help'))}>
          <HelpCircle size={15} />
        </ShellButton>
      </div>
      <div className="dict-row">
      {on ? <span className="dict-meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}><span style={{ transform: `scaleX(${level})` }} /></span> : null}
      <span className="dict-status" role="status" aria-live="polite">
        {status}
        {on ? <> · into <strong>{labels[target()]}</strong></> : null}
      </span>
      <select
        className="input dict-lang"
        aria-label="Dictation language"
        value={language}
        disabled={on}
        onChange={(event) => {
          setLanguage(event.target.value)
          try { localStorage.setItem(LANGUAGE_KEY, event.target.value) } catch { /* optional preference */ }
        }}
      >
        {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
      </div>
      {chip ? (
        <div className="dict-chip" key={chip.id}>
          <span className="dict-chip-text" title={chip.text}>“{chip.text}”</span>
          <ShellButton type="button" className="btn btn-sm" onClick={undoLast}><Undo2 size={13} /> Undo</ShellButton>
        </div>
      ) : last && on ? <div className="dict-last">Last: {last}</div> : null}
      {suggestion ? (
        <div className="dict-suggest" role="status">
          <span>Always write “<b>{suggestion.to}</b>” when I hear “{suggestion.from}”?</span>
          <ShellButton type="button" className="btn btn-sm btn-primary" onClick={() => { updateVocab(upsertVocabulary(vocab, suggestion)); setSuggestion(null) }}>Add</ShellButton>
          <ShellButton type="button" className="icon-btn" aria-label="Dismiss suggestion" onClick={() => setSuggestion(null)}><X size={13} /></ShellButton>
        </div>
      ) : null}
      {panel === 'vocab' ? <DictationVocabulary entries={vocab} onChange={updateVocab} /> : null}
      {panel === 'help' ? (
        <div className="dict-help">
          <div className="dict-settings">
            <label>
              Mode{' '}
              <select
                className="input dict-lang"
                value={mode}
                disabled={on}
                onChange={(event) => {
                  const next = event.target.value as DictationMode
                  setMode(next)
                  saveDictationMode(next)
                }}
              >
                {(Object.keys(MODE_LABEL) as DictationMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </select>
            </label>
            <span>
              Key <kbd>{key}</kbd>{' '}
              <ShellButton type="button" className="btn btn-sm" aria-pressed={capturing} onClick={() => setCapturing((v) => !v)}>
                {capturing ? 'Press a key… (Esc cancels)' : 'Change'}
              </ShellButton>
            </span>
          </div>
          <p>
            Hands-free: speak and pause; each phrase is typed into the highlighted section, and {key} turns the microphone on or off.
            Push-to-talk: hold {key} (or press it once to start and again to stop) while speaking.
            Dictation microphones with a record button work if the button is set to send a key such as F4 (best effort: browsers only see buttons that arrive as key presses).
          </p>
          <p>Say a command on its own:</p>
          <ul>
            <li><b>“next section”</b> / <b>“previous section”</b>, <b>“go to impression”</b> (or technique, comparison, findings, recommendations)</li>
            <li><b>“next field”</b> / <b>“previous field”</b> to jump between template blanks</li>
            <li><b>“insert macro</b> <i>name</i><b>”</b> to insert a saved phrase</li>
            <li><b>“new line”</b>, <b>“new paragraph”</b>, <b>“bullet point”</b>, <b>“numbered list”</b></li>
            <li><b>“scratch that”</b> to undo the last phrase, <b>“delete last sentence”</b>, <b>“capitalise that”</b></li>
            <li><b>“stop dictation”</b> to turn the microphone off</li>
          </ul>
          <p>
            Punctuation words become marks: full stop, period, comma, colon, semicolon, question mark, open/close bracket, hyphen, slash.
            Measurements are written as numbers: “one point two by zero point eight centimetres” → 1.2 x 0.8 cm. Check every transcribed value before signing.
          </p>
          <p>Audio is sent through this server to Sarvam AI for transcription. To improve recognition, VoxelRad keeps the audio and text of phrases that fail, are undone or are corrected, with patient identifiers removed. Signing always needs a click.</p>
        </div>
      ) : null}
    </section>
  )
}
