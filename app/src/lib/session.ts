import { create } from 'zustand'

export interface SessionUser { id: string; email: string; role: 'admin' | 'clinician' }
export const SERVER_MODE = import.meta.env?.VITE_SERVER_MODE === 'true'

function parseSession(value: unknown): SessionUser | null {
  if (!value || typeof value !== 'object' || !('user' in value)) throw new Error('The session service returned an invalid response.')
  const user = value.user
  if (user === null) return null
  if (!user || typeof user !== 'object' || !('id' in user) || typeof user.id !== 'string' || !('email' in user) || typeof user.email !== 'string' || !('role' in user) || (user.role !== 'admin' && user.role !== 'clinician')) throw new Error('The session service returned an invalid response.')
  return { id: user.id, email: user.email, role: user.role }
}

export const useSession = create<{ user: SessionUser | null; setUser: (user: SessionUser | null) => void }>((set) => ({ user: null, setUser: (user) => set({ user }) }))

export async function readSession(signal?: AbortSignal): Promise<SessionUser | null> {
  const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('The sign-in service is unavailable. Check the server and try again.')
  return parseSession(await response.json())
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const response = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: email.trim(), password }) })
  if (response.status === 401) throw new Error('Email or password is incorrect. Please try again.')
  if (response.status === 429) throw new Error('Too many sign-in attempts. Wait a few minutes and try again.')
  if (!response.ok) throw new Error('Sign-in could not be completed. Try again or contact your administrator.')
  const user = parseSession(await response.json())
  if (!user) throw new Error('Sign-in did not create a session. Please try again.')
  return user
}

export async function logout(): Promise<void> {
  const response = await fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  if (!response.ok) throw new Error('Sign-out could not be completed. Please try again.')
  useSession.getState().setUser(null)
  // A full reload terminates outstanding local jobs and discards in-memory study data.
  window.location.reload()
}
