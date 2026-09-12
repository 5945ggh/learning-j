import { useCallback, useEffect, useState } from 'react'
import { ContentIndexPanel, type ContentIndexStatus } from '@/components/ContentIndexPanel'
import { MaterialLibrary } from '@/components/MaterialLibrary'
import { SentenceList } from '@/components/SentenceList'
import { SentenceContext } from '@/components/SentenceContext'
import { libraryModeForKind, type LibraryMode } from '@/lib/library'
import {
  fetchLexemeCounts,
  fetchMaterials,
  fetchSentences,
  fetchSidecar,
  type Material,
  type MaterialLexemeCounts,
  type Sentence,
  type Sidecar,
} from '@/lib/materials'

type LoadStatus = 'loading' | 'error' | 'ready'

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

/**
 * 素材浏览 shell（P1：Library/reader 的素材浏览与定位准备）。
 *
 * shell 持有路由与页面状态，装配独立组件（ADR-023）；只做浏览与定位，
 * 不实现 AI 学习、候选、复习，也不伪造阅读活动或播放统计。素材、句子、
 * 内容索引三条加载流各自可取消、可局部重试（DESIGN.md 交互状态：错误
 * 保留所选界面并给出局部重试）。
 */
export function MaterialWorkspace() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [materialsStatus, setMaterialsStatus] = useState<LoadStatus>('loading')
  const [materialsError, setMaterialsError] = useState<string | null>(null)
  const [materialsAttempt, setMaterialsAttempt] = useState(0)

  const [selected, setSelected] = useState<Material | null>(null)
  const [mode, setMode] = useState<LibraryMode>('books')

  const [sentences, setSentences] = useState<Sentence[]>([])
  const [sentenceStatus, setSentenceStatus] = useState<LoadStatus>('loading')
  const [sentenceError, setSentenceError] = useState<string | null>(null)
  const [sentenceAttempt, setSentenceAttempt] = useState(0)
  const [selectedSentence, setSelectedSentence] = useState<Sentence | null>(null)

  const [indexStatus, setIndexStatus] = useState<ContentIndexStatus>('loading')
  const [sidecar, setSidecar] = useState<Sidecar | null>(null)
  const [counts, setCounts] = useState<MaterialLexemeCounts | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [indexAttempt, setIndexAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setMaterialsStatus('loading')
    setMaterialsError(null)
    fetchMaterials(controller.signal)
      .then((items) => {
        setMaterials(items)
        setSelected((current) => current ?? items[0] ?? null)
        setMaterialsStatus('ready')
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return
        setMaterialsError(errorMessage(cause, '素材加载失败'))
        setMaterialsStatus('error')
      })
    return () => controller.abort()
  }, [materialsAttempt])

  useEffect(() => {
    if (!selected) {
      setSentences([])
      setSelectedSentence(null)
      setSentenceStatus('ready')
      setSentenceError(null)
      return
    }
    setSelectedSentence(null)
    const controller = new AbortController()
    setSentenceStatus('loading')
    setSentenceError(null)
    fetchSentences(selected.id, controller.signal)
      .then((items) => {
        setSentences(items)
        setSentenceStatus('ready')
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return
        setSentenceError(errorMessage(cause, '句子加载失败'))
        setSentenceStatus('error')
      })
    return () => controller.abort()
  }, [selected, sentenceAttempt])

  useEffect(() => {
    if (!selected || selected.current_sidecar_id === null) {
      setSidecar(null)
      setCounts(null)
      setIndexError(null)
      setIndexStatus('absent')
      return
    }
    const controller = new AbortController()
    setIndexStatus('loading')
    setIndexError(null)
    setSidecar(null)
    setCounts(null)
    Promise.all([
      fetchSidecar(selected.id, controller.signal),
      fetchLexemeCounts(selected.id, controller.signal),
    ])
      .then(([loadedSidecar, loadedCounts]) => {
        setSidecar(loadedSidecar)
        setCounts(loadedCounts)
        setIndexStatus('ready')
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return
        setIndexError(errorMessage(cause, '内容索引加载失败'))
        setIndexStatus('error')
      })
    return () => controller.abort()
  }, [selected, indexAttempt])

  const selectMaterial = useCallback((material: Material) => {
    setSelected(material)
    setMode(libraryModeForKind(material.kind))
  }, [])

  const retryMaterials = useCallback(() => setMaterialsAttempt((attempt) => attempt + 1), [])
  const retrySentences = useCallback(() => setSentenceAttempt((attempt) => attempt + 1), [])
  const retryIndex = useCallback(() => setIndexAttempt((attempt) => attempt + 1), [])

  if (materialsStatus !== 'ready') {
    return (
      <div className="flex min-h-48 items-center justify-center px-6">
        {materialsStatus === 'loading' ? (
          <p role="status" className="text-sm text-muted-foreground">正在加载素材…</p>
        ) : (
          <div role="alert" className="w-full max-w-md rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p>{materialsError ?? '素材加载失败'}</p>
            <p className="mt-1 text-muted-foreground">素材浏览不依赖 BYOK；请确认本地后端已启动后重试。</p>
            <button
              type="button"
              onClick={retryMaterials}
              className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              重试
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(240px,0.32fr)_minmax(0,1fr)]">
      <aside className="rounded-md border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Library</h2>
        <MaterialLibrary
          status="ready"
          materials={materials}
          error={null}
          mode={mode}
          onModeChange={setMode}
          selectedId={selected?.id ?? null}
          onSelect={selectMaterial}
          onRetry={retryMaterials}
        />
      </aside>
      <section className="min-w-0 space-y-6">
        {sentenceStatus === 'loading' ? (
          <div role="status" className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
            正在加载句子…
          </div>
        ) : sentenceStatus === 'error' ? (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p>{sentenceError ?? '句子加载失败'}</p>
            <button
              type="button"
              onClick={retrySentences}
              className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              重试
            </button>
          </div>
        ) : (
          <SentenceList
            material={selected}
            sentences={sentences}
            selectedId={selectedSentence?.id}
            onSelect={setSelectedSentence}
          />
        )}
        {selectedSentence ? <SentenceContext sentence={selectedSentence} /> : null}
        {selected ? (
          <ContentIndexPanel
            status={indexStatus}
            sidecar={sidecar}
            counts={counts}
            error={indexError}
            onRetry={retryIndex}
          />
        ) : null}
      </section>
    </div>
  )
}
