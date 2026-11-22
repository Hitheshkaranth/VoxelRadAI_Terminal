import assert from 'node:assert/strict'
import { capitaliseWords, formatDictatedText, lastSentenceStart, parseUtterance, parseUtterances } from '../src/lib/dictation.ts'

const cmd = (said: string) => { const e = parseUtterance(said); return e?.kind === 'command' ? e.command : null }
assert.deepEqual(cmd('Next section.'), { kind: 'next' })
assert.deepEqual(cmd('previous section'), { kind: 'previous' })
assert.deepEqual(cmd('Go to impression.'), { kind: 'goto', section: 'impression' })
assert.deepEqual(cmd('findings section'), { kind: 'goto', section: 'findings' })
assert.deepEqual(cmd('Open recommendations'), { kind: 'goto', section: 'recommendations' })
assert.deepEqual(cmd('New line'), { kind: 'newline' })
assert.deepEqual(cmd('Scratch that.'), { kind: 'undo' })
assert.deepEqual(cmd('Stop dictation.'), { kind: 'stop' })
assert.deepEqual(cmd('bullet point'), { kind: 'bullet' })
// Words that only mention a section inside a sentence stay report text.
assert.deepEqual(parseUtterance('Impression is unchanged from prior'), { kind: 'text', text: 'Impression is unchanged from prior' })
assert.deepEqual(parseUtterance('findings'), { kind: 'text', text: 'findings' })
assert.deepEqual(parseUtterance('No pleural effusion full stop heart size normal comma lungs clear'), { kind: 'text', text: 'No pleural effusion. heart size normal, lungs clear' })
assert.equal(parseUtterance('   '), null)

// New voice commands
assert.deepEqual(cmd('Next field.'), { kind: 'nextField' })
assert.deepEqual(cmd('previous field'), { kind: 'prevField' })
assert.deepEqual(cmd('Insert macro normal chest.'), { kind: 'macro', name: 'normal chest' })
assert.deepEqual(cmd('macro post op'), { kind: 'macro', name: 'post op' })
assert.deepEqual(cmd('Delete last sentence.'), { kind: 'deleteSentence' })
assert.deepEqual(cmd('Capitalize that'), { kind: 'capitalise' })
assert.deepEqual(cmd('capitalise that.'), { kind: 'capitalise' })
assert.deepEqual(cmd('New paragraph'), { kind: 'newline' })
// Punctuation words
const text = (said: string) => { const e = parseUtterance(said); return e?.kind === 'text' ? e.text : null }
assert.equal(text('Is there an effusion question mark'), 'Is there an effusion?')
assert.equal(text('lungs clear period heart normal period'), 'lungs clear. heart normal.')
assert.equal(text('Last menstrual period was unknown'), 'Last menstrual period was unknown')
assert.equal(text('a period of observation'), 'a period of observation')
assert.equal(text('mass open bracket axial close bracket semicolon'), 'mass (axial);')
assert.equal(text('well hyphen defined T2 slash FLAIR'), 'well-defined T2/FLAIR')
assert.equal(text('No effusion comma.'), 'No effusion,')
assert.equal(formatDictatedText('Lesion 1.2 cm.'), 'Lesion 1.2 cm.')
// Inline "new paragraph" splits the utterance
assert.deepEqual(parseUtterances('No effusion full stop new paragraph heart normal'), [
  { kind: 'text', text: 'No effusion.' },
  { kind: 'command', command: { kind: 'newline' } },
  { kind: 'text', text: 'heart normal' },
])
assert.deepEqual(parseUtterances('lungs clear new line'), [{ kind: 'text', text: 'lungs clear' }, { kind: 'command', command: { kind: 'newline' } }])
// Corrections apply to text, not commands
const upper = (t: string) => t.toUpperCase()
assert.deepEqual(parseUtterance('next section', upper), { kind: 'command', command: { kind: 'next' } })
// Guideline helper commands only when said on their own; "guideline" inside report text stays text.
for (const said of ['open guideline', 'Guideline.', 'check the guidelines', 'show guideline helper']) {
  assert.deepEqual(parseUtterance(said), { kind: 'command', command: { kind: 'guideline', action: 'open' } }, said)
}
for (const said of ['insert guideline', 'Apply guideline.', 'add the guideline recommendation']) {
  assert.deepEqual(parseUtterance(said), { kind: 'command', command: { kind: 'guideline', action: 'insert' } }, said)
}
assert.deepEqual(parseUtterance('close guideline'), { kind: 'command', command: { kind: 'guideline', action: 'close' } })
assert.equal(parseUtterance('follow up per Fleischner guideline')?.kind, 'text')
assert.deepEqual(parseUtterance('lungs clear', upper), { kind: 'text', text: 'LUNGS CLEAR' })
// Sentence helpers
assert.equal(lastSentenceStart('No effusion. Heart normal.'), 13)
assert.equal(lastSentenceStart('Nodule 1.2 cm in the apex'), 0)
assert.equal(lastSentenceStart('First. Nodule 1.2 cm. '), 7)
assert.equal(capitaliseWords('right upper lobe'), 'Right Upper Lobe')
console.log('Dictation commands: 41 checks passed')
