import { clear, createStore, get, set, type UseStore } from 'idb-keyval'

let scope: string | null = null
let storage: UseStore | undefined

/** Select once, before hydration. Account changes require a full page reload. */
export function configureStorageScope(userId: string) {
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(userId)) throw new Error('Invalid workspace identity')
  if (scope && scope !== userId) throw new Error('Reload before switching accounts')
  scope = userId
  storage ??= createStore(`skanda-user-${userId}`, 'workspace')
}

// Undefined preserves the legacy local-only database. Server accounts never read it.
export const workspaceGet = <T>(key: IDBValidKey) => get<T>(key, storage)
export const workspaceSet = (key: IDBValidKey, value: unknown) => set(key, value, storage)
export const clearWorkspace = () => clear(storage)
