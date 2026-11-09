import { lazy, Suspense } from 'react'
import { SessionGate } from './components/shell/SessionGate'
import { ThemeController } from './components/shell/ThemeSwitch'
import { TooltipProvider } from './components/ui/tooltip'
import { configureStorageScope } from './lib/workspaceStorage'

const App = lazy(() => import('./App'))

export function WorkspaceRoot() {
  return <>
    <ThemeController />
    <TooltipProvider delayDuration={350}>
      <SessionGate onAuthenticated={(user) => configureStorageScope(user.id)}>
        <Suspense fallback={<p role="status">Loading workspace…</p>}><App /></Suspense>
      </SessionGate>
    </TooltipProvider>
  </>
}
