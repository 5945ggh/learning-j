import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Clock3 } from 'lucide-react'
import { ReviewCard } from '@/components/ReviewCard'
import type { ReviewCardRecord } from '@/components/models'
import { PageFrame, PageHeader, PAGE_PADDING, Panel, PlaceholderNote, StatusBlock, FixtureBadge } from '@/screens/Page'
import { readerPath, studyPath } from '@/app/routes'
import { useRepositories } from '@/app/repository-context'
import type { KnowledgeOccurrenceRecord, KnowledgePointRecord } from '@/lib/knowledge-repository'
import type { ReviewItemRecord } from '@/lib/review-repository'
import type { StudySessionRecord } from '@/lib/study-repository'

type LoadState = 'loading' | 'error' | 'ready'

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

function toCard(item: ReviewItemRecord, occurrence: KnowledgeOccurrenceRecord | undefined, point: KnowledgePointRecord | undefined, sentenceText: string | undefined): ReviewCardRecord | null {
  if (!occurrence) return null
  return {
    id: item.review_item_id,
    form: point?.display_form ?? point?.anchor ?? '复习项',
    reading: null,
    sentence_text: sentenceText ?? `Sentence ${occurrence.sentence_id}`,
    spans: occurrence.spans,
    brief: occurrence.brief,
    status: item.status,
    material_title: occurrence.material_id,
    source_label: `${occurrence.content_source} · ${occurrence.section_id} v${occurrence.section_revision}`,
  }
}

