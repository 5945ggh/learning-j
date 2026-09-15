import { useCallback, useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  BookOpen,
  BookMarked,
  Captions,
  Highlighter,
  House,
  ListChecks,
  Search,
  Type,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOverlaySurface } from '@/lib/useOverlaySurface'
import { useLookupVariant } from '@/lib/viewport'

/** Stable workspaces that remain available while reading.  These are not a
 * mutually-exclusive navigation enum: the wide reader may show any subset. */
export type ReaderPanelSlot = 'dictionary' | 'sentence-actions' | 'material-sessions'

/** Temporary reader tools.  They never consume a stable panel slot. */
export type ReaderTool = 'outline' | 'search' | 'display' | 'annotations'

const READER_PANEL_LABEL: Record<ReaderPanelSlot, string> = {
  dictionary: '查词',
  'sentence-actions': '句子操作',
  'material-sessions': '材料会话',
}

const READER_TOOL_LABEL: Record<ReaderTool, string> = {
  outline: '目录',
  search: '搜索',
  display: '阅读设置',
  annotations: '标注',
}

const PANEL_ICON: Record<ReaderPanelSlot, LucideIcon> = {
  dictionary: BookMarked,
  'sentence-actions': Captions,
  'material-sessions': ListChecks,
}

const TOOL_ICON: Record<ReaderTool, LucideIcon> = {
  outline: BookOpen,
  search: Search,
  display: Type,
  annotations: Highlighter,
}

const STABLE_SLOTS: ReaderPanelSlot[] = ['dictionary', 'sentence-actions', 'material-sessions']
const READER_TOOLS: ReaderTool[] = ['outline', 'search', 'display', 'annotations']

function asSet(value: readonly ReaderPanelSlot[] | ReadonlySet<ReaderPanelSlot>): Set<ReaderPanelSlot> {
  return new Set(Array.from(value))
}

function ToolButton({
  icon: Icon,
  label,
  active,
  onClick,
  disabled = false,
  showLabel = false,
  buttonRef,
  toggle = false,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  showLabel?: boolean
  buttonRef?: (node: HTMLButtonElement | null) => void
  toggle?: boolean
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={toggle ? active : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] px-2.5 text-sm text-secondary-text transition-colors',
        'hover:bg-secondary-grouped-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-45',
        active && 'bg-grouped-surface font-medium text-text',
      )}
    >
      <Icon className="size-[18px]" strokeWidth={active ? 2.1 : 1.8} aria-hidden="true" />
      <span className={showLabel ? 'inline' : 'sr-only'}>{label}</span>
    </button>
  )
}

/** A shell-level title row shared by reader panel surfaces. */
function ReaderSidebarHeader({
  title,
  hint,
  onClose,
}: {
  title: string
  hint?: string
  onClose: () => void
}) {
  return (
    <header className="flex items-start gap-2 border-b border-divider px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-medium text-text">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-secondary-text">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭面板"
        className="grid min-h-10 min-w-10 place-items-center rounded-[var(--radius-control)] text-secondary-text hover:bg-grouped-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </header>
  )
}

type ReaderShellProps = {
  materialTitle: string
  materialMeta?: string
  children: ReactNode
  onBack: () => void
  onHome: () => void
  headerExtras?: ReactNode
  notice?: ReactNode

  /** Expanded stable slots. Slots are independent; the set may hold any subset. */
  expandedPanels: readonly ReaderPanelSlot[] | ReadonlySet<ReaderPanelSlot>
  /** Slot presented on the compact/narrow overlay. */
  activePanel: ReaderPanelSlot | null
  /** Optional token anchor used for the compact dictionary popover and as its
   * focus-return target. */
  panelAnchor?: HTMLElement | null
  /**
   * Monotonic value that changes on every new anchor-triggered open. The anchor
   * element reference is stable when the same token is re-opened, so the
   * trigger accounting must replay on this signal; otherwise a previous rail
   * click would stay as the focus-return target.
   */
  panelAnchorSeq?: number
  onPanelToggle: (slot: ReaderPanelSlot) => void
  panelContent?: Partial<Record<ReaderPanelSlot, ReactNode>>

  transientTool: ReaderTool | null
  onToolChange: (tool: ReaderTool | null) => void
  toolContent?: ReactNode

  /** Chapter context and navigation; availability is derived by the controller. */
  chapterLabel?: string | null
  chapterPosition?: number | null
  chapterCount?: number | null
  canPrevious?: boolean
  canNext?: boolean
  onPreviousChapter?: () => void
  onNextChapter?: () => void
}

