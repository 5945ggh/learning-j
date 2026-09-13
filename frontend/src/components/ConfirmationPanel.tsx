import { cn } from '@/lib/utils'
import { PlaceholderNote } from './PageHeader'

export type ConfirmationPanelStatus = 'loading' | 'ready' | 'error' | 'unavailable' | 'extraction' | 'confirmation'

export type ConfirmationPanelProps = {
  status?: ConfirmationPanelStatus
  candidateCount?: number | null
  error?: string | null
  onRetry?: () => void
  className?: string
}

/**
 * Honest extraction/confirmation boundary for the baseline.
 *
 * P4a/P4b own extraction runs and Occurrence-level confirmation. This component
 * intentionally exposes no candidate mutation controls and never creates a
 * review item; even a ready fixture is labelled as not implemented.
 */
export function ConfirmationPanel({ status = 'unavailable', candidateCount = null, error = null, onRetry, className }: ConfirmationPanelProps) {
  if (status === 'loading') return <p role="status" className={cn('rounded-md border border-border bg-card px-4 py-4 text-sm text-muted-foreground', className)}>正在加载提取状态…</p>
  if (status === 'error') {
    return (
      <div role="alert" className={cn('rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm', className)}>
        <p>{error ?? '提取状态加载失败'}</p>
        {onRetry ? <button type="button" onClick={onRetry} className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">重试</button> : null}
      </div>
    )
  }

  return (
    <section className={cn('rounded-md border border-border bg-card p-4', className)} aria-labelledby="confirmation-panel-heading">
      <h2 id="confirmation-panel-heading" className="text-sm font-semibold">提取与确认</h2>
      <PlaceholderNote>
        <span className="font-medium text-foreground">待实现。</span>{' '}
        P4a/P4b 将接入固定文档版本、Occurrence 候选与逐项确认；当前不展示提取、部分确认或零候选流程。
        {candidateCount !== null ? <span className="ml-1">（收到 {candidateCount} 项候选的占位数据）</span> : null}
      </PlaceholderNote>
    </section>
  )
}
