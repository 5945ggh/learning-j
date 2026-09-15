import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ImportMaterialDialog } from '@/components/ImportMaterialDialog'
import { MaterialCard } from '@/components/MaterialCard'
import { CONTENT_BOTTOM, CONTENT_PAD, CONTENT_WIDTH, PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { materialPath, readerPath, studyPath } from '@/app/routes'
import { useRepositories } from '@/app/repository-context'
import { materialsForMode, type LibraryMode } from '@/lib/library'
import { createMaterial, materialCoverUrl } from '@/lib/materials'
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
  const [importOpen, setImportOpen] = useState(false)
  const [activeSessions, setActiveSessions] = useState<StudySessionRecord[]>([])
  const [activeSessionsStatus, setActiveSessionsStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')

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
    setActiveSessionsStatus('loading')
    study.listActiveSessions()
      .then((sessions) => {
        if (disposed) return
        setActiveSessions(sessions)
        setActiveSessionsStatus('ready')
      })
      .catch(() => {
        if (disposed) return
        // An unavailable P3+ projection is not the same fact as zero sessions.
        setActiveSessions([])
        setActiveSessionsStatus('unavailable')
      })
    return () => { disposed = true }
  }, [study])

  const visible = useMemo(() => materialsForMode(materials, mode), [materials, mode])
  const activeCountByMaterial = useMemo(() => {
    const counts = new Map<string, number>()
    for (const session of activeSessions) counts.set(session.material_id, (counts.get(session.material_id) ?? 0) + 1)
    return counts
  }, [activeSessions])

  return (
    <div className={`${CONTENT_WIDTH} ${CONTENT_BOTTOM} bg-canvas`}>
      <PageHeader
        title="素材库"
        subtitle="导入并打开原文与视听素材；学习会话会保留来源材料。"
        actions={(
          <Button type="button" variant="primary" onClick={() => setImportOpen(true)}>
            导入素材
          </Button>
        )}
      />

      <div className={CONTENT_PAD}>
        <p className="rounded-[var(--radius-action)] border border-divider bg-grouped-surface px-4 py-3 text-sm leading-relaxed text-secondary-text">
          素材与句子直接读取本地后端。活动学习会话数量来自真实投影；暂时取不到时会标为“会话状态不可用”，不会按 0 显示。
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-1" role="group" aria-label="素材模式">
          {(Object.keys(MODE_LABELS) as LibraryMode[]).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={mode === candidate}
              onClick={() => setMode(candidate)}
              className={`rounded-[var(--radius-control)] border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === candidate ? 'border-divider bg-opaque-surface font-medium text-text' : 'border-transparent text-secondary-text hover:bg-secondary-grouped-surface'}`}
            >
              {MODE_LABELS[candidate]}（{materialsForMode(materials, candidate).length}）
            </button>
          ))}
        </div>

        {status === 'loading' ? (
          <p role="status" className="mt-5 rounded-[var(--radius-action)] border border-divider bg-opaque-surface px-4 py-8 text-center text-sm text-secondary-text">正在加载素材…</p>
        ) : status === 'error' ? (
          <div role="alert" className="mt-5 rounded-[var(--radius-action)] border border-destructive/40 bg-destructive/5 px-4 py-4 text-sm">
            <p>{error ?? '素材加载失败'}</p>
            <p className="mt-1 text-secondary-text">素材浏览不需要 AI 密钥；请确认本地后端已启动后重试。</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-3 rounded-[var(--radius-control)] border border-divider bg-opaque-surface px-3 py-1.5 font-medium text-text hover:bg-grouped-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">重试</button>
          </div>
        ) : visible.length === 0 ? (
          <p className="mt-5 rounded-[var(--radius-action)] border border-dashed border-divider px-4 py-10 text-center text-sm text-secondary-text">
            {materials.length === 0 ? '还没有素材。导入 txt、srt、vtt 或 EPUB 后会显示在这里。' : mode === 'books' ? '书目里还没有文本或 EPUB 素材。' : '视听里还没有字幕素材。'}
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-5 min-[760px]:grid-cols-[repeat(auto-fill,minmax(196px,1fr))]">
            {visible.map((material) => {
              const firstSession = activeSessions.find((session) => session.material_id === material.id)
              return (
                <MaterialCard
                  key={material.id}
                  material={material}
                  metadata={{
                    active_session_count: activeSessionsStatus === 'ready' ? activeCountByMaterial.get(material.id) ?? 0 : null,
                    active_session_state: activeSessionsStatus,
                    author: material.author,
                    meta_line: `${material.sentence_count} 句`,
                    cover_src: materialCoverUrl(material),
                  }}
                  onOpen={(item) => { void navigate(readerPath(item.id)) }}
                  onOpenQueue={(item) => { void navigate(`/queue?material=${encodeURIComponent(item.id)}`) }}
                  onOpenKnowledge={(item) => { void navigate(`/knowledge?material=${encodeURIComponent(item.id)}`) }}
                  onOpenStudy={firstSession ? (item) => { void navigate(studyPath(firstSession.id, { source: 'library', materialId: item.id, sentenceId: firstSession.source_sentence_ids[0], returnPath: '/library' })) } : undefined}
                  studyFixture={Boolean(firstSession)}
                  onManage={(item) => { void navigate(materialPath(item.id)) }}
                />
              )
            })}
          </div>
        )}
      </div>

      {importOpen ? (
        <ImportMaterialDialog
          onClose={() => setImportOpen(false)}
          onImport={(draft) => createMaterial({ file: draft.file, title: draft.title })}
          onImported={() => {
            // 新素材还没有句子/sidecar，留在列表语境并刷新；详情跳转由用户在卡片上发起。
            setImportOpen(false)
            setAttempt((value) => value + 1)
          }}
        />
      ) : null}
    </div>
  )
}
