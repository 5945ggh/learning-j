import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchPublication, publicationChapterUrl, type Publication, type PublicationSpine } from './publication-repository'

type LoadState = 'loading' | 'error' | 'ready'
type FrameState = 'loading' | 'ready' | 'error'

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

/**
 * The publication controller owns only publication/chapter lifecycle.  It is
 * intentionally independent of ReaderShell so the toolbar can expose chapter
 * actions without creating a second iframe or chapter state owner.
 *
 * `canPrevious`/`canNext` and the neighbour movement are derived only here;
 * ReaderShell consumes the booleans and ReaderScreen no longer re-derives
 * chapter availability (CR 修复轮：只保留一处判定).
 */
export type EpubPublicationController = {
  publication: Publication | null
  state: LoadState
  error: string | null
  chapter: PublicationSpine | null
  chapterPosition: number
  canPrevious: boolean
  canNext: boolean
  attempt: number
  goToChapter: (index: number) => void
  goPrevious: () => void
  goNext: () => void
  retry: () => void
}

export function useEpubPublicationController(
  materialId: string,
  enabled = true,
): EpubPublicationController {
  const [publication, setPublication] = useState<Publication | null>(null)
  const [state, setState] = useState<LoadState>(enabled ? 'loading' : 'ready')
  const [error, setError] = useState<string | null>(null)
  const [chapterIndex, setChapterIndex] = useState(0)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setPublication(null)
      setError(null)
      setState('ready')
      setChapterIndex(0)
      return
    }
    const controller = new AbortController()
    setState('loading')
    setError(null)
    setPublication(null)
    fetchPublication(materialId, controller.signal)
      .then((loaded) => {
        setPublication(loaded)
        setChapterIndex((current) => loaded.spine.some((item) => item.index === current) ? current : loaded.spine[0]?.index ?? 0)
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return
        setError(errorText(cause, 'publication 加载失败'))
        setState('error')
      })
    return () => controller.abort()
  }, [attempt, enabled, materialId])

  const chapter = useMemo(
    () => publication?.spine.find((item) => item.index === chapterIndex) ?? null,
    [chapterIndex, publication],
  )
  const chapterPosition = chapter && publication ? publication.spine.findIndex((item) => item.index === chapter.index) : -1

  return {
    publication,
    state,
    error,
    chapter,
    chapterPosition,
    canPrevious: chapterPosition > 0,
    canNext: chapterPosition >= 0 && publication !== null && chapterPosition < publication.spine.length - 1,
    attempt,
    goToChapter: (index) => setChapterIndex(index),
    goPrevious: () => {
      const previous = publication?.spine[chapterPosition - 1]
      if (previous) setChapterIndex(previous.index)
    },
    goNext: () => {
      const next = publication?.spine[chapterPosition + 1]
      if (next) setChapterIndex(next.index)
    },
    retry: () => setAttempt((value) => value + 1),
  }
}

type EpubPublicationProps = {
  materialId: string
  title?: string
  /** The reader passes its single controller so chapter state stays unique. */
  controller: EpubPublicationController
}

/**
 * Controlled EPUB content surface. The iframe remains same-origin through the
 * Vite `/materials` proxy and deliberately grants only `allow-same-origin`.
 * Reader chrome (toolbar, rail and chapter actions) is supplied by ReaderShell;
 * this component renders nothing but the RF-01 publication surface.
 */
export function EpubPublication({ materialId, title, controller: reader }: EpubPublicationProps) {
  const [frameState, setFrameState] = useState<FrameState>('loading')
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const frameTimeoutRef = useRef<number | null>(null)
  const { publication, state, error, chapter, attempt } = reader

  useEffect(() => {
    if (!publication || !chapter) return
    setFrameState('loading')
    if (frameTimeoutRef.current !== null) window.clearTimeout(frameTimeoutRef.current)
    frameTimeoutRef.current = window.setTimeout(() => setFrameState('error'), 8_000)
    return () => {
      if (frameTimeoutRef.current !== null) window.clearTimeout(frameTimeoutRef.current)
      frameTimeoutRef.current = null
    }
  }, [attempt, chapter, publication])

  if (state === 'loading' || (!publication && !error)) {
    return <p role="status" className="rounded-[var(--radius-action)] border border-divider bg-opaque-surface p-6 text-sm text-secondary-text">正在打开 EPUB…</p>
  }
  if (state === 'error' || !publication || !chapter) {
    return (
      <div role="alert" className="rounded-[var(--radius-action)] border border-destructive/40 bg-destructive/5 p-5 text-sm">
        <p>{error ?? 'publication 章节不可用'}</p>
        <button
          type="button"
          className="mt-3 min-h-10 rounded-[var(--radius-control)] border border-divider bg-opaque-surface px-3 py-1.5 hover:bg-grouped-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={reader.retry}
        >
          重试
        </button>
      </div>
    )
  }

  const handleFrameLoad = () => {
    try {
      const root = frameRef.current?.contentDocument?.documentElement
      const trusted = root?.dataset.learningjPublication === '1'
        && root.dataset.projectionVersion === publication.projection_version
        && root.dataset.publicationVersion === publication.publication_version
        && Number(root.dataset.spineIndex) === chapter.index
      if (trusted && frameTimeoutRef.current !== null) window.clearTimeout(frameTimeoutRef.current)
      setFrameState(trusted ? 'ready' : 'error')
    } catch {
      // A future cross-origin deployment must fail closed; CORS cannot make
      // parent DOM access safe for selection mapping.
      setFrameState('error')
    }
  }

  return (
    <section aria-label="EPUB 正文" className="mx-auto flex w-full max-w-[980px] flex-col">
      {frameState === 'error' ? (
        <div role="alert" className="mb-3 rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/5 p-4 text-sm">
          章节加载失败或内容未通过校验。请重试，原始素材未被覆盖。
          <button type="button" className="ml-3 min-h-10 underline" onClick={reader.retry}>重试</button>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-[var(--radius-reading)] border border-divider bg-page">
        <iframe
          key={`${publication.publication_version}:${chapter.index}:${attempt}`}
          ref={frameRef}
          title={`${title ?? publication.title}：${chapter.label}`}
          src={publicationChapterUrl(materialId, chapter.index)}
          sandbox="allow-same-origin"
          onLoad={handleFrameLoad}
          onError={() => setFrameState('error')}
          className="min-h-[70dvh] w-full border-0"
        />
      </div>
    </section>
  )
}
