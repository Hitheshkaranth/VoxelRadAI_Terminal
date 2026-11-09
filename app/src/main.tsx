import { StrictMode } from 'react'
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
import { WorkspaceRoot } from './WorkspaceRoot'
import './styles/workspace.css'
import './styles/mobile.css'
import './styles/clinical.css'
import './styles/material.css'
import './styles/scanWorkspace.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkspaceRoot />
  </StrictMode>,
)
