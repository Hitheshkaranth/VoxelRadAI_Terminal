// Push-to-talk settings. Hand-held dictation microphones (SpeechMike, PowerMic and similar) can usually be set
// to send a keystroke such as F4 for their record button; browsers cannot read HID buttons directly, so a
// button only works here if its driver or keyboard mode turns it into a key the page receives. Best effort.

export type DictationMode = 'handsfree' | 'hold' | 'toggle'

export const DEFAULT_HOTKEY = 'F4'
export const MODE_LABEL: Record<DictationMode, string> = {
  handsfree: 'Hands-free (pause to send)',
  hold: 'Hold key to talk',
  toggle: 'Press key to start/stop',
}

const MODE_KEY = 'voxelrad.dictationMode'
const HOTKEY_KEY = 'voxelrad.dictationHotkey'
// Keys that would break typing or browser navigation if captured as the talk key.
const RESERVED = new Set(['', 'Tab', 'Enter', 'Escape', 'Backspace', 'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock'])

/** The identifier we store: physical `code` when the browser gives one, otherwise the `key` (some media buttons). */
export function hotkeyId(event: { code?: string; key?: string }): string {
  return event.code || event.key || ''
}

export function hotkeyAllowed(id: string): boolean {
  // Plain letters, digits and punctuation would fire while typing in the report.
  return !RESERVED.has(id) && !/^(Key[A-Z]|Digit\d|Numpad\d|Minus|Equal|Comma|Period|Slash|Semicolon|Quote|Backquote|Bracket\w+|Backslash)$/.test(id)
}

export function hotkeyMatches(event: { code?: string; key?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }, hotkey: string): boolean {
  if (!hotkey || event.ctrlKey || event.metaKey || event.altKey) return false
  return event.code === hotkey || (!event.code && event.key === hotkey)
}

export function describeHotkey(id: string): string {
  if (/^Numpad/.test(id)) return id.replace('Numpad', 'Num ')
  if (/^Media|^Audio|^Launch/.test(id)) return id.replace(/([a-z])([A-Z])/g, '$1 $2')
  return id || 'none'
}

export function loadDictationMode(): DictationMode {
  try {
    const mode = localStorage.getItem(MODE_KEY)
    return mode === 'hold' || mode === 'toggle' ? mode : 'handsfree'
  } catch {
    return 'handsfree'
  }
}

export function saveDictationMode(mode: DictationMode) {
  try { localStorage.setItem(MODE_KEY, mode) } catch { /* optional preference */ }
}

export function loadHotkey(): string {
  try {
    const id = localStorage.getItem(HOTKEY_KEY)
    return id && hotkeyAllowed(id) ? id : DEFAULT_HOTKEY
  } catch {
    return DEFAULT_HOTKEY
  }
}

export function saveHotkey(id: string) {
  try { localStorage.setItem(HOTKEY_KEY, id) } catch { /* optional preference */ }
}