function PanelBody({
  slot,
  surfaceRef,
  content,
  onClose,
  variant,
}: {
  slot: ReaderPanelSlot
  surfaceRef?: (node: HTMLDivElement | null) => void
  content: ReactNode
  onClose: () => void
  variant: 'drawer' | 'popover' | 'sheet'
}) {
  const modal = variant === 'sheet'
  // DESIGN.md：查词界面作为 popover/sheet 时使用 dialog 语义，作为抽屉时
  // 使用 complementary/region 语义。
  const role = variant === 'drawer' ? 'complementary' : 'dialog'
  return (
    <aside
      ref={surfaceRef}
      role={role}
      aria-modal={role === 'dialog' ? modal : undefined}
      aria-label={READER_PANEL_LABEL[slot]}
      data-reader-panel={slot}
      data-reader-panel-variant={variant}
      className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-action)] border border-divider bg-opaque-surface"
    >
      <ReaderSidebarHeader title={READER_PANEL_LABEL[slot]} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm text-text">{content}</div>
    </aside>
  )
}

function ToolBody({ tool, content, onClose }: { tool: ReaderTool; content: ReactNode; onClose: () => void }) {
  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={READER_TOOL_LABEL[tool]}
      data-reader-tool={tool}
      className="flex min-h-0 max-h-[75dvh] w-[min(360px,92vw)] flex-col overflow-hidden rounded-[var(--radius-action)] border border-divider bg-opaque-surface text-text shadow-floating"
    >
      <ReaderSidebarHeader title={READER_TOOL_LABEL[tool]} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">{content}</div>
    </aside>
  )
}

/**
 * Reader chrome owns layout only. Data, chapter state and language-tool
 * lifecycles arrive through props from ReaderWorkspace/ReaderScreen; stable
 * panel and transient tool state live in `useReaderPanelState`.
 *
 * Close/focus/trap behavior is shared with the standalone lookup surface via
 * `useOverlaySurface`: Escape closes the presented surface and returns focus to
 * the element that opened it (rail button or token), while re-expanding a slot
 * never steals focus.
 */
