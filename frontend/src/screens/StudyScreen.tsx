import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, MessageCircle, PanelLeft, Sparkles } from 'lucide-react'
import { AgentConversation, type AgentConversationStatus } from '@/components/AgentConversation'
import { AnalysisDocument } from '@/components/AnalysisDocument'
import { ConfirmationPanel } from '@/components/ConfirmationPanel'
import type { AnalysisMessageRecord, AnalysisRevisionRecord } from '@/components/models'
import { FixtureBadge, Panel, PlaceholderNote, StatusBlock, UnavailableBadge } from '@/screens/Page'
import { materialPath, readerPath } from '@/app/routes'
import { useRepositories } from '@/app/repository-context'
import type { StudySessionRecord } from '@/lib/study-repository'

type StudyPane = 'document' | 'chat'
type LoadState = 'loading' | 'error' | 'ready'

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

function returnTarget(source: string | null, materialId: string | null, returnPath: string | null): string {
  // Keep the return context same-origin and path-only; protocol-relative values
  // (`//host`) must not become an accidental external navigation target.
  if (returnPath && returnPath.startsWith('/') && !returnPath.startsWith('//')) return returnPath
  if (source === 'material' && materialId) return materialPath(materialId)
  if (source === 'library') return '/library'
  if (source === 'center') return '/center'
  return '/queue'
}

function phaseLabel(phase: StudySessionRecord['phase']): string {
  return { preparation: '准备中', discussion: '可讨论', extraction: '提取中', confirmation: '待确认' }[phase]
}

function agentStatus(session: StudySessionRecord): AgentConversationStatus {
  if (session.status === 'parked' || session.current_run?.status === 'paused') return 'paused'
  if (session.phase === 'preparation') return 'preparation'
  if (session.phase === 'discussion') return 'discussion'
  return 'unavailable'
}

