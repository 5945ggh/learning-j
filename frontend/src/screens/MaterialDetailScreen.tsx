import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, BookOpen, Network, Sparkles } from 'lucide-react'
import { ChapterList } from '@/components/ChapterList'
import { FixtureBadge, PageFrame, PageHeader, PAGE_PADDING, Panel, PlaceholderNote, StatusBlock, UnavailableBadge } from '@/screens/Page'
import { materialPath, readerPath, studyPath } from '@/app/routes'
import { useRepositories } from '@/app/repository-context'
import type { ChapterRecord } from '@/components/models'
import { materialCoverUrl, type Material, type Sentence } from '@/lib/materials'
import type { StudySessionRecord } from '@/lib/study-repository'

type LoadState = 'loading' | 'error' | 'ready'

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

/** Material detail remains API-backed.  EPUB chapter navigation is served by
 * the controlled publication reader; this compact list is only the existing
 * sentence-based reading entry for other material kinds. */
export function MaterialDetailScreen() {
  const { materialId = '' } = useParams<{ materialId: string }>()
  const navigate = useNavigate()
  const { materials: materialRepository, study } = useRepositories()
  const [material, setMaterial] = useState<Material | null>(null)
  const [sentences, setSentences] = useState<Sentence[]>([])
  const [studySessions, setStudySessions] = useState<StudySessionRecord[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!materialId) {
      setState('error')
      setError('缺少材料标识')
      return
    }
    const controller = new AbortController()
    setState('loading')
    setError(null)
    Promise.all([
      materialRepository.getMaterial(materialId, { signal: controller.signal }),
      materialRepository.listSentences(materialId, { signal: controller.signal }),
      study.listActiveSessions(materialId, { signal: controller.signal }),
    ])
      .then(([loadedMaterial, loadedSentences, loadedSessions]) => {
        if (!loadedMaterial) throw new Error('找不到这部材料')
        setMaterial(loadedMaterial)
        setSentences(loadedSentences)
        setStudySessions(loadedSessions)
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return
        setError(cause instanceof Error ? cause.message : '材料详情加载失败')
        setState('error')
      })
    return () => controller.abort()
  }, [attempt, materialId, materialRepository, study])

  const chapters = useMemo<ChapterRecord[]>(() => {
    if (!material) return []
    return [{
      id: `${material.id}-chapter-1`,
      index: 1,
      // P1 has no return_position/read-progress endpoint; do not infer a
      // percentage from sentence count or navigation.
      progress: 0,
      imported: sentences.length > 0,
      title: null,
    }]
  }, [material, sentences.length])

  if (state === 'loading') {
    return <PageFrame><div className={PAGE_PADDING}><StatusBlock status="loading" /></div></PageFrame>
  }
  if (state === 'error' || !material || !materialId) {
    return (
      <PageFrame>
        <div className={PAGE_PADDING}>
          <StatusBlock status="error" error={error ?? '找不到这部材料'} onRetry={() => setAttempt((value) => value + 1)} />
          <button type="button" onClick={() => { void navigate('/library') }} className="mt-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">回素材库</button>
        </div>
      </PageFrame>
    )
  }

  const firstSentence = sentences[0]
  const firstStudy = studySessions[0]
  const isBook = material.kind === 'text' || material.kind === 'epub'
  const coverSrc = materialCoverUrl(material)

  return (
    <PageFrame>
      <PageHeader
        eyebrow="素材详情"
        title={material.title}
        subtitle={`${isBook ? '书目' : '视听'} · ${material.sentence_count} 句 · 内容版本 ${material.content_hash}`}
        actions={firstSentence ? (
          <Link to={readerPath(material.id, firstSentence.id)} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <BookOpen className="size-4" aria-hidden="true" />继续阅读
          </Link>
        ) : undefined}
      />

      <div className={`${PAGE_PADDING} flex flex-col gap-4`}>
        <section className="grid gap-4 rounded-[var(--radius-grouped)] border border-divider bg-opaque-surface p-5 min-[760px]:grid-cols-[160px_minmax(0,1fr)]">
          <div className="grid min-h-48 place-items-center overflow-hidden rounded-md bg-muted text-center text-xs text-muted-foreground">
            {coverSrc ? (
              <img src={coverSrc} alt={`《${material.title}》封面`} loading="lazy" className="size-full object-cover" />
            ) : (
              <>素材封面<br />由资源适配器提供</>
            )}
          </div>
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px]">{material.storage_mode}</span>
              <span className="text-xs text-muted-foreground">{material.copy_stored ? '已保存副本' : '外部引用'}</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">素材详情只展示 API 已确认的来源与版本信息。阅读位置来自阅读器返回语境，不能由导航位置推断。</p>
            <p className="mt-2 text-xs text-muted-foreground">阅读进度：待后端 return_position 接口</p>
            <div className="mt-auto flex flex-wrap gap-2 pt-5">
              <Link to={`/knowledge?material=${encodeURIComponent(material.id)}`} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Network className="size-4" aria-hidden="true" />知识库范围</Link>
              <Link to={`/queue?material=${encodeURIComponent(material.id)}`} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">解析队列<ArrowRight className="size-4" aria-hidden="true" /></Link>
              {firstStudy ? (
                <Link to={studyPath(firstStudy.id, { source: 'material', materialId: material.id, sentenceId: firstStudy.source_sentence_ids[0], returnPath: materialPath(material.id) })} className="inline-flex items-center gap-1.5 rounded-md border border-ai/40 bg-ai/5 px-3 py-2 text-sm text-ai hover:bg-ai/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Sparkles className="size-4" aria-hidden="true" />打开 Study<FixtureBadge /></Link>
              ) : <UnavailableBadge />}
            </div>
          </div>
        </section>

        <Panel title={material.kind === 'epub' ? 'EPUB 阅读' : '章节列表'} hint={material.kind === 'epub' ? '受控 publication API 在阅读器中提供章节切换' : '按有序原文提供阅读入口'}>
          <div className="p-3">
            <ChapterList
              kind={material.kind}
              chapters={chapters}
              onSelect={(chapter) => { if (chapter.imported && firstSentence) void navigate(readerPath(material.id, firstSentence.id)) }}
            />
            <PlaceholderNote>{material.kind === 'epub'
              ? 'EPUB 的章节切换请在阅读器中使用；不会凭导航位置推断阅读进度。'
              : '不会凭导航位置推断阅读进度。'}</PlaceholderNote>
          </div>
        </Panel>

        <Panel title="词汇与索引" hint="算法数据按 sidecar 版本读取">
          <div className="flex flex-wrap items-center gap-3 px-4 py-4 text-sm text-muted-foreground">
            <span>句子 {material.sentence_count}</span><span>·</span><span>内容索引由阅读器按当前 API 加载</span>
            {firstSentence ? <Link to={readerPath(material.id, firstSentence.id)} className="ml-auto rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted">在阅读器查看</Link> : null}
          </div>
        </Panel>
      </div>
    </PageFrame>
  )
}
