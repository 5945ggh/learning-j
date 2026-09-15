import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { readerPath, studyPath, materialPath } from '@/app/routes'
import { useRepositories } from '@/app/repository-context'
import { FixtureBadge } from '@/screens/Page'
import { EpubReaderWorkspace } from '@/features/reader/EpubReaderWorkspace'
import { ReaderWorkspace } from '@/features/reader/ReaderWorkspace'
import { useEpubPublicationController } from '@/features/reader/EpubPublication'
import type { MaterialSessionState } from '@/features/reader/useMaterialReaderController'
import type { Material } from '@/lib/materials'
import type { StudySessionRecord } from '@/lib/study-repository'

type MaterialKind = 'epub' | 'other'
type LoadState = 'loading' | 'error' | 'ready'

/**
 * Reader route assembly only: it resolves the route Material and its active
 * learning sessions once, picks the content surface by material kind, and
 * renders the top-level loading / material-not-found states.
 *
 * The resolved `Material` and session projection are passed down, so the
 * workspaces neither re-list materials (which would repeat `GET /materials`)
 * nor request sessions a second time.
 */
export function ReaderScreen() {
  const { materialId = '' } = useParams<{ materialId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { materials, reader, study } = useRepositories()
  const [material, setMaterial] = useState<Material | null>(null)
  const [materialKind, setMaterialKind] = useState<MaterialKind | null>(null)
  const [materialLoadState, setMaterialLoadState] = useState<LoadState>('loading')
  const [materialLoadError, setMaterialLoadError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<StudySessionRecord[]>([])
  const [sessionsState, setSessionsState] = useState<MaterialSessionState>('loading')
  const sentenceId = searchParams.get('s') ?? undefined
  const publication = useEpubPublicationController(materialId, materialKind === 'epub')

  useEffect(() => {
    let disposed = false
    setMaterial(null)
    setMaterialKind(null)
    setMaterialLoadError(null)
    setMaterialLoadState('loading')
    materials.getMaterial(materialId)
      .then((loaded) => {
        if (disposed) return
        if (!loaded) {
          setMaterialLoadError('找不到这部材料')
          setMaterialLoadState('error')
          return
        }
        setMaterial(loaded)
        setMaterialKind(loaded.kind === 'epub' ? 'epub' : 'other')
        setMaterialLoadState('ready')
      })
      .catch((cause: unknown) => {
        if (disposed) return
        setMaterialLoadError(cause instanceof Error ? cause.message : '材料加载失败')
        setMaterialLoadState('error')
      })
    return () => { disposed = true }
  }, [materialId, materials])

  // 材料会话的唯一请求方与状态来源：两个 workspace 通过 props 消费。
  useEffect(() => {
    let disposed = false
    setSessions([])
    setSessionsState('loading')
    study.listActiveSessions(materialId)
      .then((loaded) => {
        if (disposed) return
        setSessions(loaded)
        setSessionsState('ready')
      })
      .catch(() => {
        if (disposed) return
        setSessions([])
        setSessionsState('unavailable')
      })
    return () => { disposed = true }
  }, [materialId, study])

  if (materialLoadState === 'loading') {
    return <div className="flex min-h-48 items-center justify-center bg-canvas px-6"><p role="status" className="text-sm text-secondary-text">正在加载材料…</p></div>
  }
  if (materialLoadState === 'error' || !material) {
    return <div className="flex min-h-48 items-center justify-center bg-canvas px-6"><div role="alert" className="w-full max-w-md rounded-[var(--radius-action)] border border-destructive/40 bg-destructive/5 p-5 text-sm">{materialLoadError ?? '找不到这部材料'}</div></div>
  }

  const onBack = () => { void navigate(materialPath(materialId)) }
  const onHome = () => { void navigate('/library') }

  const studySession = sessions[0]
  const headerExtras = studySession ? (
    <Link
      to={studyPath(studySession.id, {
        source: 'material',
        materialId,
        sentenceId: sentenceId ?? studySession.source_sentence_ids[0],
        returnPath: readerPath(materialId, sentenceId),
      })}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-control)] border border-ai/40 bg-ai/5 px-3 text-xs text-ai hover:bg-ai/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      打开 Study {study.source === 'fixture' ? <FixtureBadge /> : null}
    </Link>
  ) : null

  if (materialKind === 'epub') {
    return (
      <EpubReaderWorkspace
        material={material}
        publication={publication}
        sessions={sessions}
        sessionsState={sessionsState}
        onBack={onBack}
        onHome={onHome}
        headerExtras={headerExtras}
      />
    )
  }
  return (
    <ReaderWorkspace
      material={material}
      sessions={sessions}
      sessionsState={sessionsState}
      initialSentenceId={sentenceId}
      materialRepository={materials}
      readerRepository={reader}
      onBack={onBack}
      onHome={onHome}
      headerExtras={headerExtras}
    />
  )
}