export function ReaderShell({
  materialTitle,
  materialMeta = '',
  children,
  onBack,
  onHome,
  headerExtras,
  notice,
  expandedPanels,
  activePanel,
  panelAnchor = null,
  panelAnchorSeq = 0,
  onPanelToggle,
  panelContent = {},
  transientTool,
  onToolChange,
  toolContent,
  chapterLabel,
  chapterPosition,
  chapterCount,
  canPrevious = false,
  canNext = false,
  onPreviousChapter,
  onNextChapter,
}: ReaderShellProps) {
  const responsiveVariant = useLookupVariant()
  const expanded = asSet(expandedPanels)
  const activeSlot = activePanel !== null && expanded.has(activePanel) ? activePanel : null
  // 每个 slot/tool 的触发元素：rail/toolbar 点击或选中 token 时记录，
  // 关闭后焦点回到这里（DESIGN.md：焦点返回到触发它的 token）。
  const triggers = useRef<Partial<Record<ReaderPanelSlot | ReaderTool, HTMLElement | null>>>({})

  useEffect(() => {
    // 一次新的 anchor 打开必须重放记账：同一个 token 的 DOM 引用不变，若只
    // 依赖引用变化，先前的 rail 点击会一直留在账上（CR 修复轮）。
    if (panelAnchor) triggers.current.dictionary = panelAnchor
  }, [panelAnchor, panelAnchorSeq])

  const toggleSlot = useCallback((slot: ReaderPanelSlot, trigger?: HTMLElement) => {
    if (trigger) triggers.current[slot] = trigger
    onPanelToggle(slot)
  }, [onPanelToggle])

  const setTool = useCallback((tool: ReaderTool | null) => {
    onToolChange(tool)
  }, [onToolChange])

  const closeActive = useCallback(() => {
    if (transientTool !== null) {
      onToolChange(null)
      return
    }
    if (activeSlot !== null) onPanelToggle(activeSlot)
  }, [activeSlot, onToolChange, onPanelToggle, transientTool])

  const overlayOpen = transientTool !== null || activeSlot !== null
  const overlayTrigger = transientTool !== null
    ? (triggers.current[transientTool] ?? null)
    : activeSlot !== null
      ? (triggers.current[activeSlot] ?? (activeSlot === 'dictionary' ? panelAnchor : null))
      : null
  const surfaceRef = useOverlaySurface({
    open: overlayOpen,
    variant: responsiveVariant,
    onClose: closeActive,
    trigger: overlayTrigger,
    // 槽位重新展开不抢焦点：只有 token 选中等显式打开才由调用方决定焦点。
    autoFocusOnOpen: false,
    modal: transientTool === null && responsiveVariant === 'sheet',
    closeOnOutsidePointerDown: transientTool === null && responsiveVariant === 'popover' && activeSlot === 'dictionary',
    shouldIgnoreOutside: (target) => Boolean(target.closest('[data-reader-toolbar="true"], [data-reader-rail="true"]')),
  })

  const chapterSummary = chapterLabel
    ? `${chapterLabel}${chapterCount !== null && chapterCount !== undefined ? ` · ${(chapterPosition ?? 0) + 1} / ${chapterCount}` : ''}`
    : materialMeta

  const toolbar = (
    <header aria-label="阅读工具栏" data-reader-toolbar="true" className="relative z-50 flex min-h-14 min-w-0 flex-nowrap items-center gap-1 overflow-x-auto border-b border-divider bg-shell-surface px-2 py-2">
      <ToolButton icon={ArrowLeft} label="返回详情页" active={false} onClick={onBack} showLabel />
      <ToolButton icon={House} label="返回素材库" active={false} onClick={onHome} showLabel />
      <div className="mx-1 hidden min-w-0 flex-1 border-l border-divider pl-3 min-[760px]:block">
        <div className="truncate text-sm font-medium text-text">{materialTitle}</div>
        <div className="truncate text-xs text-secondary-text">{chapterSummary}</div>
      </div>
      {chapterLabel ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="上一章"
            title="上一章"
            disabled={!canPrevious}
            onClick={onPreviousChapter}
            className="grid min-h-10 min-w-10 place-items-center rounded-[var(--radius-control)] text-secondary-text hover:bg-grouped-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="下一章"
            title="下一章"
            disabled={!canNext}
            onClick={onNextChapter}
            className="grid min-h-10 min-w-10 place-items-center rounded-[var(--radius-control)] text-secondary-text hover:bg-grouped-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ArrowLeft className="size-4 rotate-180" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div className="ml-auto flex min-w-0 items-center gap-1">
        {headerExtras}
        <div className="flex min-w-0 items-center gap-1 min-[760px]:hidden">
          {responsiveVariant === 'sheet' && STABLE_SLOTS.map((slot) => (
            <ToolButton key={slot} icon={PANEL_ICON[slot]} label={READER_PANEL_LABEL[slot]} active={expanded.has(slot)} onClick={(event) => toggleSlot(slot, event.currentTarget)} showLabel toggle />
          ))}
          {responsiveVariant === 'sheet' && READER_TOOLS.map((tool) => (
            <ToolButton key={tool} icon={TOOL_ICON[tool]} label={READER_TOOL_LABEL[tool]} active={transientTool === tool} onClick={(event) => { triggers.current[tool] = event.currentTarget; setTool(transientTool === tool ? null : tool) }} showLabel toggle />
          ))}
        </div>
      </div>
    </header>
  )

  const activeStableContent = activeSlot ? panelContent[activeSlot] : null
  const activeStable = activeSlot
    ? <PanelBody slot={activeSlot} content={activeStableContent ?? <p className="text-secondary-text">此面板暂无内容。</p>} onClose={() => toggleSlot(activeSlot)} variant={responsiveVariant} />
    : null

  const wideStack = responsiveVariant === 'drawer' ? (
    <div className="flex w-[min(360px,34vw)] shrink-0 flex-col gap-2 overflow-y-auto border-l border-divider bg-grouped-surface p-2">
      {[...expanded].filter((slot): slot is ReaderPanelSlot => STABLE_SLOTS.includes(slot)).map((slot) => (
        <PanelBody key={slot} slot={slot} content={panelContent[slot] ?? <p className="text-secondary-text">此面板暂无内容。</p>} onClose={() => toggleSlot(slot)} variant="drawer" />
      ))}
    </div>
  ) : null

  const overlay = transientTool ? (
    <div
      ref={surfaceRef}
      className="fixed inset-0 z-50 flex items-start justify-end bg-foreground/15 p-3 pt-16"
      data-reader-tool-overlay
      onMouseDown={(event) => { if (event.target === event.currentTarget) setTool(null) }}
    >
      <ToolBody tool={transientTool} content={toolContent ?? <p className="text-secondary-text">此工具暂不可用。</p>} onClose={() => setTool(null)} />
    </div>
  ) : null

  const popoverAnchor = activePanel === 'dictionary' && responsiveVariant === 'popover' && panelAnchor
    ? (() => {
        const rect = panelAnchor.getBoundingClientRect()
        const width = 360
        const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left))
        const top = Math.max(60, rect.bottom + 8)
        return { position: 'fixed' as const, left, top, width: `min(${width}px, calc(100vw - 24px))` }
      })()
    : undefined

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-canvas text-text" data-reader-layout={responsiveVariant}>
      {toolbar}
      <div className="flex min-h-0 flex-1">
        <nav aria-label="阅读工具栏" data-reader-rail="true" className="relative z-50 hidden w-16 shrink-0 flex-col items-center border-r border-divider bg-shell-surface px-1.5 py-3 min-[760px]:flex">
          <div className="flex flex-col items-center gap-1">
            {responsiveVariant !== 'sheet' && STABLE_SLOTS.map((slot) => <ToolButton key={slot} icon={PANEL_ICON[slot]} label={READER_PANEL_LABEL[slot]} active={expanded.has(slot)} onClick={(event) => toggleSlot(slot, event.currentTarget)} toggle />)}
          </div>
          <div className="mt-auto flex flex-col items-center gap-1">
            {responsiveVariant !== 'sheet' && READER_TOOLS.map((tool) => <ToolButton key={tool} icon={TOOL_ICON[tool]} label={READER_TOOL_LABEL[tool]} active={transientTool === tool} onClick={(event) => { triggers.current[tool] = event.currentTarget; setTool(transientTool === tool ? null : tool) }} toggle />)}
          </div>
        </nav>

        <main className="flex min-w-0 flex-1" data-reader-content-surface="true">
          <div className="flex min-h-0 flex-1">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex min-h-12 items-center gap-3 border-b border-divider px-4 py-2 min-[760px]:hidden">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{materialTitle}</div>
                  <div className="truncate text-xs text-secondary-text">{chapterLabel ?? materialMeta}</div>
                </div>
              </div>
              {notice}
              <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            </div>
            {wideStack}
          </div>
        </main>
      </div>

      {responsiveVariant !== 'drawer' && activeStable ? (
        <div
          className={cn('fixed inset-0 z-40 flex items-start justify-end p-3 pt-16', responsiveVariant === 'popover' ? 'pointer-events-none' : 'bg-foreground/15', responsiveVariant === 'sheet' && 'items-end p-0 pt-0')}
          data-reader-stable-overlay
          data-reader-panel-variant={responsiveVariant}
        >
          <div ref={transientTool ? undefined : surfaceRef} style={popoverAnchor} className={cn('relative z-10 pointer-events-auto shadow-floating', responsiveVariant === 'popover' ? 'w-[min(360px,92vw)]' : 'w-full', responsiveVariant === 'sheet' && 'max-h-[74dvh]')}>
            {activeStable}
          </div>
        </div>
      ) : null}
      {overlay}
    </div>
  )
}
