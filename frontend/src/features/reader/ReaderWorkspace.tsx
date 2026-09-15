import { useMemo, type ReactNode } from 'react'
import { ContentIndexPanel } from '@/components/ContentIndexPanel'
import { LookupPanel, type LookupVersionStamps } from '@/components/LookupPanel'
import { PlaceholderNote } from '@/components/PageHeader'
import { SentenceContext } from '@/components/SentenceContext'
import { SentenceList } from '@/components/SentenceList'
import { TokenizedSentence, tokenKey } from '@/components/TokenizedSentence'
import { SessionList } from '@/components/SessionList'
import type { SessionRecord } from '@/components/models'
import type { AlgorithmToken } from '@/lib/tokens'
import type { Material } from '@/lib/materials'
import type { MaterialRepository } from '@/lib/material-repository'
import type { ReaderRepository } from '@/lib/reader-repository'
import type { StudySessionRecord } from '@/lib/study-repository'
import { ReaderShell, type ReaderPanelSlot } from '@/shells/ReaderShell'
import { useMaterialReaderController, type MaterialSessionState } from './useMaterialReaderController'
import { useReaderPanelState } from './useReaderPanelState'
import { UnavailablePanel } from './UnavailablePanel'

export type ReaderSelectionState = {
  mode: 'single' | 'multi'
  token: ReturnType<typeof useMaterialReaderController>['lookupToken']
  selectedSentenceIds: string[]
}

function sessionRecord(
  session: StudySessionRecord,
  materialTitle: string,
  sentences: ReturnType<typeof useMaterialReaderController>['sentences'],
): SessionRecord {
  const sourceId = session.source_sentence_ids[0]
  return {
    id: session.id,
    phase: session.phase,
    status: session.status,
    mode: session.mode,
    material_title: materialTitle,
    source_text: sentences.find((sentence) => sentence.id === sourceId)?.text ?? '来源句子暂不可用',
    created_at: session.created_at,
  }
}

function SentenceActionsPanel({
  sentence,
  selectedSentenceCount,
}: {
  sentence: ReturnType<typeof useMaterialReaderController>['selectedSentence']
  selectedSentenceCount: number
}) {
  if (!sentence && selectedSentenceCount === 0) {
    return <p className="text-sm text-secondary-text">先选择一句正文，句子操作会显示在这里。</p>
  }
  return (
    <div className="space-y-4">
      {sentence ? <SentenceContext sentence={sentence} /> : <p className="text-sm text-secondary-text">已选择 {selectedSentenceCount} 句。</p>}
      <div className="space-y-2 border-t border-divider pt-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-secondary-text">有意操作</p>
        <button type="button" aria-disabled="true" disabled className="min-h-10 w-full rounded-[var(--radius-control)] border border-ai/40 px-3 text-left text-sm text-ai opacity-60">加入 AI 学习（待接入）</button>
        <button type="button" aria-disabled="true" disabled className="min-h-10 w-full rounded-[var(--radius-control)] border border-divider px-3 text-left text-sm text-secondary-text opacity-60">添加标注（待接入）</button>
        <p className="text-xs leading-relaxed text-secondary-text">选择句子只改变阅读语境，不会创建学习记录或知识点。</p>
      </div>
    </div>
  )
}

/**
 * Non-EPUB reader workspace. It is the state boundary between the route and
 * ReaderShell: stable panel state (shared `useReaderPanelState`), transient
 * tools and the single selection projection are assembled here, while
 * reusable panels remain prop-driven.
 *
 * The route Material and the material-session read are resolved by
 * ReaderScreen and arrive as props: this workspace does not re-list materials
 * or re-request sessions.
 */
