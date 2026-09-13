import type { MaterialKind } from '@/lib/materials'
import { cn } from '@/lib/utils'
import { Badge } from './ui/badge'
import type { ChapterRecord } from './models'

export type ChapterListStatus = 'loading' | 'ready' | 'empty' | 'error'
export type ChapterKind = MaterialKind | 'book' | 'av'

export type ChapterListProps = {
  chapters: readonly ChapterRecord[]
  kind: ChapterKind
  status?: ChapterListStatus
  error?: string | null
  onRetry?: () => void
  onSelect?: (chapter: ChapterRecord) => void
  selectedId?: string | null
  ariaLabel?: string
  className?: string
}

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

function chapterLabel(index: number, kind: ChapterKind): string {
  const numeral = NUMERALS[index - 1] ?? String(index)
  return kind === 'subtitle_video' || kind === 'subtitle_audio' || kind === 'av' ? `第${numeral}話` : `第${numeral}章`
}

function progressValue(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

/**
 * Chapter/episode list migrated from the material detail prototype.
 *
 * Chapter data is a repository-provided projection (P3+ may replace the
 * fixture adapter). Only imported rows are actionable; navigation remains an
 * `onSelect` callback owned by the shell.
 */
export function ChapterList({
  chapters,
  kind,
  status = 'ready',
  error = null,
  onRetry,
  onSelect,
  selectedId = null,
  ariaLabel = '章节列表',
  className,
}: ChapterListProps) {
  if (status === 'loading') return <p role="status" className="py-8 text-center text-sm text-muted-foreground">正在加载章节…</p>
  if (status === 'error') {
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p>{error ?? '章节加载失败'}</p>
        {onRetry ? <button type="button" onClick={onRetry} className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">重试</button> : null}
      </div>
    )
  }
  if (status === 'empty' || chapters.length === 0) {
    return <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">这个素材还没有可显示的章节。</p>
  }

  const current = chapters.find((chapter) => chapter.imported && progressValue(chapter.progress) > 0)
  return (
    <ol aria-label={ariaLabel} className={cn('overflow-hidden rounded-md border border-border', className)}>
      {chapters.map((chapter) => {
        const progress = progressValue(chapter.progress)
        const currentRow = current?.id === chapter.id
        const content = (
          <>
            <span className={cn('w-14 shrink-0 text-sm', currentRow ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              {chapter.title || chapterLabel(chapter.index, kind)}
            </span>
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <span className={cn('block h-full rounded-full transition-[width]', progress >= 1 ? 'bg-emerald-600' : 'bg-study')} style={{ width: `${progress * 100}%` }} />
            </span>
            <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{progress > 0 ? `${Math.round(progress * 100)}%` : '未开始'}</span>
            {currentRow ? <Badge tone="success">在读</Badge> : null}
          </>
        )
        return chapter.imported && onSelect ? (
          <li key={chapter.id}>
            <button type="button" aria-pressed={selectedId === chapter.id} onClick={() => onSelect(chapter)} className="flex w-full items-center gap-3 border-b border-border px-3.5 py-3 text-left last:border-b-0 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
              {content}
            </button>
          </li>
        ) : (
          <li key={chapter.id} className="flex items-center gap-3 border-b border-border px-3.5 py-3 last:border-b-0">{content}</li>
        )
      })}
    </ol>
  )
}
