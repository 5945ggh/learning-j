import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MaterialCard } from '@/components/MaterialCard'
import { CONTENT_BOTTOM, CONTENT_PAD, CONTENT_WIDTH, PageHeader, PlaceholderNote } from '@/components/PageHeader'
import { materialPath, studyPath } from '@/app/routes'
import { useRepositories } from '@/app/repository-context'
import { materialsForMode, type LibraryMode } from '@/lib/library'
import type { Material } from '@/lib/materials'
import type { StudySessionRecord } from '@/lib/study-repository'

type LoadState = 'loading' | 'error' | 'ready'

const MODE_LABELS: Record<LibraryMode, string> = { books: '书目', audiovisual: '视听' }

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

/** P1/P2 material reads are always supplied by the API adapter in production. */
export function LibraryScreen() {
  const navigate = useNavigate()
  const { materials: repository, study } = useRepositories()
  const [materials, setMaterials] = useState<Material[]>([])
  const [status, setStatus] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [mode, setMode] = useState<LibraryMode>('books')
  const [activeSessions, setActiveSessions] = useState<StudySessionRecord[]>([])

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    setError(null)
    repository.listMaterials({ signal: controller.signal })
      .then((items) => {
        setMaterials(items)
        setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return
        setError(cause instanceof Error ? cause.message : '素材加载失败')
        setStatus('error')
      })
    return () => controller.abort()
  }, [attempt, repository])

  useEffect(() => {
    let disposed = false
    study.listActiveSessions()
      .then((sessions) => { if (!disposed) setActiveSessions(sessions) })
      .catch(() => { if (!disposed) setActiveSessions([]) })
    return () => { disposed = true }
  }, [study])

  const visible = useMemo(() => materialsForMode(materials, mode), [materials, mode])
  const activeCountByMaterial = useMemo(() => {
    const counts = new Map<string, number>()
    for (const session of activeSessions) counts.set(session.material_id, (counts.get(session.material_id) ?? 0) + 1)
    return counts
  }, [activeSessions])

  return (
    <div className={`${CONTENT_WIDTH} ${CONTENT_BOTTOM}`}>
      <PageHeader
        title="素材库"
        subtitle="原文与视听素材来自 P1/P2 API；学习会话入口会保留来源材料。"
        actions={(
          <button
            type="button"
            disabled
            title="导入素材待实现"
            className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground"
          >
            导入素材（待实现）
          </button>
        )}
      />

      <div className={CONTENT_PAD}>
        <PlaceholderNote>
          素材文本、句子、token 与内容索引只从真实 API 读取；本页不会使用 demo 的近似分词器。P3+ 学习会话入口若显示 fixture，会带有明确标识。
        </PlaceholderNote>

        <div className="mt-5 flex flex-wrap items-center gap-1" role="group" aria-label="素材模式">
          {(Object.keys(MODE_LABELS) as LibraryMode[]).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={mode === candidate}
              onClick={() => setMode(candidate)}
              className={`rounded-md border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === candidate ? 'border-foreground bg-muted font-medium' : 'border-transparent text-muted-foreground hover:bg-muted'}`}
            >
              {MODE_LABELS[candidate]}（{materialsForMode(materials, candidate).length}）
            </button>
          ))}
        </div>

        {status === 'loading' ? (
          <p role="status" className="mt-5 rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">正在加载素材…</p>
        ) : status === 'error' ? (
          <div role="alert" className="mt-5 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-4 text-sm">
            <p>{error ?? '素材加载失败'}</p>
            <p className="mt-1 text-muted-foreground">素材浏览不依赖 BYOK；请确认本地后端已启动后重试。</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">重试</button>
          </div>
        ) : visible.length === 0 ? (
          <p className="mt-5 rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            {materials.length === 0 ? '还没有素材。导入 txt、srt、vtt 或 EPUB 后会显示在这里。' : mode === 'books' ? '书目里还没有文本或 EPUB 素材。' : '视听里还没有字幕素材。'}
          </p>
        ) : (
          <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4 min-[760px]:grid-cols-[repeat(auto-fill,minmax(196px,1fr))]">
            {visible.map((material) => {
              const firstSession = activeSessions.find((session) => session.material_id === material.id)
              return (
                <MaterialCard
                  key={material.id}
                  material={material}
                  metadata={{ active_session_count: activeCountByMaterial.get(material.id) ?? 0, meta_line: `${material.sentence_count} 句` }}
                  onOpen={(item) => { void navigate(materialPath(item.id)) }}
                  onOpenQueue={(item) => { void navigate(`/queue?material=${encodeURIComponent(item.id)}`) }}
                  onOpenKnowledge={(item) => { void navigate(`/knowledge?material=${encodeURIComponent(item.id)}`) }}
                  onOpenStudy={firstSession ? (item) => { void navigate(studyPath(firstSession.id, { source: 'library', materialId: item.id, sentenceId: firstSession.source_sentence_ids[0], returnPath: '/library' })) } : undefined}
                  studyFixture={Boolean(firstSession)}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
