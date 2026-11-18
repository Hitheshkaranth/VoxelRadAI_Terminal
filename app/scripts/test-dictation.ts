import assert from 'node:assert/strict'
import { parseUtterance } from '../src/lib/dictation.ts'

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
console.log('Dictation commands: 13 checks passed')
