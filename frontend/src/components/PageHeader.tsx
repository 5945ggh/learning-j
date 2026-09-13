import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Shared content rhythm for AppShell pages at the DESIGN breakpoints. */
export const CONTENT_WIDTH = 'mx-auto w-full max-w-6xl'
export const CONTENT_PAD = 'px-4 min-[760px]:px-8 min-[1180px]:px-10'
export const CONTENT_TOP = 'pt-6 min-[760px]:pt-9'
export const CONTENT_BOTTOM = 'pb-20 min-[760px]:pb-24'

export type PageHeaderProps = {
  eyebrow?: string
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}

/**
 * Page heading only. Navigation, fetching and page lifecycle stay with the
 * owning shell; actions are supplied by the caller as children/props.
 */
export function PageHeader({ eyebrow, title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-3', CONTENT_PAD, CONTENT_TOP, className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/** Explicit copy for a capability that belongs to a later packet. */
export function PlaceholderNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
      {children}
    </div>
  )
}
