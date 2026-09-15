import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
export { PageHeader, PlaceholderNote } from '@/components/PageHeader'

export const PAGE_WIDTH = 'mx-auto w-full max-w-[980px]'
export const PAGE_PADDING = 'px-5 py-7 min-[760px]:px-6 min-[1180px]:py-9'

export function PageFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(PAGE_WIDTH, 'pb-10', className)}>{children}</div>
}

export function Panel({
  title,
  hint,
  children,
  className,
}: {
  title: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('overflow-hidden rounded-[var(--radius-grouped)] border border-divider bg-opaque-surface', className)}>
      <header className="flex flex-wrap items-baseline gap-2 border-b border-divider px-4 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </header>
      {children}
    </section>
  )
}

export function StatusBlock({
  status,
  error,
  onRetry,
}: {
  status: 'loading' | 'error'
  error?: string
  onRetry?: () => void
}) {
  if (status === 'loading') {
    return <p role="status" className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">正在加载…</p>
  }
  return (
    <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-4 text-sm">
      <p>{error ?? '加载失败'}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          重试
        </button>
      )}
    </div>
  )
}

export function FixtureBadge() {
  return <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">fixture adapter</span>
}

export function UnavailableBadge() {
  return <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">待实现</span>
}
