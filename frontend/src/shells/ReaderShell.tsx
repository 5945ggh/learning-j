import type { ReactNode } from 'react'
import {
  ArrowLeft,
  BookOpen,
  House,
  ListChecks,
  Settings2,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLookupVariant } from '@/lib/viewport'

export type ReaderPanel = 'outline' | 'queue' | 'display'

export const READER_PANEL_LABEL: Record<ReaderPanel, string> = {
  outline: '目录',
  queue: '解析队列',
  display: '阅读设置',
}

const PANEL_ICON: Record<ReaderPanel, LucideIcon> = {
  outline: BookOpen,
  queue: ListChecks,
  display: Settings2,
}

const PANEL_HINT: Record<ReaderPanel, string> = {
  outline: '按章节回到原文，不精确到句子',
  queue: '这部材料未完成的学习会话',
  display: '字号、注音与书写方向',
}

const CONTENT_PANELS: ReaderPanel[] = ['outline', 'queue']

function ToolButton({
  icon: Icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: LucideIcon
  label: string
  hint: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={`${label}：${hint}`}
      onClick={onClick}
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors',
        'hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active && 'bg-muted text-foreground shadow-sm',
      )}
    >
      <Icon className="size-[19px]" strokeWidth={active ? 2.1 : 1.8} aria-hidden="true" />
    </button>
  )
}

/** A shell-level title row shared by all reader side panels. */
export function ReaderSidebarHeader({
  title,
  hint,
  onClose,
}: {
  title: string
  hint?: string
  onClose: () => void
}) {
  return (
    <header className="flex items-start gap-2 border-b border-border px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-medium">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭侧栏"
        className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </header>
  )
}

/**
 * Full-screen reader shell. The same panel is docked at ≥1180px, a right
 * drawer from 760–1179px, and a bottom sheet below 760px. Panel content is
 * supplied by the screen so the shell never owns domain or route state.
 */
export function ReaderShell({
  materialTitle,
  materialMeta,
  panel,
  onPanelChange,
  onBack,
  onHome,
  headerExtras,
  notice,
  sidebar,
  children,
}: {
  materialTitle: string
  materialMeta: string
  panel: ReaderPanel | null
  onPanelChange: (panel: ReaderPanel | null) => void
  onBack: () => void
  onHome: () => void
  headerExtras?: ReactNode
  notice?: ReactNode
  sidebar?: ReactNode
  children: ReactNode
}) {
  const toggle = (next: ReaderPanel) => onPanelChange(panel === next ? null : next)
  const layout = useLookupVariant()

  const rail = (
    <>
      <div className="flex flex-col items-center gap-1">
        <ToolButton icon={ArrowLeft} label="返回详情页" hint="回到当前材料" active={false} onClick={onBack} />
        <ToolButton icon={House} label="返回素材库" hint="回到材料列表" active={false} onClick={onHome} />
      </div>
      <div className="mt-auto flex flex-col items-center gap-1">
        {CONTENT_PANELS.map((item) => (
          <ToolButton
            key={item}
            icon={PANEL_ICON[item]}
            label={READER_PANEL_LABEL[item]}
            hint={PANEL_HINT[item]}
            active={panel === item}
            onClick={() => toggle(item)}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-col items-center pb-1">
        <ToolButton
          icon={PANEL_ICON.display}
          label={READER_PANEL_LABEL.display}
          hint={PANEL_HINT.display}
          active={panel === 'display'}
          onClick={() => toggle('display')}
        />
      </div>
    </>
  )

  const bar = (
    <>
      <div className="flex items-center gap-1">
        <ToolButton icon={ArrowLeft} label="返回详情页" hint="回到当前材料" active={false} onClick={onBack} />
        <ToolButton icon={House} label="返回素材库" hint="回到材料列表" active={false} onClick={onHome} />
      </div>
      <div className="ml-3 flex items-center gap-1">
        {CONTENT_PANELS.map((item) => (
          <ToolButton
            key={item}
            icon={PANEL_ICON[item]}
            label={READER_PANEL_LABEL[item]}
            hint={PANEL_HINT[item]}
            active={panel === item}
            onClick={() => toggle(item)}
          />
        ))}
      </div>
      <div className="ml-auto flex items-center gap-1 pl-3">
        <ToolButton
          icon={PANEL_ICON.display}
          label={READER_PANEL_LABEL.display}
          hint={PANEL_HINT.display}
          active={panel === 'display'}
          onClick={() => toggle('display')}
        />
      </div>
    </>
  )

  const panelContent = panel ? (
    <>
      {sidebar ?? (
        <div className="p-4 text-sm text-muted-foreground">此面板暂无内容。</div>
      )}
    </>
  ) : null

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <div aria-label="阅读工具栏" className="flex items-center gap-1 overflow-x-auto border-b border-border bg-card/90 px-2 py-1.5 backdrop-blur-xl min-[760px]:hidden">
        {bar}
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="阅读工具栏"
          className="hidden w-16 shrink-0 flex-col items-center border-r border-border bg-card/75 px-1.5 py-3 backdrop-blur-xl min-[760px]:flex"
        >
          {rail}
        </nav>

        <div className="flex min-w-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{materialTitle}</div>
                <div className="truncate text-xs text-muted-foreground">{materialMeta}</div>
              </div>
              <div className="ml-auto flex items-center gap-2">{headerExtras}</div>
            </header>
            {notice}
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </div>

          {layout === 'drawer' && panel ? (
            <aside aria-label={READER_PANEL_LABEL[panel]} className="flex w-[336px] shrink-0 flex-col overflow-hidden border-l border-border bg-card">
              {panelContent}
            </aside>
          ) : null}
        </div>
      </div>

      {layout === 'popover' && panel ? (
        <div className="fixed inset-0 z-40 flex">
          <button type="button" aria-label="关闭侧栏" className="flex-1 bg-black/20" onClick={() => onPanelChange(null)} />
          <aside aria-label={READER_PANEL_LABEL[panel]} className="flex w-[340px] max-w-[92vw] flex-col overflow-hidden border-l border-border bg-card shadow-2xl">
            {panelContent}
          </aside>
        </div>
      ) : null}

      {layout === 'sheet' && panel ? (
        <div className="fixed inset-0 z-40 flex flex-col justify-end">
          <button type="button" aria-label="关闭侧栏" className="flex-1 bg-black/20" onClick={() => onPanelChange(null)} />
          <aside aria-label={READER_PANEL_LABEL[panel]} className="flex max-h-[70dvh] flex-col overflow-hidden rounded-t-lg border-t border-border bg-card shadow-2xl">
            {panelContent}
          </aside>
        </div>
      ) : null}
    </div>
  )
}
