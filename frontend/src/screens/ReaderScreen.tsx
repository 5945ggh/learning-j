import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { MaterialWorkspace } from '@/shells/MaterialWorkspace'
import { ReaderShell, ReaderSidebarHeader, type ReaderPanel } from '@/shells/ReaderShell'
import { readerPath, studyPath } from '@/app/routes'
import { FixtureBadge, PlaceholderNote, UnavailableBadge } from '@/screens/Page'
import { useRepositories } from '@/app/repository-context'

/**
 * Full-screen reader route. MaterialWorkspace remains the P2 regression
 * surface and owns the real P1/P2 API calls; this route only supplies the
 * surrounding ReaderShell and navigation affordances.
 */
export function ReaderScreen() {
  const { materialId = '' } = useParams<{ materialId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { materials, reader, study } = useRepositories()
  const [panel, setPanel] = useState<ReaderPanel | null>(null)
  const [materialTitle, setMaterialTitle] = useState(`材料 ${materialId}`)
  const [studySessionId, setStudySessionId] = useState<string | null>(null)
  const sentenceId = searchParams.get('s') ?? undefined

  useEffect(() => {
    let disposed = false
    materials.getMaterial(materialId)
      .then((material) => { if (!disposed && material) setMaterialTitle(material.title) })
      .catch(() => { /* the reader body renders the API error boundary */ })
    return () => { disposed = true }
  }, [materialId, materials])

  useEffect(() => {
    let disposed = false
    study.listActiveSessions(materialId)
      .then((sessions) => { if (!disposed) setStudySessionId(sessions[0]?.id ?? null) })
      .catch(() => { if (!disposed) setStudySessionId(null) })
    return () => { disposed = true }
  }, [materialId, study])

  const sidebar = (() => {
    if (panel === 'outline') {
      return (
        <>
          <ReaderSidebarHeader title="目录" hint="章节接口待接入" onClose={() => setPanel(null)} />
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm text-muted-foreground">
            <p>当前 P1/P2 API 提供有序 Sentence，不提供章节实体；阅读器会保留原文顺序与来源定位。</p>
            <UnavailableBadge />
            <Link to={`/material/${encodeURIComponent(materialId)}`} className="rounded-md border border-border px-3 py-2 text-center text-sm text-foreground hover:bg-muted">查看材料详情</Link>
          </div>
        </>
      )
    }
    if (panel === 'queue') {
      return (
        <>
          <ReaderSidebarHeader title="解析队列" hint="同一材料的学习会话视图" onClose={() => setPanel(null)} />
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm text-muted-foreground">
            <p>未完成会话与 Study 状态由 P3a repository 提供；当前基线展示 fixture 适配器。</p>
            <Link to={`/queue?material=${encodeURIComponent(materialId)}`} className="rounded-md border border-border px-3 py-2 text-center text-sm text-foreground hover:bg-muted">在解析队列查看</Link>
          </div>
        </>
      )
    }
    return (
      <>
        <ReaderSidebarHeader title="阅读设置" hint="只影响阅读器显示" onClose={() => setPanel(null)} />
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 text-sm text-muted-foreground">
          <p>字号、注音、书写方向与行距控件将在 reader display adapter 接入后提供。</p>
          <UnavailableBadge />
        </div>
      </>
    )
  })()

  return (
    <ReaderShell
      materialTitle={materialTitle}
      materialMeta="P1/P2 API · Sentence / token 版本来自后端"
      panel={panel}
      onPanelChange={setPanel}
      onBack={() => { void navigate(`/material/${encodeURIComponent(materialId)}`) }}
      onHome={() => { void navigate('/library') }}
      headerExtras={studySessionId ? (
        <Link
          to={studyPath(studySessionId, { source: 'material', materialId, sentenceId, returnPath: readerPath(materialId, sentenceId) })}
          className="inline-flex items-center gap-2 rounded-md border border-ai/40 bg-ai/5 px-3 py-2 text-xs text-ai hover:bg-ai/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          打开 Study <FixtureBadge />
        </Link>
      ) : <UnavailableBadge />}
      notice={(
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          <span>阅读器保持当前 Sentence 语境；查词与阅读不会创建 KP、ReviewItem 或 KnownEvidence。</span>
          <PlaceholderNote>学习会话入口为 P3+ fixture</PlaceholderNote>
        </div>
      )}
      sidebar={sidebar}
    >
      <div className="mx-auto w-full max-w-[1180px] p-4 min-[760px]:p-6">
          <MaterialWorkspace initialMaterialId={materialId} initialSentenceId={sentenceId} hideLibrary materialRepository={materials} readerRepository={reader} />
      </div>
    </ReaderShell>
  )
}
