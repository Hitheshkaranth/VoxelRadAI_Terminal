import { ShellButton } from '../shell/ShellButton'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Share2 } from 'lucide-react'
import type { Study } from '../../types'
import { downloadFile } from '../../lib/reportExport'
import { shareReportText, studyShareHtml } from '../../lib/studyShare'
import { SERVER_MODE, useSession } from '../../lib/session'
import { createHostedShare, listHostedShares, revokeHostedShare, type HostedShare, type CreatedShare } from '../../lib/serverShare'
import { Sheet } from '../shell/Sheet'
import './shareStudy.css'

export function ShareStudySheet({ study, institution, onClose }: { study: Study; institution: string; onClose: () => void }) {
  const [includeIdentity, setIncludeIdentity] = useState(false)
  const [includeImages, setIncludeImages] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const user = useSession((state) => state.user)
  const hosted = SERVER_MODE && !!user
  const [expiresInHours, setExpiresInHours] = useState(24)
  const [shares, setShares] = useState<HostedShare[]>([])
  const [created, setCreated] = useState<CreatedShare | null>(null)
  const [historyError, setHistoryError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(hosted)
  const [refresh, setRefresh] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!hosted) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hosted])
  const inFlight = useRef(false)
  const linkInput = useRef<HTMLInputElement>(null)
  const refreshHistory = () => {
    setHistoryLoading(true)
    setHistoryError('')
    setRefresh((value) => value + 1)
  }
  useEffect(() => {
    if (!hosted) return
    const controller = new AbortController()
    void listHostedShares(study.id, controller.signal).then((items) => {
      if (!controller.signal.aborted) setShares(items)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : 'Link history could not be loaded.')
    }).finally(() => { if (!controller.signal.aborted) setHistoryLoading(false) })
    return () => controller.abort()
  }, [hosted, study.id, refresh])
  const createLink = async () => {
    if (!confirmed || inFlight.current || !hosted) return
    inFlight.current = true; setBusy(true); setMessage('Uploading study and creating link...'); setCreated(null)
    try {
      const link = await createHostedShare(study, { expiresInHours, includeIdentity, includeImages })
      setCreated(link); setMessage('Link created. Copy it now; it cannot be retrieved after closing this sheet.')
      refreshHistory()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Link creation failed. Check link history before retrying.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  const revoke = async (id: string) => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setMessage('Revoking link...')
    try {
      await revokeHostedShare(id)
      if (created?.id === id) setCreated(null)
      setShares((items) => items.map((item) => item.id === id ? { ...item, revokedAt: Date.now() } : item))
      setMessage('Link revoked. Previously downloaded copies are unaffected.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not revoke link. Try again.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  const copyLink = async () => {
    if (!created) return
    try { await navigator.clipboard.writeText(created.url); setMessage('Link copied. Anyone with this link can view the shared copy until it expires or is revoked.') }
    catch { linkInput.current?.focus(); linkInput.current?.select(); setMessage('Copy is unavailable here. The link is selected; copy it manually.') }
  }
  const options = { includeIdentity, includeImages }
  const file = useMemo(() => new File([studyShareHtml(study, institution, { includeIdentity, includeImages })], 'voxelrad-report.html', { type: 'text/html' }), [study, institution, includeIdentity, includeImages])
  let canShare = false
  try {
    canShare = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  } catch { /* Restricted browser contexts still offer the download action. */ }
  const share = async () => {
    if (!confirmed || inFlight.current || !canShare) return
    inFlight.current = true
    setBusy(true); setMessage('')
    try {
      await navigator.share({ files: [file], title: 'Radiology report' })
      setMessage('Report handed to your selected app.')
    } catch (error) {
      setMessage(error instanceof DOMException && error.name === 'AbortError' ? 'Sharing cancelled. No file was sent by VoxelRad AI.' : 'Sharing was unavailable. Download the file and attach it in your approved messaging service.')
    } finally { inFlight.current = false; setBusy(false) }
  }
  return <Sheet open onClose={onClose} title="Share report & scans" subtitle="Choose exactly what leaves this workspace.">
    <div className="share-study">
      <p className="share-study-notice"><strong>{hosted ? 'Share a file or create a link' : 'File sharing is available'}</strong>{hosted ? ' Creating a link uploads the full study, including patient details and all stored images, to your organization server. The options below limit what the recipient sees. Anyone with the link can view that copy until expiry or revocation.' : ' Hosted links require a server deployment and a signed-in account. Files you send cannot be expired or revoked here.'}</p>
      <fieldset disabled={busy}>
        <legend>Include in the shared copy</legend>
        <label><input type="checkbox" checked={includeIdentity} onChange={e => { setIncludeIdentity(e.target.checked); setConfirmed(false) }} /><span>Patient identity<small>Name, patient ID and referring physician. Off by default.</small></span></label>
        <label><input type="checkbox" checked={includeImages} disabled={!study.images.length} onChange={e => { setIncludeImages(e.target.checked); setConfirmed(false) }} /><span>Scan display copies · {study.images.length}<small>Images stored with this study; not original DICOM or full CT/MRI volumes.</small></span></label>
      </fieldset>
      {hosted && <label className="share-expiry"><span>Link expires after</span><select className="input" disabled={busy} value={expiresInHours} onChange={(event) => { setExpiresInHours(Number(event.target.value)); setConfirmed(false) }}><option value={1}>1 hour</option><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>7 days</option></select></label>}
      <details><summary>Preview report text</summary><pre>{shareReportText(study, institution, options)}</pre></details>
      <p>Free text and text burned into scans may contain identifying information even with patient identity off. Review the report and selected scans before sending.</p>
      <label className="share-study-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /><span>I reviewed the contents and intend to share this copy with my recipient.</span></label>
      <div className="share-study-actions">
        {hosted && <ShellButton className="btn btn-primary" disabled={!confirmed || busy} onClick={createLink}>Upload &amp; create link</ShellButton>}
        <ShellButton className={`btn ${hosted ? '' : 'btn-primary'}`} disabled={!confirmed || busy} onClick={() => { downloadFile(file.name, file, file.type); setMessage('Download started. Attach the HTML file using your approved sharing service.') }}><Download size={16} />Download file</ShellButton>
        {canShare && <ShellButton className="btn" disabled={!confirmed || busy} onClick={share}><Share2 size={16} />{busy ? 'Opening share…' : 'Choose app'}</ShellButton>}
      </div>
      <p className="share-study-meta">HTML document · {(file.size / 1024).toFixed(0)} KB · opens in a browser</p>
      <p role="status" aria-live="polite">{message}</p>
      {created && <section className="share-created" aria-label="New share link"><label htmlFor="created-share-link">New link - expires {new Date(created.expiresAt).toLocaleString()}</label><input id="created-share-link" className="input" ref={linkInput} readOnly value={created.url} onFocus={(event) => event.currentTarget.select()} /><div className="share-study-actions"><ShellButton className="btn" disabled={busy} onClick={copyLink}>Copy link</ShellButton><ShellButton className="btn" disabled={busy} onClick={() => revoke(created.id)}>Revoke this link</ShellButton></div><small>This is a snapshot. Later report changes are not included.</small></section>}
      {hosted && <section className="share-history" aria-label="Share link history"><div className="share-history-heading"><h3>Link history</h3><ShellButton className="btn" disabled={busy || historyLoading} onClick={refreshHistory}>Refresh</ShellButton></div><p className="share-study-meta">Links can be revoked here. Their secret addresses are shown only when created.</p>{historyLoading && <p role="status">Loading links...</p>}{historyError && <p role="alert">{historyError}</p>}{!historyLoading && !historyError && shares.length === 0 && <p>No links have been created for this study.</p>}<ul>{shares.map((item) => <li key={item.id}><span><strong>{item.revokedAt ? 'Revoked' : item.expiresAt <= now ? 'Expired' : 'Active'}</strong><small>Created {new Date(item.createdAt).toLocaleString()}<br />Expires {new Date(item.expiresAt).toLocaleString()}</small></span>{!item.revokedAt && item.expiresAt > now && <ShellButton className="btn" disabled={busy} onClick={() => revoke(item.id)} aria-label={`Revoke link created ${new Date(item.createdAt).toLocaleString()}`}>Revoke</ShellButton>}</li>)}</ul></section>}
    </div>
  </Sheet>
}
