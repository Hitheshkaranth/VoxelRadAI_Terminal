// Single entry point for "is LM Studio up with our model loaded?" so the poller, the toolbar pill and the
// error state's "Check connection" button all run the same check and write the same store field.
import type { ConnectionState } from '../types'
import { useApp } from '../store'
import { checkConnection } from './medgemma'

let inflight: Promise<ConnectionState> | null = null

/**
 * Run the connection check now. Concurrent callers share one request.
 * `quiet` (background polling) only shows 'checking' when the state is still unknown, so the pill does not flicker.
 */
export function checkNow(opts?: { quiet?: boolean }): Promise<ConnectionState> {
  if (inflight) return inflight
  if (!opts?.quiet || useApp.getState().connection === 'unknown') useApp.getState().setConnection('checking')
  inflight = checkConnection(useApp.getState().settings)
    .catch((): ConnectionState => 'offline')
    .then((c) => {
      useApp.getState().setConnection(c)
      return c
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}
