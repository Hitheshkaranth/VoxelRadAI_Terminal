// Pure serial queue: one task runs at a time, in arrival order, whatever earlier tasks did.
// A caller can abort while waiting: the promise rejects at once and the task never starts.

function abortError(): Error {
  const e = new Error('Analysis cancelled.')
  e.name = 'AbortError'
  return e
}

export interface SerialQueue {
  enqueue<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>
  /** Tasks waiting or running (aborted waiters are not counted). */
  size(): number
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<void> = Promise.resolve()
  let pending = 0

  function enqueue<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError())
    const prev = tail
    let release!: () => void
    tail = new Promise<void>((r) => (release = r))
    pending++
    let counted = true
    const uncount = () => {
      if (counted) pending--
      counted = false
    }

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        uncount()
        reject(abortError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      prev.then(async () => {
        signal?.removeEventListener('abort', onAbort)
        try {
          // Aborted while waiting: already rejected, skip the task and hand the slot on.
          if (signal?.aborted) return
          resolve(await task())
        } catch (err) {
          reject(err)
        } finally {
          uncount()
          release()
        }
      })
    })
  }

  return { enqueue, size: () => pending }
}
