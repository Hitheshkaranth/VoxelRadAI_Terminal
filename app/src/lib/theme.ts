export type ThemePreference = 'light' | 'dark' | 'system'
const KEY = 'skanda-appearance-v1'
export const isTheme = (value: unknown): value is ThemePreference => value === 'light' || value === 'dark' || value === 'system'
export function readThemePreference(): ThemePreference | null {
  try { const value = localStorage.getItem(KEY); return isTheme(value) ? value : null } catch { return null }
}
export function saveThemePreference(theme: ThemePreference) {
  try { localStorage.setItem(KEY, theme) } catch { /* Private/restricted storage still permits an in-session switch. */ }
}
export const resolveTheme = (theme: ThemePreference, systemDark: boolean): 'light' | 'dark' => theme === 'system' ? systemDark ? 'dark' : 'light' : theme
