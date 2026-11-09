import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/shadcn.css'
import './styles/ui.css'
import './index.css'
// Keep geometry before responsive/material overrides when viewer JavaScript loads lazily.
import './components/shell/shell.css'
import './components/shell/worklist.css'
import './components/shell/volumeIdentity.css'
import './components/shell/volumeJobs.css'
import './components/shell/admin.css'
import './components/shell/session.css'
import './components/viewer/viewer.css'
import './components/viewer/volumeViewer.css'
import './components/viewer/volumeReview.css'
import './components/viewer/volumeReport.css'
import './components/viewer/volumeLocator.css'
import './components/viewer/volumeMultiplanar.css'
import './components/viewer/volumeRaycast.css'
import './components/findings/findings.css'
import './components/report/report.css'
import './components/report/shareStudy.css'
import './components/report/print.css'
import { SessionGate } from './components/shell/SessionGate'
import { ThemeController } from './components/shell/ThemeSwitch'
import { configureStorageScope } from './lib/workspaceStorage'
import { TooltipProvider } from './components/ui/tooltip'
import './styles/workspace.css'
import './styles/mobile.css'
import './styles/clinical.css'
import './styles/material.css'
import './styles/scanWorkspace.css'

const App = lazy(() => import('./App.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeController />
    <TooltipProvider delayDuration={350}><SessionGate onAuthenticated={(user) => configureStorageScope(user.id)}><Suspense fallback={<p role="status">Loading workspace…</p>}><App /></Suspense></SessionGate></TooltipProvider>
  </StrictMode>,
)
