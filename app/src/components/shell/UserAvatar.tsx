// The signed-in reader's photo (or initials) at the top right of every signed-in page; opens the profile.
import { useEffect, useState } from 'react'
import { SERVER_MODE, useSession } from '../../lib/session'
import './userAvatar.css'

let version = Date.now()
const listeners = new Set<() => void>()
/** Call after the profile photo changes so every avatar reloads it. */
export function refreshUserAvatar() { version = Date.now(); for (const l of listeners) l() }

export function UserAvatar({ size = 32 }: { size?: number }) {
  const user = useSession((s) => s.user)
  const [v, setV] = useState(version)
  const [photo, setPhoto] = useState(true)
  useEffect(() => { const l = () => { setV(version); setPhoto(true) }; listeners.add(l); return () => { listeners.delete(l) } }, [])
  if (!SERVER_MODE || !user) return null
  const name = user.fullName || user.email
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'
  return <a className="user-avatar" href="/account" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    aria-label={`Your profile: ${name}`} title={`${name} · Your profile`}>
    <span aria-hidden="true">{initials}</span>
    {photo ? <img src={`/api/account/avatar?v=${v}`} alt="" onError={() => setPhoto(false)} /> : null}
  </a>
}
