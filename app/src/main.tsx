import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'

// After a deploy, a tab opened earlier asks for code files that no longer exist and the app would go blank. Reload
// once to get the current version (not again within a minute, so a real outage cannot cause a reload loop).
window.addEventListener('vite:preloadError', (event) => {
  const key = 'radgenis.deployReloadAt'
  let last = 0
  try { last = Number(sessionStorage.getItem(key)) || 0 } catch { /* storage blocked: still reload once */ }
  if (Date.now() - last < 60_000) return
  try { sessionStorage.setItem(key, String(Date.now())) } catch { /* ignore */ }
  event.preventDefault()
  window.location.reload()
})
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
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import './styles/workspace.css'
import './styles/mobile.css'
import './styles/clinical.css'
import './styles/material.css'
import './styles/scanWorkspace.css'
import './styles/appleControls.css'

// Vercel Web Analytics is cookieless. Drop query and hash before sending so no study or volume state leaves the browser.
const bareUrl = (href: string) => { const url = new URL(href); return url.origin + url.pathname }
const stripUrl = (event: BeforeSendEvent): BeforeSendEvent => ({ ...event, url: bareUrl(event.url) })

// Each entry point is its own chunk: the landing page does not download the workspace, and vice versa.
const LandingPage = lazy(() => import('./LandingPage').then((m) => ({ default: m.LandingPage })))
const WorkspaceRoot = lazy(() => import('./WorkspaceRoot').then((m) => ({ default: m.WorkspaceRoot })))
const DemoRoot = lazy(() => import('./DemoRoot').then((m) => ({ default: m.DemoRoot })))
const Skanda0Page = lazy(() => import('./landing/Pages').then((m) => ({ default: m.Skanda0Page })))
const BenchmarksPage = lazy(() => import('./landing/Pages').then((m) => ({ default: m.BenchmarksPage })))
const DocsPage = lazy(() => import('./landing/DocsPage').then((m) => ({ default: m.DocsPage })))
const AccountRoot = lazy(() => import('./account/AccountRoot').then((m) => ({ default: m.AccountRoot })))
const path = window.location.pathname.replace(/\/+$/, '') || '/'
function Route() {
  if (path === '/demo') return <DemoRoot />
  if (path === '/skanda-0') return <Skanda0Page />
  if (path === '/benchmarks') return <BenchmarksPage />
  if (path === '/docs') return <DocsPage />
  if (path === '/account') return <AccountRoot />
  if (path === '/' && !new URLSearchParams(window.location.search).has('oidc')) return <LandingPage />
  return <WorkspaceRoot />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}><Route /></Suspense>
    <Analytics beforeSend={stripUrl} />
    <SpeedInsights beforeSend={(e) => ({ ...e, url: bareUrl(e.url) })} />
  </StrictMode>,
)
