import { useMemo, type ReactNode } from 'react'
import { SessionList } from '@/components/SessionList'
import type { SessionRecord } from '@/components/models'
import type { Material } from '@/lib/materials'
import type { StudySessionRecord } from '@/lib/study-repository'
import { ReaderShell } from '@/shells/ReaderShell'
import { EpubPublication, type EpubPublicationController } from './EpubPublication'
import { useReaderPanelState } from './useReaderPanelState'
import { UnavailablePanel } from './UnavailablePanel'
import type { MaterialSessionState } from './useMaterialReaderController'

/**
 * EPUB reader workspace. Publication/chapter state is owned by
 * EpubPublicationController; stable panel and transient tool state come from
 * the shared `useReaderPanelState`, so both reader kinds behave the same and
 * the screen stays a thin assembly.
 */
export function EpubReaderWorkspace({
  material,
  publication,
  sessions,
  sessionsState,
  onBack,
  onHome,
  headerExtras,
}: {
  material: Material
  publication: EpubPublicationController
  sessions: StudySessionRecord[]
  sessionsState: MaterialSessionState
  onBack: () => void
  onHome: () => void
  headerExtras?: ReactNode
}) {
  const panels = useReaderPanelState(material.id)
  const sidecarAvailable = material.current_sidecar_id !== null

  const sessionRecords = useMemo<SessionRecord[]>(() => sessions.map((session) => ({
    id: session.id,
    phase: session.phase,
    status: session.status,
    mode: session.mode,
    material_title: material.title,
    source_text: null,
    created_at: session.created_at,
  })), [material.title, sessions])

  const outline = publication.publication ? (
    <ol className="space-y-1" aria-label="EPUB 章节目录">
      {publication.publication.spine.map((chapter) => (
        <li key={chapter.index}>
          <button
            type="button"
            aria-pressed={publication.chapter?.index === chapter.index}
            onClick={() => publication.goToChapter(chapter.index)}
            className="min-h-10 w-full rounded-[var(--radius-control)] px-3 text-left text-sm hover:bg-grouped-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {chapter.label}
          </button>
        </li>
      ))}
    </ol>
  ) : <p className="text-sm text-secondary-text">目录加载中…</p>

  const toolContent = panels.transientTool === 'outline' ? outline : panels.transientTool === 'display' ? (
    <UnavailablePanel>字号、注音和书写方向设置尚未提供。</UnavailablePanel>
  ) : panels.transientTool === 'search' ? (
    <UnavailablePanel>正文搜索尚未接入；当前可以使用浏览器原生查找，不会改变阅读位置。</UnavailablePanel>
  ) : panels.transientTool === 'annotations' ? (
    <UnavailablePanel>标注管理属于独立切片；打开工具不会改动正文。</UnavailablePanel>
  ) : null

  const sessionsPanel = sessionsState === 'loading' ? (
    <p role="status" className="text-sm text-secondary-text">正在加载材料会话…</p>
  ) : sessionsState === 'unavailable' ? (
    <UnavailablePanel>当前环境没有可用的材料会话列表；正文阅读不受影响。</UnavailablePanel>
  ) : (
    <SessionList sessions={sessionRecords} emptyNote="该材料目前没有进行中的学习会话。" dense />
  )
  const dictionaryPanel = sidecarAvailable ? (
    <UnavailablePanel>语言工具尚未接入；正文阅读不受影响。</UnavailablePanel>
  ) : (
    <UnavailablePanel>正文可读；该材料尚未发布内容索引，词典和句子语言工具暂不可用。</UnavailablePanel>
  )
  const sentencePanel = <UnavailablePanel>{sidecarAvailable ? '选择句子后可在此查看操作。' : '正文可读，句子操作依赖的语言索引尚不可用。'}</UnavailablePanel>

  return (
    <ReaderShell
      materialTitle={material.title}
      materialMeta="EPUB"
      chapterLabel={publication.chapter?.label ?? null}
      chapterPosition={publication.chapterPosition >= 0 ? publication.chapterPosition : null}
      chapterCount={publication.publication?.spine.length ?? null}
      canPrevious={publication.canPrevious}
      canNext={publication.canNext}
      onPreviousChapter={publication.goPrevious}
      onNextChapter={publication.goNext}
      expandedPanels={panels.expandedPanels}
      activePanel={panels.activePanel}
      onPanelToggle={panels.togglePanel}
      transientTool={panels.transientTool}
      onToolChange={panels.setTransientTool}
      toolContent={toolContent}
      panelContent={{ dictionary: dictionaryPanel, 'sentence-actions': sentencePanel, 'material-sessions': sessionsPanel }}
      onBack={onBack}
      onHome={onHome}
      headerExtras={headerExtras}
      notice={!sidecarAvailable ? <div className="border-b border-divider bg-warning/10 px-4 py-2 text-xs text-text">正文可读，语言工具尚不可用；当前材料没有已发布 Sidecar。</div> : undefined}
    >
      <div className="mx-auto w-full max-w-[1000px] px-4 py-5 min-[760px]:px-6 min-[760px]:py-7">
        <EpubPublication materialId={material.id} title={material.title} controller={publication} />
      </div>
    </ReaderShell>
  )
}
