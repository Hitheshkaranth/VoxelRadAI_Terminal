import type { ComponentProps } from 'react'
import { Button } from '../ui/button'
import './shellAccessibility.css'

/** Shared shadcn behavior with the workspace's existing layout classes. */
export function ShellButton({ className = '', variant, size, type = 'button', ...props }: ComponentProps<typeof Button>) {
  const tokens = className.split(/\s+/)
  const resolvedVariant = variant ?? (tokens.includes('btn-destructive') ? 'destructive' : tokens.includes('btn-primary') ? 'default' : 'ghost')
  return <Button {...props} type={type} variant={resolvedVariant} size={size ?? (tokens.includes('icon-btn') ? 'icon' : 'sm')} className={`sh-control ${className}`} />
}
