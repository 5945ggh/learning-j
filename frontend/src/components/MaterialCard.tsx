import { useCallback, useEffect, useRef, useState } from 'react'
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { Material } from '@/lib/materials'
import { cn } from '@/lib/utils'

export type MaterialCardMetadata = {
  /** Optional presentation metadata supplied by the repository projection. */
  author?: string | null
  meta_line?: string | null
  cover_src?: string | null
  progress?: number | null
  /** Omit/null when the session projection is unavailable; never infer zero. */
  active_session_count?: number | null
  active_session_state?: 'loading' | 'ready' | 'unavailable'
  /** Prototype naming aliases kept at the presentation boundary only. */
  metaLine?: string | null
  coverSrc?: string | null
  activeSessionCount?: number | null
}

/** Optional prototype presentation fields may also travel with a card row. */
export type MaterialCardSource = Material & {
  author?: string | null
  metaLine?: string | null
  coverSrc?: string | null
}

export type MaterialCardProps = {
  material: MaterialCardSource
  metadata?: MaterialCardMetadata
  /** Main content intent: the owning screen decides whether this is Reader. */
  onOpen?: (material: Material) => void
  /** Low-emphasis material-session entry; it does not compete with opening. */
  onOpenQueue?: (material: Material) => void
  /** Management intents live behind the overflow menu. */
  onOpenKnowledge?: (material: Material) => void
  onOpenStudy?: (material: Material) => void
  studyFixture?: boolean
  /** Material management is callback-only; no implicit route/action. */
  onManage?: (material: Material) => void
  className?: string
}

function kindLabel(kind: Material['kind']): string {
  switch (kind) {
    case 'epub':
      return 'EPUB'
    case 'text':
      return '文本'
    case 'subtitle_audio':
      return '音频'
    case 'subtitle_video':
      return '视频'
  }
}

/**
 * Content-first material card. It stays shell-independent: route, repository
 * and session data arrive through props/callbacks, while management actions
 * are deliberately kept out of the primary open affordance.
 *
 * The visible title block is the card's single open control; it stretches its
 * hit area over the whole card (including the cover) so the cover, title and
 * author all open the material without nesting interactive elements or
 * declaring two controls with the same accessible name. Every other intent is
 * either a distinct low-emphasis control in the footer or a management item
 * inside the overflow menu.
 */
