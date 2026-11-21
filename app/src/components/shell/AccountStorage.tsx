import { useEffect } from 'react'
import { HardDrive } from 'lucide-react'
import { formatStorage, refreshAccountStorage, STORAGE_CHANGED, storageLevel, useAccountStorage, type StorageBreakdown } from '../../lib/accountStorage'
import './accountStorage.css'

/** Load usage on mount and again whenever a save, upload or deletion announces a change. */
function useStorageRefresh() {
  useEffect(() => {
    void refreshAccountStorage()
    const onChange = () => { void refreshAccountStorage() }
    window.addEventListener(STORAGE_CHANGED, onChange)
    return () => window.removeEventListener(STORAGE_CHANGED, onChange)
  }, [])
}

const PARTS: { key: keyof StorageBreakdown; label: string; hint: string }[] = [
  { key: 'scans', label: 'Scans', hint: 'Images in saved studies and uploaded CT/MR volumes' },
  { key: 'patientAndReports', label: 'Patient data & reports', hint: 'Patient details, report text and signed versions' },
  { key: 'analysis', label: 'Analysis', hint: 'AI findings, measurements and your accept/dismiss decisions' },
  { key: 'feedback', label: 'Feedback', hint: 'Dictation corrections you sent to improve the model' },
]

function Meter({ percent, tone, label }: { percent: number; tone: string; label: string }) {
  return (
    <div className={`as-meter as-${tone}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
      <span style={{ width: `${Math.max(percent, percent > 0 ? 1.5 : 0)}%` }} />
    </div>
  )
}

/** Compact usage line for the worklist sidebar. */
export function StorageMeterCompact() {
  const { storage, error } = useAccountStorage()
  useStorageRefresh()
  if (!storage) return <div className="wl-storage-note">{error ? 'Server storage usage unavailable' : 'Checking server storage…'}</div>
  const level = storageLevel(storage)
  return (
    <div className="as-compact" title={`${formatStorage(storage.availableBytes)} free`}>
      <div className="as-compact-row"><HardDrive aria-hidden /><span>{formatStorage(storage.usedBytes)} of {formatStorage(storage.quotaBytes)} used</span></div>
      <Meter percent={level.percent} tone={level.tone} label="Server storage used" />
    </div>
  )
}

/** Full breakdown for Settings → Account. */
export function AccountStoragePanel() {
  const { storage, error, loading } = useAccountStorage()
  useStorageRefresh()
  if (!storage) return <div className="sh-about-sub">{error ? 'Server storage usage is unavailable right now.' : 'Checking server storage…'}</div>
  const level = storageLevel(storage)
  return (
    <div className="as-panel">
      <div className="as-head">
        <strong>{formatStorage(storage.usedBytes)} <span>of {formatStorage(storage.quotaBytes)}</span></strong>
        <span>{formatStorage(storage.availableBytes)} free · {Math.round(level.percent)}%</span>
      </div>
      <Meter percent={level.percent} tone={level.tone} label="Server storage used" />
      <ul className="as-parts">
        {PARTS.map((part) => (
          <li key={part.key} title={part.hint}>
            <span className={`as-dot as-dot-${part.key}`} aria-hidden />
            <span className="as-part-label">{part.label}</span>
            <span className="as-part-value">{formatStorage(storage.breakdown[part.key])}</span>
          </li>
        ))}
      </ul>
      <div className="sh-about-sub">
        {storage.counts.studies} saved stud{storage.counts.studies === 1 ? 'y' : 'ies'}, {storage.counts.volumes} volume{storage.counts.volumes === 1 ? '' : 's'}.
        {level.tone === 'full' ? ' Your allowance is nearly full: delete saved studies or volumes, or ask an administrator for more space.' : level.tone === 'warn' ? ' Over 80% used.' : ''}
        {' '}<button type="button" className="as-refresh" disabled={loading} onClick={() => void refreshAccountStorage()}>Refresh</button>
      </div>
    </div>
  )
}