function ReviewRow({ item, occurrence, point, session, sentenceText }: { item: ReviewItemRecord; occurrence: KnowledgeOccurrenceRecord | undefined; point: KnowledgePointRecord | undefined; session: StudySessionRecord | undefined; sentenceText?: string }) {
  const card = toCard(item, occurrence, point, sentenceText)
  if (!card || !occurrence) return null
  return (
    <article className="border-b border-border px-4 py-4 last:border-b-0">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {item.status === 'queued' ? <Clock3 className="size-3.5" aria-label="等待新卡配额" /> : null}
        <span>{item.status === 'queued' ? '等待新卡配额' : item.status === 'active' ? '新卡' : item.status === 'paused' ? '已暂停' : '已退役'}</span>
        <FixtureBadge />
        {item.admitted_at ? <span>准入 {item.admitted_at}</span> : <span>尚未准入</span>}
      </div>
      <ReviewCard card={card} />
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {session ? <Link to={studyPath(session.id, { source: 'center', materialId: occurrence.material_id, sentenceId: occurrence.sentence_id, returnPath: '/center' })} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">打开 Study<ArrowRight className="size-4" aria-hidden="true" /></Link> : null}
        <Link to={readerPath(occurrence.material_id, occurrence.sentence_id)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">回到来源</Link>
      </div>
    </article>
  )
}

export function CenterScreen() {
  const { review, knowledge, study, materials } = useRepositories()
  const [items, setItems] = useState<ReviewItemRecord[]>([])
  const [occurrences, setOccurrences] = useState<KnowledgeOccurrenceRecord[]>([])
  const [points, setPoints] = useState<KnowledgePointRecord[]>([])
  const [history, setHistory] = useState<StudySessionRecord[]>([])
  const [allSessions, setAllSessions] = useState<StudySessionRecord[]>([])
  const [sentenceTextById, setSentenceTextById] = useState<Map<string, string>>(new Map())
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    setError(null)
    Promise.all([
      review.listReviewItems({}, { signal: controller.signal }),
      knowledge.listOccurrences({}, { signal: controller.signal }),
      knowledge.listKnowledgePoints({ signal: controller.signal }),
      study.listHistory(undefined, { signal: controller.signal }),
      study.listSessions({}, { signal: controller.signal }),
    ])
      .then(async ([loadedItems, loadedOccurrences, loadedPoints, loadedHistory, loadedSessions]) => {
        setItems(loadedItems)
        setOccurrences(loadedOccurrences)
        setPoints(loadedPoints)
        setHistory(loadedHistory)
        setAllSessions(loadedSessions)
        const materialIds = [...new Set(loadedOccurrences.map((occurrence) => occurrence.material_id))]
        const sentenceLists = await Promise.all(materialIds.map((id) => materials.listSentences(id, { signal: controller.signal })))
        const textById = new Map<string, string>()
        sentenceLists.flat().forEach((sentence) => textById.set(sentence.id, sentence.text))
        setSentenceTextById(textById)
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return
        setError(cause instanceof Error ? cause.message : '学习中心加载失败')
        setState('error')
      })
    return () => controller.abort()
  }, [attempt, knowledge, materials, review, study])

  const byOccurrence = useMemo(() => new Map(occurrences.map((occurrence) => [occurrence.occurrence_id, occurrence])), [occurrences])
  const byPoint = useMemo(() => new Map(points.map((point) => [point.kp_id, point])), [points])
  const bySession = useMemo(() => new Map(allSessions.map((session) => [session.id, session])), [allSessions])
  const queued = items.filter((item) => item.status === 'queued')
  const active = items.filter((item) => item.status === 'active')
  const paused = items.filter((item) => item.status === 'paused')

  if (state === 'loading') return <PageFrame><div className={PAGE_PADDING}><StatusBlock status="loading" /></div></PageFrame>
  if (state === 'error') return <PageFrame><div className={PAGE_PADDING}><StatusBlock status="error" error={error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} /></div></PageFrame>

  const section = (title: string, list: ReviewItemRecord[], empty: string) => (
    <Panel title={title} hint={`${list.length} 项`}>
      {list.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">{empty}</p> : list.map((item) => {
        const occurrence = byOccurrence.get(item.occurrence_id)
        return <ReviewRow key={item.review_item_id} item={item} occurrence={occurrence} point={occurrence ? byPoint.get(occurrence.kp_id) : undefined} sentenceText={occurrence ? sentenceTextById.get(occurrence.sentence_id) : undefined} session={occurrence ? bySession.get(occurrence.source_analysis_id.replace(/^analysis-/, '')) : undefined} />
      })}
    </Panel>
  )

  return (
    <PageFrame>
      <PageHeader title="学习中心" subtitle="学习计划、复习与学习记录的聚合入口。" actions={<FixtureBadge />} />
      <div className={`${PAGE_PADDING} flex flex-col gap-4`}>
        <PlaceholderNote>复习状态来自 P5 前的 fixture adapter。queued 是“等待新卡配额”，active 是已准入的新卡；两者不能混为“已加入复习”。真实排程与 ReviewState 在 P5 接入。</PlaceholderNote>
        {section('等待新卡配额', queued, '没有等待配额的复习项。')}
        {section('新卡', active, '今天没有待学的新卡。')}
        <Panel title="今日到期" hint="排程 API 待接入"><p className="px-4 py-6 text-sm text-muted-foreground">今日到期集合尚未由后端提供。</p></Panel>
        <Panel title="暂停与学习记录" hint={`${paused.length + history.length} 项`}>
          {paused.length === 0 && history.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">还没有暂停项或学习记录。</p> : (
            <div className="flex flex-col">
              {paused.map((item) => {
                const occurrence = byOccurrence.get(item.occurrence_id)
                return <ReviewRow key={item.review_item_id} item={item} occurrence={occurrence} point={occurrence ? byPoint.get(occurrence.kp_id) : undefined} sentenceText={occurrence ? sentenceTextById.get(occurrence.sentence_id) : undefined} session={occurrence ? bySession.get(occurrence.source_analysis_id.replace(/^analysis-/, '')) : undefined} />
              })}
              {history.map((session) => <article key={session.id} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-4 last:border-b-0"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px]">{session.status === 'parked' ? '已搁置' : '已完成'}</span><FixtureBadge /></div><h3 className="mt-2 text-sm font-medium">学习会话 {session.id}</h3><p className="mt-1 text-xs text-muted-foreground">阶段 {session.phase} · 返回位置 {session.return_position ? '已记录' : '未记录'}</p></div><Link to={studyPath(session.id, { source: 'center', materialId: session.material_id, sentenceId: session.source_sentence_ids[0], returnPath: '/center' })} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">查看会话</Link></article>)}
            </div>
          )}
        </Panel>
      </div>
    </PageFrame>
  )
}
