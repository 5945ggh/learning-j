import { cn } from '@/lib/utils'
import { PlaceholderNote } from './PageHeader'
import type { AnalysisRevisionRecord, AnalysisSectionRecord } from './models'

export type AnalysisDocumentStatus = 'loading' | 'ready' | 'draft' | 'empty' | 'error'

export type AnalysisDocumentProps = {
  status?: AnalysisDocumentStatus
  revision?: AnalysisRevisionRecord | null
  draft?: string | null
  error?: string | null
  onRetry?: () => void
  onSectionSelect?: (section: AnalysisSectionRecord) => void
  /** P3b may opt into an editor around this read-only projection. */
  editable?: boolean
  className?: string
}

function renderBody(body: string): string {
  // The baseline intentionally does not pretend to be a Markdown editor. Keep
  // line breaks and remove only the emphasis markers used by fixture copy.
  return body.replace(/\*\*/g, '')
}

/** Read-only analysis document projection; revision ownership remains outside. */
export function AnalysisDocument({
  status = 'empty',
  revision = null,
  draft = null,
  error = null,
  onRetry,
  onSectionSelect,
  editable = false,
  className,
}: AnalysisDocumentProps) {
  if (status === 'loading') return <p role="status" className="py-8 text-center text-sm text-muted-foreground">正在加载解析文档…</p>
  if (status === 'error') {
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p>{error ?? '解析文档加载失败'}</p>
        {onRetry ? <button type="button" onClick={onRetry} className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">重试</button> : null}
      </div>
    )
  }

  const isDraft = status === 'draft' || (!revision && Boolean(draft))
  if (status === 'empty' || (!revision && !isDraft)) {
    return (
      <div className={cn('space-y-3', className)}>
        <PlaceholderNote>解析首稿尚未提交；此处会在准备或讨论阶段显示真实文档状态。</PlaceholderNote>
      </div>
    )
  }

  return (
    <article className={cn('rounded-md border border-border bg-card p-4 shadow-sm', className)} aria-labelledby="analysis-document-heading">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">当前文档</p>
          <h2 id="analysis-document-heading" className="mt-1 text-base font-semibold">{revision ? `版本 v${revision.revision}` : '草稿'}</h2>
        </div>
        {editable ? <span className="text-xs text-muted-foreground">编辑能力待实现</span> : null}
      </header>

      {isDraft ? (
        <pre className="mt-4 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{draft ?? '正在组织解析文档…'}</pre>
      ) : revision ? (
        <div className="mt-4 flex flex-col gap-5">
          {revision.sections.map((section) => {
            const sectionText = section.body_md ?? section.bodyMd ?? ''
            const body = (
              <>
                <h3 className="text-sm font-semibold">{section.heading}</h3>
                <p className="mt-1.5 whitespace-pre-line text-sm leading-7 text-muted-foreground">{renderBody(sectionText)}</p>
              </>
            )
            const sectionId = section.id ?? section.section_id ?? section.sectionId ?? `${section.heading}-${section.revision}`
            return onSectionSelect ? (
              <button key={`${sectionId}-${section.revision}`} type="button" onClick={() => onSectionSelect(section)} className="rounded-md text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {body}
              </button>
            ) : (
              <section key={`${sectionId}-${section.revision}`}>{body}</section>
            )
          })}
        </div>
      ) : null}
    </article>
  )
}

/** Existing design notes call this projection AnalysisDocView. */
export { AnalysisDocument as AnalysisDocView }
