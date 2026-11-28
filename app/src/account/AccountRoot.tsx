// /account behind the same sign-in as the workspace.
import { SessionGate } from '../components/shell/SessionGate'
import { ThemeController } from '../components/shell/ThemeSwitch'
import { configureStorageScope } from '../lib/workspaceStorage'
import { AccountPage } from './AccountPage'

export function AccountRoot() {
  return <>
    <ThemeController />
    <SessionGate onAuthenticated={(user) => configureStorageScope(user.id)}><AccountPage /></SessionGate>
  </>
}
