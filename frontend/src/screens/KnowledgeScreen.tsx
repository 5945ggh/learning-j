import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { KnowledgeAggregate } from '@/components/KnowledgeAggregate'
import type { KnowledgeAggregateRecord } from '@/components/models'
import { PageFrame, PageHeader, PAGE_PADDING, PlaceholderNote, StatusBlock, FixtureBadge } from '@/screens/Page'
import { readerPath } from '@/app/routes'
import { useRepositories } from '@/app/repository-context'
import type { KnowledgeAggregate as RepositoryAggregate } from '@/lib/knowledge-repository'
import type { ReviewItemRecord } from '@/lib/review-repository'

type LoadState = 'loading' | 'error' | 'ready'

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

function asAggregateRecord(aggregate: RepositoryAggregate, reviews: Map<string, ReviewItemRecord>, sentences: Map<string, string>): KnowledgeAggregateRecord {
  const point = aggregate.knowledge_point
  return {
    id: point.kp_id,
    form: point.display_form ?? point.anchor,
    reading: typeof point.anchor_payload.reading === 'string' ? point.anchor_payload.reading : null,
    kind_label: point.anchor_shape,
    default_retention: point.default_retention,
    // The current P4/P5 projection does not expose a decision event. Keep the
    // UI honest by rendering the fixture value as an initial/default value,
    // never inferring a user action from `default_retention` itself.
    default_retention_set_by: 'default',
    occurrences: aggregate.occurrences.map((occurrence) => ({
      id: occurrence.occurrence_id,
      sentence_id: occurrence.sentence_id,
      material_id: occurrence.material_id,
      sentence_text: sentences.get(occurrence.sentence_id) ?? `Sentence ${occurrence.sentence_id}`,
      spans: occurrence.spans,
      brief: occurrence.brief,
      salience: occurrence.salience,
      retention: occurrence.retention_override,
      effective_retention: occurrence.retention_override === 'inherit' ? point.default_retention : occurrence.retention_override,
      review_status: reviews.get(occurrence.occurrence_id)?.status ?? null,
      source_label: `${occurrence.content_source} · ${occurrence.section_id} v${occurrence.section_revision}`,
    })),
  }
}

export function KnowledgeScreen() {
  const [params] = useSearchParams()
  const materialId = params.get('material') ?? undefined
  const navigate = useNavigate()
  const { knowledge, review, materials } = useRepositories()
  const [aggregates, setAggregates] = useState<KnowledgeAggregateRecord[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    setError(null)
    Promise.all([
      knowledge.listAggregates(materialId ? { material_id: materialId } : {}, { signal: controller.signal }),
      review.listReviewItems({}, { signal: controller.signal }),
    ])
      .then(async ([loadedAggregates, loadedReviews]) => {
        const materialIds = [...new Set(loadedAggregates.flatMap((aggregate) => aggregate.occurrences.map((occurrence) => occurrence.material_id)))]
        const sentenceLists = await Promise.all(materialIds.map((id) => materials.listSentences(id, { signal: controller.signal })))
        const sentences = new Map<string, string>()
        sentenceLists.flat().forEach((sentence) => sentences.set(sentence.id, sentence.text))
        const reviews = new Map(loadedReviews.map((item) => [item.occurrence_id, item]))
        setAggregates(loadedAggregates.map((aggregate) => asAggregateRecord(aggregate, reviews, sentences)))
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return
        setError(cause instanceof Error ? cause.message : '知识库加载失败')
        setState('error')
      })
    return () => controller.abort()
  }, [attempt, knowledge, materialId, materials, review])

  const occurrenceCount = useMemo(() => aggregates.reduce((total, aggregate) => total + aggregate.occurrences.length, 0), [aggregates])

  if (state === 'loading') return <PageFrame><div className={PAGE_PADDING}><StatusBlock status="loading" /></div></PageFrame>
  if (state === 'error') return <PageFrame><div className={PAGE_PADDING}><StatusBlock status="error" error={error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} /></div></PageFrame>

  return (
    <PageFrame>
      <PageHeader title={materialId ? '知识库 · 材料范围' : '知识库'} subtitle={materialId ? `只筛选 material=${materialId}，不改变实体归属。` : `${aggregates.length} 个知识点 · ${occurrenceCount} 条讲解实例`} actions={<FixtureBadge />} />
      <div className={`${PAGE_PADDING} flex flex-col gap-4`}>
        <PlaceholderNote>这里展示 P4/P5 领域形状的 fixture adapter 聚合。KP、Occurrence、用户意愿与 ReviewItem 保持分层；确认和意愿写入待后续后端接口，不在页面里伪造。</PlaceholderNote>
        {aggregates.length === 0 ? <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{materialId ? '该材料范围还没有 fixture 知识点。' : '还没有知识点。'}</div> : aggregates.map((aggregate) => <KnowledgeAggregate key={aggregate.id} aggregate={aggregate} onReturnToSource={(occurrence) => { void navigate(readerPath(occurrence.material_id, occurrence.sentence_id)) }} />)}
        <Link to="/queue" className="self-start rounded-md border border-border px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">去解析队列</Link>
      </div>
    </PageFrame>
  )
}
