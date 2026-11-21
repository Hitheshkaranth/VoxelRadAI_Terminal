// The signed-in user's server storage allowance (default 10 GB): saved scans, patient data, reports, AI analysis
// with review decisions, uploaded volumes and dictation feedback. Server mode only; local mode uses browser storage.
import { create } from 'zustand'

export type StorageBreakdown = { scans: number; patientAndReports: number; analysis: number; feedback: number }
export type AccountStorage = { quotaBytes: number; usedBytes: number; availableBytes: number; counts: { studies: number; volumes: number; feedback: number }; breakdown: StorageBreakdown }

const nonNegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function parseAccountStorage(data: unknown): AccountStorage | null {
  if (!data || typeof data !== 'object') return null
  const value = data as Record<string, unknown>
  const breakdown = value.breakdown as Record<string, unknown> | undefined
  const counts = value.counts as Record<string, unknown> | undefined
  if (!nonNegative(value.quotaBytes) || !nonNegative(value.usedBytes) || !breakdown || !counts) return null
  const parts = ['scans', 'patientAndReports', 'analysis', 'feedback'] as const
  if (!parts.every((part) => nonNegative(breakdown[part]))) return null
  return {
    quotaBytes: value.quotaBytes, usedBytes: value.usedBytes,
    availableBytes: Math.max(0, value.quotaBytes - value.usedBytes),
    counts: { studies: Number(counts.studies) || 0, volumes: Number(counts.volumes) || 0, feedback: Number(counts.feedback) || 0 },
    breakdown: Object.fromEntries(parts.map((part) => [part, breakdown[part] as number])) as StorageBreakdown,
  }
}

/** Decimal units, as storage is sold ("10 GB"); the server allowance is 10 GiB, which displays as 10.7 GB. */
export function formatStorage(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e11 ? 0 : 1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1)} MB`
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`
  return `${bytes} B`
}

/** Share of the allowance used, 0–100, and how urgent it looks. A zero allowance is full. */
export function storageLevel(storage: Pick<AccountStorage, 'usedBytes' | 'quotaBytes'>): { percent: number; tone: 'ok' | 'warn' | 'full' } {
  const percent = storage.quotaBytes > 0 ? Math.min(100, (storage.usedBytes / storage.quotaBytes) * 100) : 100
  return { percent, tone: percent >= 95 ? 'full' : percent >= 80 ? 'warn' : 'ok' }
}

type State = { storage: AccountStorage | null; error: boolean; loading: boolean }
export const useAccountStorage = create<State>(() => ({ storage: null, error: false, loading: false }))

let inFlight: Promise<void> | null = null
/** Fetch current usage. Called on mount and after saves, uploads and deletions. */
export function refreshAccountStorage(): Promise<void> {
  if (inFlight) return inFlight
  useAccountStorage.setState({ loading: true })
  inFlight = fetch('/api/account/storage', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
    .then(async (response) => {
      const storage = response.ok ? parseAccountStorage(await response.json().catch(() => null)) : null
      useAccountStorage.setState(storage ? { storage, error: false } : { error: true })
    })
    .catch(() => { useAccountStorage.setState({ error: true }) })
    .finally(() => { inFlight = null; useAccountStorage.setState({ loading: false }) })
  return inFlight
}

export const STORAGE_CHANGED = 'voxelrad:storage-changed'
/** Tell any visible storage meter that server usage changed (a save, upload or deletion). No-op outside a browser. */
export function announceStorageChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STORAGE_CHANGED))
}