export function ReaderWorkspace({
  material,
  sessions,
  sessionsState,
  initialSentenceId,
  materialRepository,
  readerRepository,
  onBack,
  onHome,
  headerExtras,
}: {
  material: Material
  sessions: StudySessionRecord[]
  sessionsState: MaterialSessionState
  initialSentenceId?: string
  materialRepository: MaterialRepository
  readerRepository: ReaderRepository
  onBack?: () => void
  onHome?: () => void
  headerExtras?: ReactNode
}) {
  const controller = useMaterialReaderController({ material, initialSentenceId, materialRepository, readerRepository })
  const panels = useReaderPanelState(material.id)
  const sidecarAvailable = material.current_sidecar_id !== null

  const title = material.title

  const selection = useMemo<ReaderSelectionState>(() => ({
    mode: 'single',
    token: controller.lookupToken,
    selectedSentenceIds: controller.selectedSentence ? [controller.selectedSentence.id] : [],
  }), [controller.lookupToken, controller.selectedSentence])

  const handlePanelToggle = (slot: ReaderPanelSlot) => {
    const wasOpen = panels.expandedPanels.includes(slot)
    panels.togglePanel(slot)
    if (slot === 'dictionary' && wasOpen) controller.closeLookup()
  }

  const handleTokenSelect = (token: AlgorithmToken, trigger: HTMLElement) => {
    controller.openLookup(token, trigger)
    panels.openPanel('dictionary')
  }

  const lookupVersionStamps: LookupVersionStamps | null = controller.sentenceTokens ? {
    sidecar_generation_id: controller.sentenceTokens.sidecar_generation_id,
    segmenter_version: controller.sentenceTokens.segmenter_version,
    tokenizer_version: controller.sentenceTokens.tokenizer_version,
    analyzer_dict_version: controller.sentenceTokens.analyzer_dict_version,
  } : null

  // 面板内容由「槽位已展开」与「存在查词结果」决定；`lookupOpen` 只表示
  // 查词界面当前是否显示，因此收起再展开不会丢失上一次结果（CR 修复轮）。
  const lookupPanel = controller.lookupToken ? (
    <LookupPanel
      status={controller.lookupStatus}
      error={controller.lookupError}
      ftsUnavailable={controller.lookupFts}
      token={controller.lookupToken}
      versionStamps={lookupVersionStamps}
      entries={controller.lookupEntries}
      searchQuery={controller.lookupSearchQuery}
      searchPending={controller.lookupStatus === 'loading' && controller.lookupSearchQuery !== null}
      decisionScope={controller.decisionScope}
      decisionSummaryLoaded={controller.decisionSummary !== null}
      decisionError={controller.decisionError}
      pendingDecision={controller.pendingDecision}
      onDecide={(decision) => { void controller.submitDecision(decision) }}
      onDismissDecisionError={controller.dismissDecisionError}
      onSearch={controller.handleLookupSearch}
      onRetry={controller.retryLookup}
    />
  ) : !sidecarAvailable ? (
    <UnavailablePanel>正文可读，但该材料尚未发布内容索引；词典和句子语言工具暂不可用。不会伪造 token 或查词结果。</UnavailablePanel>
  ) : (
    <p className="text-sm leading-relaxed text-secondary-text">选择正文中的 token 后，查词结果会在这里显示。查词不会创建学习记录或知识点。</p>
  )

  const sentenceActions = <SentenceActionsPanel sentence={controller.selectedSentence} selectedSentenceCount={selection.selectedSentenceIds.length} />
  const materialSessions = sessionsState === 'loading' ? (
    <p role="status" className="text-sm text-secondary-text">正在加载材料会话…</p>
  ) : sessionsState === 'unavailable' ? (
    <UnavailablePanel>当前环境没有可用的材料会话列表；正文阅读不受影响。</UnavailablePanel>
  ) : (
    <SessionList
      sessions={sessions.map((session) => sessionRecord(session, title, controller.sentences))}
      emptyNote="该材料目前没有进行中的学习会话。"
      dense
    />
  )

  const toolContent = panels.transientTool === 'outline' ? (
    <ContentIndexPanel status={controller.indexStatus} sidecar={controller.sidecar} counts={controller.counts} error={controller.indexError} onRetry={controller.retryIndex} />
  ) : panels.transientTool === 'display' ? (
    <UnavailablePanel>字号、注音和书写方向设置会在 reader display adapter 接入后提供。</UnavailablePanel>
  ) : panels.transientTool === 'search' ? (
    <UnavailablePanel>正文搜索尚未接入；当前可以使用浏览器原生查找，不会改变阅读位置。</UnavailablePanel>
  ) : panels.transientTool === 'annotations' ? (
    <UnavailablePanel>标注管理属于独立切片。当前阅读与查词不会隐式写入批注。</UnavailablePanel>
  ) : null

  const body = (
    <div className="mx-auto w-full max-w-[980px] space-y-5 px-4 py-5 min-[760px]:px-6 min-[760px]:py-7">
      <section aria-label="正文与句子" className="space-y-4">
        {controller.sentenceStatus === 'loading' ? <p role="status" className="rounded-[var(--radius-action)] border border-divider bg-opaque-surface p-6 text-sm text-secondary-text">正在加载句子…</p> : controller.sentenceStatus === 'error' ? (
          <div role="alert" className="rounded-[var(--radius-action)] border border-destructive/40 bg-destructive/5 p-4 text-sm"><p>{controller.sentenceError ?? '句子加载失败'}</p><button type="button" onClick={controller.retrySentences} className="mt-3 min-h-10 rounded-[var(--radius-control)] border border-divider bg-opaque-surface px-3 hover:bg-grouped-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">重试</button></div>
        ) : <SentenceList material={material} sentences={controller.sentences} selectedId={controller.selectedSentence?.id} onSelect={controller.setSelectedSentence} />}
        {controller.selectedSentence ? (
          <div className="space-y-4">
            <TokenizedSentence sentence={controller.selectedSentence} tokens={controller.sentenceTokens?.tokens ?? []} loading={controller.tokensStatus === 'loading'} error={controller.tokensError} selectedKey={controller.lookupOpen && controller.lookupToken && controller.lookupSearchQuery === null ? tokenKey(controller.lookupToken) : null} onTokenSelect={handleTokenSelect} onRetry={controller.retryTokens} />
            <SentenceContext sentence={controller.selectedSentence} />
          </div>
        ) : <PlaceholderNote>选择一句正文以查看 token、来源语境和可用的句子工具。</PlaceholderNote>}
      </section>
    </div>
  )

  return (
    <ReaderShell
      materialTitle={title}
      materialMeta={material.kind === 'text' ? '文本' : '视听'}
      expandedPanels={panels.expandedPanels}
      activePanel={panels.activePanel}
      panelAnchor={controller.lookupTrigger}
      panelAnchorSeq={controller.lookupOpenSeq}
      onPanelToggle={handlePanelToggle}
      transientTool={panels.transientTool}
      onToolChange={panels.setTransientTool}
      toolContent={toolContent}
      panelContent={{ dictionary: lookupPanel, 'sentence-actions': sentenceActions, 'material-sessions': materialSessions }}
      onBack={onBack ?? (() => { window.history.back() })}
      onHome={onHome ?? (() => { window.location.hash = '#/library' })}
      headerExtras={headerExtras}
      notice={!sidecarAvailable ? <div className="border-b border-divider bg-warning/10 px-4 py-2 text-xs text-text">正文可读，语言工具尚不可用；当前材料没有已发布 Sidecar。</div> : undefined}
    >
      {body}
    </ReaderShell>
  )
}