export function MaterialCard({
  material,
  metadata,
  onOpen,
  onOpenQueue,
  onOpenKnowledge,
  onOpenStudy,
  studyFixture = false,
  onManage,
  className,
}: MaterialCardProps) {
  const cover = metadata?.cover_src ?? metadata?.coverSrc ?? material.coverSrc ?? null
  const [coverFailed, setCoverFailed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeMenuIndex, setActiveMenuIndex] = useState(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  useEffect(() => setCoverFailed(false), [cover])

  const showCover = Boolean(cover) && !coverFailed
  const sessionCount = metadata?.active_session_count ?? metadata?.activeSessionCount ?? null
  const sessionProjectionProvided = metadata?.active_session_count !== undefined || metadata?.activeSessionCount !== undefined
  const sessionState = metadata?.active_session_state ?? (sessionProjectionProvided ? 'ready' : null)
  const hasSessionCount = typeof sessionCount === 'number' && Number.isFinite(sessionCount) && sessionCount >= 0
  const progress = metadata?.progress ?? null
  const metaLine = metadata?.meta_line ?? metadata?.metaLine ?? material.metaLine ?? null
  const author = metadata?.author ?? material.author ?? null
  const isBook = material.kind === 'epub' || material.kind === 'text'
  const sessionEntryAvailable = sessionState === 'ready' && sessionProjectionProvided && hasSessionCount && sessionCount > 0
  const menuItems = [
    onManage ? { label: '材料信息', run: onManage } : null,
    onOpenKnowledge ? { label: '查看知识库', run: onOpenKnowledge } : null,
  ].filter((item): item is { label: string; run: (material: Material) => void } => item !== null)

  const closeMenu = useCallback((restoreTriggerFocus: boolean) => {
    setMenuOpen(false)
    if (restoreTriggerFocus) triggerRef.current?.focus()
  }, [])

  // WAI-ARIA menu button pattern: opening moves focus to the first item, so the
  // declared `role="menu"`/`role="menuitem"` is backed by a real keyboard path.
  useEffect(() => {
    if (!menuOpen) return
    const items = menuItemRefs.current.filter((item): item is HTMLButtonElement => item !== null)
    if (items.length === 0) return
    items[Math.min(activeMenuIndex, items.length - 1)]?.focus()
  }, [menuOpen, activeMenuIndex])

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      closeMenu(true)
    }
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) closeMenu(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [menuOpen, closeMenu])

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const count = menuItems.length
    if (count === 0) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveMenuIndex((index) => (index + 1) % count)
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveMenuIndex((index) => (index - 1 + count) % count)
        break
      case 'Home':
        event.preventDefault()
        setActiveMenuIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveMenuIndex(count - 1)
        break
      default:
        break
    }
  }

  // Tabbing out of the menu closes it; focus keeps moving on its own, which is
  // safer than leaving an open menu behind a focus that already left the card.
  const onMenuBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && (menuRef.current?.contains(next) || triggerRef.current?.contains(next))) return
    setMenuOpen(false)
  }

  return (
    <article
      className={cn(
        'group relative flex min-w-0 flex-col overflow-visible rounded-[var(--radius-action)] border border-divider bg-opaque-surface transition-colors hover:border-secondary-text/50 hover:bg-grouped-surface',
        className,
      )}
    >
      <div className={cn('relative w-full overflow-hidden rounded-t-[var(--radius-action)] bg-secondary-grouped-surface', isBook ? 'aspect-[5/7]' : 'aspect-video')}>
        {showCover ? <img src={cover ?? undefined} alt="" loading="lazy" onError={() => setCoverFailed(true)} className="absolute inset-0 size-full object-cover" /> : <span className="absolute inset-0 grid place-items-center px-3 text-center font-serif-jp text-sm text-secondary-text">{material.title}</span>}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3.5">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold leading-5 text-text" title={material.title}>
              {onOpen ? (
                <button
                  type="button"
                  onClick={() => onOpen(material)}
                  aria-label={`打开《${material.title}》`}
                  className="w-full text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="line-clamp-2">{material.title}</span>
                </button>
              ) : (
                <span className="line-clamp-2">{material.title}</span>
              )}
            </h2>
            {author ? <p className="mt-1 truncate text-xs text-secondary-text" title={author}>{author}</p> : null}
            <p className="mt-1 truncate text-[11px] text-secondary-text">
              {kindLabel(material.kind)}{metaLine ? ` · ${metaLine}` : ''}
            </p>
          </div>
          {menuItems.length > 0 ? (
            <div className="relative z-30 shrink-0">
              <button
                ref={triggerRef}
                type="button"
                aria-label={`管理《${material.title}》`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={(event) => {
                  event.stopPropagation()
                  if (menuOpen) {
                    closeMenu(true)
                    return
                  }
                  setActiveMenuIndex(0)
                  setMenuOpen(true)
                }}
                className="grid min-h-10 min-w-10 place-items-center rounded-[var(--radius-control)] text-secondary-text hover:bg-secondary-grouped-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MoreHorizontal className="size-5" aria-hidden="true" />
              </button>
              {menuOpen ? (
                <div
                  ref={menuRef}
                  role="menu"
                  aria-label={`管理《${material.title}》`}
                  onKeyDown={onMenuKeyDown}
                  onBlur={onMenuBlur}
                  className="absolute right-0 top-11 z-20 min-w-44 rounded-[var(--radius-action)] border border-divider bg-opaque-surface p-1 shadow-floating"
                >
                  {menuItems.map((item, index) => (
                    <button
                      key={item.label}
                      ref={(node) => { menuItemRefs.current[index] = node }}
                      type="button"
                      role="menuitem"
                      tabIndex={index === activeMenuIndex ? 0 : -1}
                      onClick={(event) => {
                        event.stopPropagation()
                        closeMenu(true)
                        item.run(material)
                      }}
                      className="flex min-h-10 w-full items-center rounded-[var(--radius-control)] px-3 py-2 text-left text-sm text-text hover:bg-grouped-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {progress !== null ? (
          <div aria-label="阅读进度" className="flex items-center gap-2">
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary-grouped-surface">
              <span className="block h-full rounded-full bg-lexical" style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} />
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-secondary-text">{Math.round(Math.max(0, Math.min(1, progress)) * 100)}%</span>
          </div>
        ) : null}

        {/* The open control stretches over the card, so the footer only forwards
            pointer events for its own controls. */}
        <div className="pointer-events-none relative z-10 flex min-h-10 items-center gap-2 text-xs">
          {sessionState === 'loading' ? <span className="text-secondary-text">正在读取会话…</span> : null}
          {sessionEntryAvailable && onOpenQueue ? (
            <button type="button" onClick={(event) => { event.stopPropagation(); onOpenQueue(material) }} className="pointer-events-auto min-h-10 rounded-[var(--radius-control)] px-1 font-medium text-study underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              解析队列 {sessionCount}
            </button>
          ) : sessionEntryAvailable ? (
            <span className="text-secondary-text">解析队列 {sessionCount}</span>
          ) : null}
          {sessionState === 'ready' && sessionProjectionProvided && hasSessionCount && sessionCount === 0 ? <span className="text-secondary-text">暂无活动会话</span> : null}
          {sessionState === 'unavailable' || (sessionState === 'ready' && sessionProjectionProvided && !hasSessionCount) ? <span className="text-secondary-text">会话状态不可用</span> : null}
          {sessionEntryAvailable && onOpenStudy ? (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onOpenStudy(material) }}
              className="pointer-events-auto ml-auto min-h-10 rounded-[var(--radius-control)] px-1 text-[11px] text-secondary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              打开 Study
              {studyFixture ? <span className="text-[10px] tracking-wide">（fixture）</span> : null}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  )
}
