import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { PauseCircle } from 'lucide-react'
import { SessionList } from '@/components/SessionList'
import type { SessionPhase, SessionRecord } from '@/components/models'
import { PageFrame, PageHeader, PAGE_PADDING, Panel, PlaceholderNote, StatusBlock, FixtureBadge, UnavailableBadge } from '@/screens/Page'
import { readerPath, studyPath } from '@/app/routes'
import { useRepositories } from '@/app/repository-context'
import type { StudySessionRecord } from '@/lib/study-repository'

type LoadState = 'loading' | 'error' | 'ready'
const PHASES: Array<SessionPhase | 'all'> = ['all', 'preparation', 'discussion', 'extraction', 'confirmation']
const PHASE_LABEL: Record<SessionPhase, string> = { preparation: '准备中', discussion: '可讨论', extraction: '提取中', confirmation: '待确认' }

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

function toListRecord(session: StudySessionRecord, sentenceTexts: Map<string, string>): SessionRecord {
  return {
    id: session.id,
    phase: session.phase,
    status: session.status,
    mode: session.mode,
    material_title: session.material_id,
    source_text: session.source_sentence_ids[0]
      ? sentenceTexts.get(session.source_sentence_ids[0]) ?? `来源 Sentence ${session.source_sentence_ids[0]}`
      : null,
    created_at: session.created_at,
  }
}

export function QueueScreen() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const materialId = searchParams.get('material')
  const { study, materials } = useRepositories()
  const [allSessions, setAllSessions] = useState<StudySessionRecord[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<SessionPhase | 'all'>('all')
  const [includeParked, setIncludeParked] = useState(false)
  const [sentenceTexts, setSentenceTexts] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    setError(null)
    study.listSessions(materialId ? { material_id: materialId } : {}, { signal: controller.signal })
      .then(async (sessions) => {
        setAllSessions(sessions)
        const materialIds = [...new Set(sessions.map((session) => session.material_id))]
        const lists = await Promise.all(materialIds.map((id) => materials.listSentences(id, { signal: controller.signal })))
        const texts = new Map<string, string>()
        lists.flat().forEach((sentence) => texts.set(sentence.id, sentence.text))
        setSentenceTexts(texts)
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return
        setError(cause instanceof Error ? cause.message : '解析队列加载失败')
        setState('error')
      })
    return () => controller.abort()
  }, [attempt, materialId, materials, study])

  const sessions = useMemo(() => allSessions.filter((session) => {
    // Completed sessions belong to 学习记录/学习中心, not the active queue.
    if (session.status === 'completed') return false
    if (!includeParked && session.status !== 'active') return false
    if (phase !== 'all' && session.phase !== phase) return false
    return true
  }), [allSessions, includeParked, phase])
  const activeCount = allSessions.filter((session) => session.status === 'active').length
  const listRecords = sessions.map((session) => toListRecord(session, sentenceTexts))
  const queueReturnPath = materialId ? `/queue?material=${encodeURIComponent(materialId)}` : '/queue'

  return (
    <PageFrame>
      <PageHeader title="解析队列" subtitle={materialId ? `材料范围：${materialId}` : `未完成的学习会话视图 · ${activeCount} 项 active`} actions={<FixtureBadge />} />
      <div className={`${PAGE_PADDING} flex flex-col gap-4`}>
        <PlaceholderNote>会话状态来自 P3+ fixture adapter；阶段只是筛选，不是第二个队列。真实任务排队、重试、取消与恢复由 P3a API 接入，本页不使用 timer 冒充进度。</PlaceholderNote>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="队列阶段筛选">
          {PHASES.map((candidate) => (
            <button key={candidate} type="button" aria-pressed={phase === candidate} onClick={() => setPhase(candidate)} className={`rounded-md border px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${phase === candidate ? 'border-foreground bg-muted font-medium' : 'border-border hover:bg-muted'}`}>
              {candidate === 'all' ? '全部阶段' : PHASE_LABEL[candidate]}
            </button>
          ))}
          <button type="button" aria-pressed={includeParked} onClick={() => setIncludeParked((value) => !value)} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <PauseCircle className="size-3.5" aria-hidden="true" />{includeParked ? '隐藏已搁置' : '显示已搁置'}
          </button>
        </div>

        {state === 'loading' ? <StatusBlock status="loading" /> : state === 'error' ? <StatusBlock status="error" error={error ?? undefined} onRetry={() => setAttempt((value) => value + 1)} /> : (
          <Panel title={materialId ? '材料会话列表' : '未完成会话'} hint={`${sessions.length} 项 · fixture`}>
            {sessions.length === 0 ? <SessionList sessions={[]} emptyNote={materialId ? '该材料目前没有可显示的 fixture 会话。' : '当前筛选下没有未完成会话。'} /> : (
              <div className="flex flex-col">
                <SessionList
                  sessions={listRecords}
                  onSelect={(record) => {
                    const source = allSessions.find((candidate) => candidate.id === record.id)
                    if (source) void navigate(studyPath(source.id, { source: 'queue', materialId: source.material_id, sentenceId: source.source_sentence_ids[0], returnPath: queueReturnPath }))
                  }}
                />
                {sessions.map((session) => (
                  <div key={`${session.id}-actions`} className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 text-xs">
                    <span className="text-muted-foreground">{session.phase === 'extraction' || session.phase === 'confirmation' ? '该阶段流程' : '来源语境'}：{session.source_sentence_ids[0] ?? '未记录'}</span>
                    {(session.phase === 'extraction' || session.phase === 'confirmation') && <UnavailableBadge />}
                    <Link to={studyPath(session.id, { source: 'queue', materialId: session.material_id, sentenceId: session.source_sentence_ids[0], returnPath: queueReturnPath })} className="ml-auto rounded-md border border-border px-2.5 py-1.5 text-foreground hover:bg-muted">打开 Study</Link>
                    <Link to={readerPath(session.material_id, session.source_sentence_ids[0])} className="rounded-md border border-border px-2.5 py-1.5 text-foreground hover:bg-muted">回到来源</Link>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        )}

        <p className="text-xs text-muted-foreground">提取与确认不是本包的 fixture 流程；进入这些阶段只展示状态和明确的待实现边界。</p>
      </div>
    </PageFrame>
  )
}
