import type { ComponentProps } from 'react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/** Shared shadcn control for both image and volume reading surfaces. */
export function ScanButton({ title, ...props }: ComponentProps<typeof Button>) {
  const hint = title || props['aria-label']
  const button = <Button type="button" variant="ghost" size="sm" {...props} />
  if (!hint) return button
  return <Tooltip><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent sideOffset={8}>{hint}</TooltipContent></Tooltip>
}
