import { HighlightedText } from './HighlightedText'
import { Badge, type BadgeTone } from './ui/badge'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'
import type { ReviewCardRecord } from './models'

export type ReviewCardProps = {
  card: ReviewCardRecord
  onOpen?: (card: ReviewCardRecord) => void
  onRate?: (card: ReviewCardRecord, grade: number) => void
  ratingPending?: boolean
  className?: string
}

const STATUS_COPY: Record<ReviewCardRecord['status'], { label: string; tone: BadgeTone }> = {
  queued: { label: '等待新卡配额', tone: 'warning' },
  active: { label: '已加入复习', tone: 'success' },
  paused: { label: '已暂停', tone: 'neutral' },
  retired: { label: '已退役', tone: 'plain' },
}

/** Review projection card. Scheduling and FSRS writes belong to ReviewRepository. */
export function ReviewCard({ card, onOpen, onRate, ratingPending = false, className }: ReviewCardProps) {
  const status = STATUS_COPY[card.status]
  return (
    <article className={cn('flex flex-col gap-3 rounded-md border border-border bg-card p-4 shadow-sm', className)} aria-labelledby={`review-card-${card.id}`}>
      <header className="flex flex-wrap items-center gap-2">
        <h2 id={`review-card-${card.id}`} className="font-serif-jp text-lg">{card.form}</h2>
        {card.reading ? <span className="text-xs text-muted-foreground">{card.reading}</span> : null}
        <Badge tone={status.tone}>{status.label}</Badge>
        {card.material_title ? <span className="ml-auto truncate text-xs text-muted-foreground">{card.material_title}</span> : null}
      </header>
      <p className="font-serif-jp text-base leading-7"><HighlightedText text={card.sentence_text} spans={card.spans} /></p>
      {card.brief ? <p className="text-sm leading-6 text-muted-foreground">{card.brief}</p> : null}
      {card.source_label ? <p className="text-xs text-muted-foreground">来源：{card.source_label}</p> : null}

      {onRate && card.status === 'active' ? (
        <div role="group" aria-label="复习评分" className="flex flex-wrap gap-2 border-t border-border pt-3">
          {[1, 2, 3, 4].map((grade) => (
            <Button key={grade} variant="outline" size="sm" aria-label={`评分 ${grade}`} disabled={ratingPending} onClick={() => onRate(card, grade)}>
              {grade}
            </Button>
          ))}
        </div>
      ) : null}
      {onOpen ? <Button variant="surface" size="sm" className="self-start" onClick={() => onOpen(card)}>{card.status === 'active' ? '开始复习' : '查看详情'}</Button> : null}
      {!onRate && card.status === 'active' ? <p className="text-xs text-muted-foreground">复习评分待接入；不在此处伪造排程进度。</p> : null}
    </article>
  )
}

export { STATUS_COPY as reviewCardStatusCopy }
