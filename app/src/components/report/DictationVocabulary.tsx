// Custom dictation word list: "heard -> write" replacements and recognition hints, kept in this browser.
import { useState } from 'react'
import { X } from 'lucide-react'
import { ShellButton } from '../shell/ShellButton'
import { upsertVocabulary, type VocabularyEntry } from '../../lib/dictationVocabulary'

export function DictationVocabulary({ entries, onChange }: { entries: VocabularyEntry[]; onChange: (next: VocabularyEntry[]) => void }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const add = () => {
    if (!to.trim()) return
    onChange(upsertVocabulary(entries, { from, to }))
    setFrom('')
    setTo('')
  }

  return (
    <div className="dict-vocab">
      <p>
        Words the recogniser gets wrong. Leave “Heard” empty to just teach a term (it is sent to the speech service as a hint).
        Common radiology mis-hearings such as “plural effusion” are already fixed. Stored in this browser only.
      </p>
      <form
        className="dict-vocab-add"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <input className="input" aria-label="Heard as" placeholder="Heard (optional)" value={from} maxLength={80} onChange={(e) => setFrom(e.target.value)} />
        <span aria-hidden="true">→</span>
        <input className="input" aria-label="Write as" placeholder="Write as" value={to} maxLength={80} onChange={(e) => setTo(e.target.value)} />
        <ShellButton type="submit" className="btn btn-sm" disabled={!to.trim()}>Add</ShellButton>
      </form>
      {entries.length ? (
        <ul className="dict-vocab-list">
          {entries.map((entry) => (
            <li key={`${entry.from}→${entry.to}`}>
              <span>{entry.from ? <>{entry.from} → <b>{entry.to}</b></> : <b>{entry.to}</b>}</span>
              <ShellButton
                type="button"
                className="icon-btn"
                aria-label={`Remove ${entry.to}`}
                onClick={() => onChange(entries.filter((e) => e !== entry))}
              >
                <X size={13} />
              </ShellButton>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
