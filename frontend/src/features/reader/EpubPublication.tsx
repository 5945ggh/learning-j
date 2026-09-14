import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchPublication, publicationChapterUrl, type Publication } from './publication-repository'

type LoadState = 'loading' | 'error' | 'ready'

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

/**
 * Controlled EPUB reading surface.  The iframe is same-origin through the
 * Vite `/materials` proxy and deliberately grants only `allow-same-origin`:
 * publication scripts, forms, popups and navigation cannot execute.
 */
export function EpubPublication({ materialId, title }: { materialId: string; title?: string }) {
  const [publication, setPublication] = useState<Publication | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [chapterIndex, setChapterIndex] = useState(0)
  const [frameState, setFrameState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const frameTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    setError(null)
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
  }, [attempt, materialId])

  const chapter = useMemo(
    () => publication?.spine.find((item) => item.index === chapterIndex) ?? null,
    [chapterIndex, publication],
  )

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

  if (state === 'loading') {
    return <p role="status" className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">正在打开 EPUB…</p>
  }
  if (state === 'error' || !publication || !chapter) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-5 text-sm">
        <p>{error ?? 'publication 章节不可用'}</p>
        <button
          type="button"
          className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setAttempt((value) => value + 1)}
        >
          重试
        </button>
      </div>
    )
  }

  const chapterPosition = publication.spine.findIndex((item) => item.index === chapter.index)
  const canPrevious = chapterPosition > 0
  const canNext = chapterPosition >= 0 && chapterPosition < publication.spine.length - 1

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

  const switchChapter = (next: Publication['spine'][number]) => {
    setChapterIndex(next.index)
    setFrameState('loading')
  }

  return (
    <section aria-label="EPUB 阅读器" className="mx-auto flex w-full max-w-[960px] flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-medium">{title ?? publication.title}</h1>
          <p className="text-xs text-muted-foreground">{chapter.label} · {chapterPosition + 1} / {publication.spine.length}</p>
        </div>
        <button
          type="button"
          disabled={!canPrevious}
          onClick={() => { const previous = publication.spine[chapterPosition - 1]; if (previous) switchChapter(previous) }}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          上一章
        </button>
        <button
          type="button"
          disabled={!canNext}
          onClick={() => { const next = publication.spine[chapterPosition + 1]; if (next) switchChapter(next) }}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          下一章
        </button>
      </header>

      {frameState === 'error' ? (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          章节加载失败或响应不是受控 publication。请重试，原始素材未被覆盖。
          <button type="button" className="ml-3 underline" onClick={() => setAttempt((value) => value + 1)}>重试</button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-[#fffcf5] shadow-sm">
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
