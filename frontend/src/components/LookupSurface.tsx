import { useEffect, useRef } from 'react'
import type { LookupVariant } from '@/lib/viewport'

type LookupSurfaceProps = {
  /** 形态由 shell 按视口决定（DESIGN.md：由 shell 决定 popover 还是抽屉）。 */
  variant: LookupVariant
  open: boolean
  onClose: () => void
  /** 触发查词的 token 按钮；Escape 关闭后焦点恢复到它。 */
  trigger: HTMLElement | null
  children: React.ReactNode
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * 查词面板的形态外壳（DESIGN.md 响应式行为 + 无障碍）：
 * - drawer（宽屏右侧抽屉）：complementary/region 语义 + 显式关闭按钮；
 * - popover（紧凑布局锚定）：dialog 语义（非模态），点击外部关闭；
 * - sheet（移动断点以下底部面板）：dialog 模态语义——背景垫层阻断指针
 *   交互，焦点在面板内循环（Tab/Shift+Tab），Escape 与显式关闭按钮退出。
 *
 * Escape 关闭时把焦点恢复到触发 token；打开时面板容器接收焦点。
 * 关闭逻辑只属于本外壳，不依赖 shell 内部状态（ADR-023）。
 */
export function LookupSurface({ variant, open, onClose, trigger, children }: LookupSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) {
      // Escape/关闭后焦点回到触发 token（DESIGN.md 无障碍）。
      trigger?.focus()
      return
    }
    surfaceRef.current?.focus()
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key === 'Tab' && variant === 'sheet') {
        // 模态焦点陷阱：Tab/Shift+Tab 在面板内循环，不落到阅读器背景。
        const surface = surfaceRef.current
        if (!surface) return
        const focusables = Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        if (focusables.length === 0) return
        const first = focusables[0]!
        const last = focusables[focusables.length - 1]!
        const active = document.activeElement
        const inside = active instanceof Node && surface.contains(active)
        if (event.shiftKey) {
          if (!inside || active === first) {
            event.preventDefault()
            last.focus()
          }
          return
        }
        if (!inside || active === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeydown)
    // 点击外部只关闭 popover；抽屉与底部面板用显式关闭按钮。
    const handleMouseDown = (event: MouseEvent) => {
      if (variant !== 'popover') return
      const target = event.target
      if (!(target instanceof Node)) return
      const surface = surfaceRef.current
      if (surface && surface.contains(target)) return
      if (trigger && trigger.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('keydown', handleKeydown)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [open, onClose, trigger, variant])

  if (!open) return null

  const label = '查词'
  const closeButton = (
    <div className="mb-3 flex items-start justify-end">
      <button
        type="button"
        onClick={onClose}
        className="min-h-[40px] rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {variant === 'popover' ? '关闭' : '关闭查词'}
      </button>
    </div>
  )

  if (variant === 'drawer') {
    return (
      <div
        ref={surfaceRef}
        role="complementary"
        aria-label={label}
        tabIndex={-1}
        data-lookup-variant="drawer"
        className="flex w-full flex-col rounded-md border border-border bg-card p-5 shadow-sm outline-none lg:sticky lg:top-8"
      >
        {closeButton}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    )
  }

  if (variant === 'sheet') {
    return (
      <>
        {/* 模态垫层：阻断背景指针交互；退出走 Escape/显式关闭（DESIGN.md：抽屉/底部面板用显式关闭）。 */}
        <div aria-hidden="true" data-lookup-backdrop="sheet" className="fixed inset-0 z-30 bg-foreground/40" />
        <div
          ref={surfaceRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          data-lookup-variant="sheet"
          className="fixed inset-x-0 bottom-0 z-40 max-h-[70dvh] overflow-y-auto rounded-t-md border border-border bg-popover p-5 text-popover-foreground shadow-lg outline-none"
        >
          {closeButton}
          {children}
        </div>
      </>
    )
  }

  return (
    <div
      ref={surfaceRef}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      tabIndex={-1}
      data-lookup-variant="popover"
      className="absolute z-30 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-5 text-popover-foreground shadow-lg outline-none"
    >
      {closeButton}
      {children}
    </div>
  )
}