export function StudyScreen() {
  const { sessionId = '' } = useParams<{ sessionId: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { study, materials } = useRepositories()
  const [session, setSession] = useState<StudySessionRecord | null>(null)
  const [sentenceText, setSentenceText] = useState<string | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [pane, setPane] = useState<StudyPane>(params.get('pane') === 'chat' ? 'chat' : 'document')

  useEffect(() => {
    if (!sessionId) {
      setState('error')
      setError('缺少学习会话标识')
      return
    }
    const controller = new AbortController()
    setState('loading')
    setError(null)
    study.getSession(sessionId, { signal: controller.signal })
      .then(async (loaded) => {
        if (!loaded) throw new Error('找不到这个学习会话')
        setSession(loaded)
        const sourceSentenceId = loaded.source_sentence_ids[0]
        if (sourceSentenceId) {
          const sentences = await materials.listSentences(loaded.material_id, { signal: controller.signal })
          setSentenceText(sentences.find((sentence) => sentence.id === sourceSentenceId)?.text ?? null)
        } else {
          setSentenceText(null)
        }
        setState('ready')
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return
        setError(cause instanceof Error ? cause.message : '学习会话加载失败')
        setState('error')
      })
    return () => controller.abort()
  }, [attempt, materials, sessionId, study])

  const backPath = returnTarget(params.get('from'), params.get('material') ?? session?.material_id ?? null, params.get('return'))
  const revision = useMemo<AnalysisRevisionRecord | null>(() => {
    if (!session?.analysis) return null
    const current = session.analysis.current_revision_id
      ? session.analysis.revisions.find((candidate) => candidate.analysis_revision_id === session.analysis?.current_revision_id)
      : null
    if (!current) return null
    return {
      revision: current.revision,
      sections: current.sections.map((section) => ({ id: section.section_version_id, revision: section.revision, heading: section.heading_path.at(-1) ?? section.section_id, body_md: section.body_md })),
    }
  }, [session])
  const messages = useMemo<AnalysisMessageRecord[]>(() => session?.messages.map((message) => ({ id: message.id, role: message.role, content: message.content, edited_sections: message.edited_sections })) ?? [], [session])

  if (state === 'loading') return <div className="flex min-h-dvh items-center justify-center bg-background px-5"><StatusBlock status="loading" /></div>
  if (state === 'error' || !session) return <div className="flex min-h-dvh items-center justify-center bg-background px-5"><div className="w-full max-w-md"><StatusBlock status="error" error={error ?? '找不到这个学习会话'} onRetry={() => setAttempt((value) => value + 1)} /><Link to="/queue" className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"><ArrowLeft className="size-4" aria-hidden="true" />回解析队列</Link></div></div>

  const sourceSentenceId = session.source_sentence_ids[0] ?? null
  const materialId = session.material_id
  const isUnavailablePhase = session.phase === 'extraction' || session.phase === 'confirmation'

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
        <button type="button" onClick={() => { void navigate(backPath) }} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-4" aria-hidden="true" />返回来源</button>
        <div className="min-w-0"><h1 className="truncate text-sm font-medium">学习会话 {session.id}</h1><p className="truncate text-xs text-muted-foreground">{phaseLabel(session.phase)} · {session.mode === 'automatic' ? '自动模式' : '交互模式'} · {session.status === 'parked' ? '已搁置' : 'fixture adapter'}</p></div>
        <div className="ml-auto flex items-center gap-2"><FixtureBadge /><span className="hidden text-xs text-muted-foreground min-[760px]:inline">来源语境已保留</span></div>
      </header>

      <div className="flex shrink-0 border-b border-border bg-card px-3 py-2 min-[760px]:hidden" role="tablist" aria-label="Study 面板">
        <button type="button" role="tab" aria-selected={pane === 'document'} onClick={() => setPane('document')} className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm ${pane === 'document' ? 'bg-muted font-medium' : 'text-muted-foreground'}`}><PanelLeft className="size-4" aria-hidden="true" />文档</button>
        <button type="button" role="tab" aria-selected={pane === 'chat'} onClick={() => setPane('chat')} className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm ${pane === 'chat' ? 'bg-muted font-medium' : 'text-muted-foreground'}`}><MessageCircle className="size-4" aria-hidden="true" />Agent 对话</button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden"><div className="mx-auto flex h-full max-w-[1280px] gap-4 p-4 min-[760px]:p-6">
        <main className={`${pane === 'chat' ? 'hidden min-[760px]:flex' : 'flex'} min-w-0 flex-1 flex-col gap-4 overflow-y-auto`} aria-label="解析文档">
          <PlaceholderNote><strong className="font-medium text-foreground">Study 工作区基线。</strong> 文档与对话布局已建立；生成、编辑、提取和逐 Occurrence 确认由后续阶段接入。当前不会伪造后台进度。</PlaceholderNote>
          <Panel title="来源语境" hint="Sentence / return position">
            <div className="px-4 py-4"><p className="font-serif-jp text-xl leading-[2]">{sentenceText ?? `Sentence ${sourceSentenceId ?? '未返回'}`}</p><p className="mt-3 text-xs text-muted-foreground">材料 {materialId} · {sourceSentenceId ?? '未返回'} · 返回位置 {session.return_position ? '已记录' : '未记录'}</p>{sourceSentenceId ? <Link to={readerPath(materialId, sourceSentenceId)} className="mt-3 inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline">回到阅读器语境<ArrowLeft className="size-3.5" aria-hidden="true" /></Link> : null}</div>
          </Panel>
          <Panel title="当前文档" hint={revision ? `v${revision.revision}` : '草稿'}><div className="px-0"><AnalysisDocument status={revision ? 'ready' : session.analysis?.draft ? 'draft' : 'empty'} revision={revision} draft={session.analysis?.draft} editable={false} /></div></Panel>
          {isUnavailablePhase ? <ConfirmationPanel status="unavailable" /> : null}
          {session.question_draft ? <Panel title="问题草稿" hint="来源会话字段"><p className="px-4 py-4 text-sm leading-relaxed">{session.question_draft}</p></Panel> : null}
        </main>

        <aside className={`${pane === 'document' ? 'hidden min-[760px]:flex' : 'flex'} w-full shrink-0 flex-col gap-4 overflow-y-auto min-[760px]:w-[360px]`} aria-label="Agent 对话">
          <AgentConversation status={agentStatus(session)} messages={messages} draft={session.question_draft} />
          <Panel title="当前阶段" hint="服务端状态将取代 fixture"><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-4 py-4 text-xs"><dt className="text-muted-foreground">phase</dt><dd>{session.phase}</dd><dt className="text-muted-foreground">status</dt><dd>{session.status}</dd><dt className="text-muted-foreground">revision</dt><dd>{revision?.revision ?? 'none'}</dd><dt className="text-muted-foreground">run</dt><dd>{session.current_run?.status ?? 'none'}</dd></dl></Panel>
          <div className="flex items-start gap-2 rounded-md border border-ai/30 bg-ai/5 px-3 py-3 text-xs text-muted-foreground"><Sparkles className="mt-0.5 size-4 shrink-0 text-ai" aria-hidden="true" />Agent API 尚未接入；当前是可验证的只读 Study 骨架。<UnavailableBadge /></div>
        </aside>
      </div></div>
    </div>
  )
}
