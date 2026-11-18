// Hands-free dictation control for the report editor (Sarvam speech-to-text through the server).
import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, HelpCircle } from 'lucide-react'
import { ShellButton } from '../shell/ShellButton'
import { toast } from '../shell/toastStore'
import { Dictation, dictationAvailable, type DictationEvent, type DictationState } from '../../lib/dictation'
import { REPORT_FIELD_KEYS, type ReportFieldKey } from '../../types'
import { useSectionEditors } from '../../lib/sectionEditors'
import { rememberClip, reportUndoneClip } from '../../lib/trainingCapture'
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
  const [level, setLevel] = useState(0)
  const [last, setLast] = useState('')
  const [help, setHelp] = useState(false)
  const [language, setLanguage] = useState(() => {
    try { return localStorage.getItem(LANGUAGE_KEY) || 'en-IN' } catch { return 'en-IN' }
  })
  const dictation = useRef<Dictation | null>(null)

  useEffect(() => { void dictationAvailable().then(setAvailable) }, [])
  useEffect(() => () => { void dictation.current?.stop(true) }, [])
  useEffect(() => { if (disabled) void dictation.current?.stop(true) }, [disabled])

  const target = (): ReportFieldKey => {
    const { active } = useSectionEditors.getState()
    return active ?? 'findings'
  }
  const focusSection = (key: ReportFieldKey) => {
    useSectionEditors.getState().setActive(key)
    useSectionEditors.getState().editors[key]?.focus()
  }

  const onEvent = (event: DictationEvent, clip: Blob) => {
    const editors = useSectionEditors.getState().editors
    if (event.kind === 'text') {
      const key = target()
      editors[key]?.insertText(event.text)
      rememberClip({ studyId, section: key, transcript: event.text, blob: clip, language })
      setLast(event.text)
      return
    }
    const { command } = event
    const index = REPORT_FIELD_KEYS.indexOf(target())
    switch (command.kind) {
      case 'stop':
        setLast('“stop dictation”')
        void dictation.current?.stop()
        dictation.current = null
        setOn(false)
        return
      case 'next':
        focusSection(REPORT_FIELD_KEYS[Math.min(REPORT_FIELD_KEYS.length - 1, index + 1)])
        break
      case 'previous':
        focusSection(REPORT_FIELD_KEYS[Math.max(0, index - 1)])
        break
      case 'goto':
        focusSection(command.section)
        break
      default:
        if (command.kind === 'undo') reportUndoneClip(useApp.getState().studies.find((s) => s.id === studyId))
        editors[target()]?.exec(command.kind)
    }
    setLast(`Command: ${command.kind === 'goto' ? `go to ${labels[command.section]}` : command.kind}`)
  }

  const toggle = async () => {
    if (dictation.current) {
      const current = dictation.current
      dictation.current = null
      setOn(false)
      await current.stop()
      return
    }
    if (!useSectionEditors.getState().active) focusSection('findings')
    const instance = new Dictation({
      language,
      onEvent,
      onLevel: setLevel,
      onState: (next, detail) => {
        setState(next)
        if (next === 'error' && detail) toast(detail, 'error')
        if (next === 'error' && dictation.current === instance && /Microphone/.test(detail ?? '')) { dictation.current = null; setOn(false) }
      },
    })
    dictation.current = instance
    setOn(true)
    await instance.start()
  }

  if (available === false) {
    return (
      <section className="rp-card dict-bar dict-off" aria-label="Dictation">
        <MicOff size={15} />
        <span>Dictation unavailable: the server needs a Sarvam API key, and this browser needs microphone support.</span>
      </section>
    )
  }

  return (
    <section className={`rp-card dict-bar${on ? ' dict-on' : ''}`} aria-label="Dictation">
      <ShellButton
        type="button"
        className={`btn ${on ? 'btn-destructive' : 'btn-primary'} btn-sm`}
        disabled={disabled || available === null}
        aria-pressed={on}
        onClick={() => void toggle()}
      >
        {on ? <MicOff size={14} /> : <Mic size={14} />} {on ? 'Stop dictation' : 'Hands-free dictation'}
      </ShellButton>
      <ShellButton type="button" className="icon-btn" aria-label="Voice commands" aria-expanded={help} onClick={() => setHelp((v) => !v)}>
        <HelpCircle size={15} />
      </ShellButton>
      <div className="dict-row">
      {on ? <span className="dict-meter" aria-hidden="true"><span style={{ transform: `scaleX(${level})` }} /></span> : null}
      <span className="dict-status" role="status" aria-live="polite">
        {on ? STATE_LABEL[state] : 'Speak to write into the selected section'}
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
      {last && on ? <div className="dict-last">Last: {last}</div> : null}
      {help ? (
        <div className="dict-help">
          <p>Speak naturally and pause; each phrase is typed into the highlighted section. Say a command on its own:</p>
          <ul>
            <li><b>“next section”</b> / <b>“previous section”</b></li>
            <li><b>“go to impression”</b> (or technique, comparison, findings, recommendations)</li>
            <li><b>“new line”</b>, <b>“bullet point”</b>, <b>“numbered list”</b></li>
            <li><b>“scratch that”</b> to undo the last insertion</li>
            <li><b>“stop dictation”</b> to turn the microphone off</li>
          </ul>
          <p>“Full stop”, “comma” and “colon” become punctuation. Audio is sent through this server to Sarvam AI for transcription. To improve recognition, VoxelRad keeps the audio and text of phrases that fail, are undone or are corrected, with patient identifiers removed. Signing always needs a click.</p>
        </div>
      ) : null}
    </section>
  )
}
