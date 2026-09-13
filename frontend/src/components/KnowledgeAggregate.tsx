import { HighlightedText } from './HighlightedText'
import { Badge } from './ui/badge'
import { cn } from '@/lib/utils'
import type { KnowledgeAggregate as RepositoryKnowledgeAggregate, KnowledgeOccurrenceRecord as RepositoryKnowledgeOccurrence } from '@/lib/knowledge-repository'
import type { KnowledgeAggregateRecord, KnowledgeOccurrenceRecord, RetentionChoice, ReviewStatus } from './models'

type KnowledgeAggregateInput = KnowledgeAggregateRecord | RepositoryKnowledgeAggregate
type KnowledgeOccurrenceInput = KnowledgeOccurrenceRecord | RepositoryKnowledgeOccurrence

export type KnowledgeAggregateProps = {
  aggregate: KnowledgeAggregateInput
  onRetentionChange?: (occurrence: KnowledgeOccurrenceInput, retention: RetentionChoice) => void
  onReturnToSource?: (occurrence: KnowledgeOccurrenceInput) => void
  /** Repository adapters can supply source text without making the component fetch it. */
  sentenceTextById?: (sentenceId: string) => string | null
  className?: string
}

function retentionLabel(retention: RetentionChoice): string {
  switch (retention) {
    case 'srs':
      return '安排复习'
    case 'reference':
      return '仅作参考'
    case 'inherit':
      return '沿用默认'
  }
}

function reviewStatusLabel(status: ReviewStatus | null | undefined, retention: RetentionChoice): { label: string; tone: 'neutral' | 'warning' | 'success' | 'plain' } {
  if (!status) return retention === 'reference' ? { label: '仅作参考', tone: 'neutral' } : { label: '尚未加入', tone: 'plain' }
  switch (status) {
    case 'queued':
      return { label: '等待新卡配额', tone: 'warning' }
    case 'active':
      return { label: '已加入复习', tone: 'success' }
    case 'paused':
      return { label: '已暂停', tone: 'neutral' }
    case 'retired':
      return { label: '已退役', tone: 'plain' }
  }
}

function RetentionChoiceControl({ occurrence, original, onChange }: { occurrence: KnowledgeOccurrenceRecord; original: KnowledgeOccurrenceInput; onChange?: KnowledgeAggregateProps['onRetentionChange'] }) {
  const options: RetentionChoice[] = ['inherit', 'srs', 'reference']
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Occurrence 复习意愿" className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={occurrence.retention === option}
            disabled={!onChange}
            title={!onChange ? '由外层接线后可修改' : undefined}
            onClick={() => onChange?.(original, option)}
            className={cn('rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60', occurrence.retention === option ? 'border-border bg-muted font-medium' : 'border-transparent text-muted-foreground hover:bg-muted')}
          >
            {retentionLabel(option)}
          </button>
        ))}
      </div>
      <span className="text-xs text-muted-foreground">
        当前有效：{retentionLabel(occurrence.effective_retention ?? occurrence.retention)}{occurrence.retention === 'inherit' ? '（继承 KP 默认）' : ''}
      </span>
    </div>
  )
}

/**
 * KnowledgePoint aggregate with per-Occurrence context and retention.
 * Grouping is display-only: callbacks always identify the individual
 * occurrence, so KP folding cannot change confirmation granularity.
 */
