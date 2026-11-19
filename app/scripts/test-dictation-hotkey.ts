import assert from 'node:assert/strict'
import { describeHotkey, hotkeyAllowed, hotkeyId, hotkeyMatches } from '../src/lib/dictationHotkey.ts'

assert.equal(hotkeyId({ code: 'F4', key: 'F4' }), 'F4')
assert.equal(hotkeyId({ code: '', key: 'MediaPlayPause' }), 'MediaPlayPause')
assert.ok(hotkeyAllowed('F4'))
assert.ok(hotkeyAllowed('NumpadAdd'))
assert.ok(hotkeyAllowed('MediaPlayPause'))
assert.ok(!hotkeyAllowed('KeyA'))
assert.ok(!hotkeyAllowed('Space'))
assert.ok(!hotkeyAllowed('Digit4'))
assert.ok(hotkeyMatches({ code: 'F4', key: 'F4' }, 'F4'))
assert.ok(!hotkeyMatches({ code: 'F4', key: 'F4', ctrlKey: true }, 'F4'))
assert.ok(!hotkeyMatches({ code: 'F5', key: 'F5' }, 'F4'))
assert.ok(hotkeyMatches({ code: '', key: 'MediaPlayPause' }, 'MediaPlayPause'))
assert.equal(describeHotkey('Numpad0'), 'Num 0')
assert.equal(describeHotkey('MediaPlayPause'), 'Media Play Pause')
console.log('Dictation hotkey: 14 checks passed')
