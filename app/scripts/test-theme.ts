import assert from 'node:assert/strict'
import { isTheme, readThemePreference, resolveTheme, saveThemePreference } from '../src/lib/theme.ts'

assert.equal(resolveTheme('system', true), 'dark')
assert.equal(resolveTheme('system', false), 'light')
assert.equal(resolveTheme('light', true), 'light')
assert.equal(resolveTheme('dark', false), 'dark')
assert.equal(isTheme('invalid'), false)
const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const values = new Map<string, string>()
try {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  } })
  assert.equal(readThemePreference(), null)
  for (const theme of ['light', 'dark', 'system'] as const) { saveThemePreference(theme); assert.equal(readThemePreference(), theme) }
  values.set('skanda-appearance-v1', 'broken')
  assert.equal(readThemePreference(), null)
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Storage blocked') } })
  assert.equal(readThemePreference(), null)
  assert.doesNotThrow(() => saveThemePreference('light'))
} finally {
  if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
  else Reflect.deleteProperty(globalThis, 'localStorage')
}
console.log('Theme: explicit/system resolution, preference persistence, invalid values and restricted storage passed')
