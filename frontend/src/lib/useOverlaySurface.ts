import { useEffect, useRef } from 'react'

/**
 * 覆盖层（panel / tool / 查词 popover / bottom sheet）共享的关闭、焦点与
 * 陷阱行为。DESIGN.md「无障碍」：Escape 关闭 popover／抽屉；焦点返回到
 * 触发它的 token；「响应式行为」：sheet 是模态 surface。
 *
 * 行为按形态分工：
 * - drawer：complementary 语义 + 显式关闭按钮；不因外部点击关闭；非模态。
 * - popover：dialog（非模态）语义；外部点击关闭。
 * - sheet：dialog 模态语义；Tab/Shift+Tab 在 surface 内循环；外部点击不关闭。
 *
 * 触发元素由调用方给出；surface 关闭（open true→false）时把焦点还给触发
 * 元素。`autoFocusOnOpen` 默认关闭，使阅读器槽位重新展开不会抢走焦点。
 */
export type OverlayVariant = 'drawer' | 'popover' | 'sheet' | 'dialog'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export type OverlaySurfaceOptions = {
  open: boolean
  variant: OverlayVariant
  onClose: () => void
  /** 触发该 surface 的元素；surface 关闭时焦点回到它。 */
  trigger?: HTMLElement | null
  /** 打开时把焦点移入 surface。默认关闭：阅读器槽位展开不抢焦点。 */
  autoFocusOnOpen?: boolean
  /** 模态 surface 携带 aria-modal 语义并循环 Tab。默认 sheet 为模态。 */
  modal?: boolean
  /** 锚定 popover 用外部点击关闭；抽屉／sheet 用显式关闭按钮。 */
  closeOnOutsidePointerDown?: boolean
  /**
   * 命中这些区域时不按“外部点击”处理。阅读器 rail/toolbar 点击本身会切换
   * 槽位，重复关闭会与切换互相抵消。
   */
  shouldIgnoreOutside?: (target: Element) => boolean
}

export function useOverlaySurface({
  open,
  variant,
  onClose,
  trigger = null,
  autoFocusOnOpen = false,
  modal = variant === 'sheet',
  closeOnOutsidePointerDown = variant === 'popover',
  shouldIgnoreOutside,
}: OverlaySurfaceOptions) {
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  // Callers derive `trigger` from live state, which is usually cleared in the
  // same render that closes the surface; remember the last open trigger so the
  // close transition can still restore focus.
  const activeTriggerRef = useRef<HTMLElement | null>(null)
  // 回调与判定通过 ref 读取，避免因内联箭头函数重建而反复订阅，也避免
  // 关闭态每次渲染都重复恢复焦点。
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const ignoreRef = useRef(shouldIgnoreOutside)
  ignoreRef.current = shouldIgnoreOutside

  useEffect(() => {
    if (!open) {
      // Escape／显式关闭后把焦点还给触发点（DESIGN.md 无障碍）。
      const restoreTarget = trigger ?? activeTriggerRef.current
      restoreTarget?.focus()
      activeTriggerRef.current = null
      return
    }
    activeTriggerRef.current = trigger ?? null
    if (autoFocusOnOpen) surfaceRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !modal) return
      // 模态焦点陷阱：Tab/Shift+Tab 在 surface 内循环，不落到背景。
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
    document.addEventListener('keydown', handleKeyDown)

    let handleMouseDown: ((event: MouseEvent) => void) | null = null
    if (closeOnOutsidePointerDown) {
      handleMouseDown = (event: MouseEvent) => {
        const target = event.target
        if (!(target instanceof Element)) return
        if (surfaceRef.current?.contains(target)) return
        if (trigger?.contains(target)) return
        if (ignoreRef.current?.(target)) return
        onCloseRef.current()
      }
      document.addEventListener('mousedown', handleMouseDown)
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (handleMouseDown) document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [autoFocusOnOpen, closeOnOutsidePointerDown, modal, open, trigger, variant])

  return surfaceRef
}
