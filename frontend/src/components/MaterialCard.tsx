import type { Material } from '@/lib/materials'
import { cn } from '@/lib/utils'

export type MaterialCardMetadata = {
  /** Optional presentation metadata supplied by the repository projection. */
  author?: string | null
  meta_line?: string | null
  cover_src?: string | null
  progress?: number | null
  active_session_count?: number
  /** Prototype naming aliases kept at the presentation boundary only. */
  metaLine?: string | null
  coverSrc?: string | null
  activeSessionCount?: number
}

/** Optional prototype presentation fields may also travel with a card row. */
export type MaterialCardSource = Material & {
  author?: string | null
  metaLine?: string | null
  coverSrc?: string | null
}

export type MaterialCardProps = {
  material: MaterialCardSource
  metadata?: MaterialCardMetadata
  onOpen?: (material: Material) => void
  onOpenQueue?: (material: Material) => void
  onOpenKnowledge?: (material: Material) => void
  /** Study navigation is supplied by the owning shell; the card stays route-free. */
  onOpenStudy?: (material: Material) => void
  studyFixture?: boolean
  /** Material management is intentionally callback-only; no implicit route/action. */
  onManage?: (material: Material) => void
  className?: string
}

function kindLabel(kind: Material['kind']): string {
  switch (kind) {
    case 'epub':
      return 'EPUB'
    case 'text':
      return '文本'
    case 'subtitle_audio':
      return '音频'
    case 'subtitle_video':
      return '视频'
  }
}

/**
 * Material card migrated from the prototype.
 *
 * The card only emits intent callbacks. It never imports a shell/router and
 * never derives session state from local storage or prototype reducers.
 */
export function MaterialCard({
  material,
  metadata,
  onOpen,
  onOpenQueue,
  onOpenKnowledge,
  onOpenStudy,
  studyFixture = false,
  onManage,
  className,
}: MaterialCardProps) {
  const cover = metadata?.cover_src ?? metadata?.coverSrc ?? material.coverSrc ?? null
  const queueCount = metadata?.active_session_count ?? metadata?.activeSessionCount ?? 0
  const progress = metadata?.progress ?? null
  const metaLine = metadata?.meta_line ?? metadata?.metaLine ?? material.metaLine ?? null
  const author = metadata?.author ?? material.author ?? null
  const isBook = material.kind === 'epub' || material.kind === 'text'

  return (
    <article
      className={cn(
        'group flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0',
        className,
      )}
    >
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(material)}
          aria-label={`打开《${material.title}》`}
          className={cn('relative block w-full overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset', isBook ? 'aspect-[5/7]' : 'aspect-video')}
        >
          {cover ? <img src={cover} alt="" loading="lazy" className="absolute inset-0 size-full object-cover transition-transform group-hover:scale-[1.03] motion-reduce:group-hover:scale-100" /> : <span className="absolute inset-0 grid place-items-center px-3 text-center font-serif-jp text-sm text-muted-foreground">{material.title}</span>}
        </button>
      ) : (
        <div className={cn('relative block w-full overflow-hidden bg-muted', isBook ? 'aspect-[5/7]' : 'aspect-video')}>
          {cover ? <img src={cover} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" /> : <span className="absolute inset-0 grid place-items-center px-3 text-center font-serif-jp text-sm text-muted-foreground">{material.title}</span>}
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold" title={material.title}>{material.title}</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {kindLabel(material.kind)}{author ? ` · ${author}` : ''}{metaLine ? ` · ${metaLine}` : ''}
            </p>
          </div>
          {onManage ? (
            <button
              type="button"
              aria-label={`管理《${material.title}》`}
              onClick={() => onManage(material)}
              className="shrink-0 rounded-md px-2 py-1 text-lg leading-none text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              ⋯
            </button>
          ) : null}
        </div>

        {progress !== null ? (
          <div aria-label="阅读进度" className="flex items-center gap-2">
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-study" style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} />
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{Math.round(Math.max(0, Math.min(1, progress)) * 100)}%</span>
          </div>
        ) : null}

        <div className="flex min-h-6 items-center gap-2 text-xs">
          {onOpenQueue && queueCount > 0 ? (
            <button type="button" onClick={() => onOpenQueue(material)} className="font-medium text-study underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              解析队列 {queueCount}
            </button>
          ) : queueCount > 0 ? (
            <span className="text-muted-foreground">解析队列 {queueCount}</span>
          ) : null}
          {onOpenKnowledge ? (
            <button type="button" onClick={() => onOpenKnowledge(material)} className="ml-auto text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              知识库
            </button>
          ) : null}
          {onOpenStudy ? (
            <button type="button" onClick={() => onOpenStudy(material)} className="ml-auto font-medium text-ai underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              打开 Study{studyFixture ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">（fixture）</span> : null}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  )
}
