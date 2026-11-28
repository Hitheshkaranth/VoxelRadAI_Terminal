// The signed-in reader's photo (or initials) at the top right of every signed-in page. Like the account menu in Chrome
// or Google apps, it opens a menu with who is signed in, the profile, and Sign out.
import { useEffect, useState } from 'react'
import { DropdownMenu } from 'radix-ui'
import { FileText, LayoutGrid, LogOut, UserRound } from 'lucide-react'
import { SERVER_MODE, logout, useSession } from '../../lib/session'
import './userAvatar.css'

let version = Date.now()
const listeners = new Set<() => void>()
/** Call after the profile photo changes so every avatar reloads it. */
export function refreshUserAvatar() { version = Date.now(); for (const l of listeners) l() }

/** Two initials from the name, skipping titles such as "Dr" (Dr Asha Rao → AR); falls back to the email. */
export function initialsOf(name: string): string {
  const words = name.split(/[\s@.]+/).filter(Boolean)
  const rest = words.length > 1 && /^(dr|prof|mr|mrs|ms|miss)$/i.test(words[0]) ? words.slice(1) : words
  return rest.slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'
}

function Face({ size, initials, v, photo, onError }: { size: number; initials: string; v: number; photo: boolean; onError: () => void }) {
  return <span className="user-avatar-face" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
    <span>{initials}</span>
    {photo ? <img src={`/api/account/avatar?v=${v}`} alt="" onError={onError} /> : null}
  </span>
}

export function UserAvatar({ size = 32 }: { size?: number }) {
  const user = useSession((s) => s.user)
  const [v, setV] = useState(version)
  const [photo, setPhoto] = useState(true)
  useEffect(() => { const l = () => { setV(version); setPhoto(true) }; listeners.add(l); return () => { listeners.delete(l) } }, [])
  if (!SERVER_MODE || !user) return null
  const name = user.fullName || user.email
  const initials = initialsOf(name)
  const onAccount = window.location.pathname.startsWith('/account')
  const signOut = () => { void logout().then(() => { window.location.href = '/' }) }
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button type="button" className="user-avatar" aria-label={`Account menu for ${name}`} title={name}>
        <Face size={size} initials={initials} v={v} photo={photo} onError={() => setPhoto(false)} />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="user-menu" align="end" sideOffset={8} collisionPadding={12}>
        <div className="user-menu-head">
          <Face size={44} initials={initials} v={v} photo={photo} onError={() => setPhoto(false)} />
          <div>
            <strong>{user.fullName || 'Your account'}</strong>
            <span>{user.email}</span>
            <em>{user.role === 'admin' ? 'Administrator' : 'Clinician'}</em>
          </div>
        </div>
        <DropdownMenu.Separator className="user-menu-sep" />
        {onAccount
          ? <DropdownMenu.Item className="user-menu-item" onSelect={() => { window.location.href = '/workspace' }}><LayoutGrid aria-hidden="true" />Workspace</DropdownMenu.Item>
          : <DropdownMenu.Item className="user-menu-item" onSelect={() => { window.location.href = '/account' }}><UserRound aria-hidden="true" />Your profile &amp; usage</DropdownMenu.Item>}
        <DropdownMenu.Item className="user-menu-item" onSelect={() => { window.location.href = '/workspace#templates' }}><FileText aria-hidden="true" />Report templates</DropdownMenu.Item>
        <DropdownMenu.Separator className="user-menu-sep" />
        <DropdownMenu.Item className="user-menu-item" onSelect={signOut}><LogOut aria-hidden="true" />Sign out</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}
