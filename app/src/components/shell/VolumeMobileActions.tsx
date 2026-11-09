import { ShellButton } from './ShellButton'
import { ScanLine } from 'lucide-react'
import { useShell } from './shellState'

/** A visible shortcut into the volume's dedicated mobile analysis screen. */
export function VolumeMobileActions() {
  return <div className="volume-mobile-actions">
    <span>Volume review</span>
    <ShellButton className="btn btn-primary btn-sm" type="button" onClick={() => useShell.getState().setMobileView('findings')}><ScanLine aria-hidden="true" /> Analyze &amp; findings</ShellButton>
  </div>
}