export function KnowledgeAggregate({ aggregate, onRetentionChange, onReturnToSource, sentenceTextById, className }: KnowledgeAggregateProps) {
  const view = normalizeAggregate(aggregate, sentenceTextById)
  return (
    <section className={cn('overflow-hidden rounded-md border border-border bg-card shadow-sm', className)} aria-labelledby={`knowledge-aggregate-${view.id}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-3">
        <h2 id={`knowledge-aggregate-${view.id}`} className="font-serif-jp text-lg">{view.form}</h2>
        {view.reading ? <span className="text-xs text-muted-foreground">{view.reading}</span> : null}
        {view.kind_label ? <Badge tone="plain">{view.kind_label}</Badge> : null}
        <span className="ml-auto text-xs text-muted-foreground">
          默认复习策略 <Badge tone={view.default_retention === 'srs' ? 'lexical' : 'neutral'}>{retentionLabel(view.default_retention)}</Badge>{view.default_retention_set_by === 'default' ? '（初值）' : '（用户设定）'}
        </span>
      </header>

      {view.occurrences.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">这个知识点还没有讲解实例。</p>
      ) : (
        <div>
          {view.occurrences.map((occurrence) => {
            const review = reviewStatusLabel(occurrence.view.review_status, occurrence.view.effective_retention ?? occurrence.view.retention)
            return (
              <article key={occurrence.view.id} className="flex flex-col gap-2 border-b border-border px-3 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={review.tone}>{review.label}</Badge>
                  {occurrence.view.salience === 'primary' ? <Badge tone="plain">主要候选</Badge> : null}
                  {occurrence.view.source_label ? <span className="text-xs text-muted-foreground">{occurrence.view.source_label}</span> : null}
                  {onReturnToSource ? <button type="button" onClick={() => onReturnToSource(occurrence.original)} className="ml-auto text-xs font-medium text-study hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">回到来源</button> : null}
                </div>
                <p className="font-serif-jp text-base leading-7"><HighlightedText text={occurrence.sentence_text} spans={occurrence.spans} /></p>
                <p className="text-sm leading-6 text-muted-foreground">{occurrence.brief}</p>
                <RetentionChoiceControl occurrence={occurrence.view} original={occurrence.original} onChange={onRetentionChange} />
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

type KnowledgeOccurrenceView = {
  view: KnowledgeOccurrenceRecord
  original: KnowledgeOccurrenceInput
  sentence_text: string
  spans: Array<{ start: number; end: number }>
  brief: string
}

type KnowledgeAggregateView = {
  id: string
  form: string
  reading: string | null
  kind_label: string | null
  default_retention: 'srs' | 'reference'
  default_retention_set_by: 'default' | 'user'
  occurrences: KnowledgeOccurrenceView[]
}

function normalizeAggregate(input: KnowledgeAggregateInput, sentenceTextById?: (sentenceId: string) => string | null): KnowledgeAggregateView {
  if ('knowledge_point' in input) {
    const point = input.knowledge_point
    return {
      id: point.kp_id,
      form: point.display_form ?? point.anchor,
      reading: null,
      kind_label: point.anchor_shape,
      default_retention: point.default_retention,
      // The current unstable repository projection does not expose the
      // default's author; keep the UI honest instead of inferring user intent.
      default_retention_set_by: 'default',
      occurrences: input.occurrences.map((occurrence) => ({
        view: {
          id: occurrence.occurrence_id,
          sentence_id: occurrence.sentence_id,
          material_id: occurrence.material_id,
          sentence_text: sentenceTextById?.(occurrence.sentence_id) ?? `来源句子 ${occurrence.sentence_id}`,
          spans: occurrence.spans,
          brief: occurrence.brief,
          salience: occurrence.salience,
          retention: occurrence.retention_override,
          effective_retention: occurrence.retention_override === 'inherit' ? point.default_retention : occurrence.retention_override,
          review_status: null,
          source_label: occurrence.content_source,
        },
        original: occurrence,
        sentence_text: sentenceTextById?.(occurrence.sentence_id) ?? `来源句子 ${occurrence.sentence_id}`,
        spans: occurrence.spans.map((span) => ({ start: span.char_start, end: span.char_end })),
        brief: occurrence.brief,
      })),
    }
  }

  return {
    id: input.id,
    form: input.form,
    reading: input.reading ?? null,
    kind_label: input.kind_label ?? null,
    default_retention: input.default_retention,
    default_retention_set_by: input.default_retention_set_by,
    occurrences: input.occurrences.map((occurrence) => ({
      view: occurrence,
      original: occurrence,
      sentence_text: occurrence.sentence_text,
      spans: occurrence.spans.map((span) => {
        if ('char_start' in span) return { start: span.char_start, end: span.char_end }
        return { start: span.start, end: span.end }
      }),
      brief: occurrence.brief,
    })),
  }
}

export { reviewStatusLabel }
