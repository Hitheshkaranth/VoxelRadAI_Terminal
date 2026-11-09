import { ShellButton } from './ShellButton'
import { useLayoutEffect, useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useApp } from '../../store'
import { resolveTheme } from '../../lib/theme'
import './themeSwitch.css'

const subscribe = (notify: () => void) => {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', notify)
  return () => media.removeEventListener('change', notify)
}
const snapshot = () => window.matchMedia('(prefers-color-scheme: dark)').matches
function useResolvedTheme() {
  const preference = useApp((state) => state.settings.theme)
  const systemDark = useSyncExternalStore(subscribe, snapshot, () => false)
  return resolveTheme(preference, systemDark)
}

/** Mounted outside authentication so login and workspace use one appearance setting. */
export function ThemeController() {
  const theme = useResolvedTheme()
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme }, [theme])
  return null
}

export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const theme = useResolvedTheme()
  const change = (next: 'light' | 'dark') => useApp.getState().updateSettings({ theme: next })
  if (compact) {
    const next = theme === 'dark' ? 'light' : 'dark'
    return <ShellButton type="button" className="icon-btn theme-toggle" aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`} onClick={() => change(next)}>{next === 'light' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}</ShellButton>
  }
  return <div className="theme-switch" role="group" aria-label="Appearance">
    <ShellButton type="button" aria-pressed={theme === 'light'} onClick={() => change('light')}><Sun aria-hidden="true" /><span>Light</span></ShellButton>
    <ShellButton type="button" aria-pressed={theme === 'dark'} onClick={() => change('dark')}><Moon aria-hidden="true" /><span>Dark</span></ShellButton>
  </div>
}
