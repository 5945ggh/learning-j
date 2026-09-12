import { useEffect, useState } from 'react'

/**
 * 查词面板的响应式形态选择（DESIGN.md 响应式行为）：
 * - 宽屏（≥1180px，阅读器外壳有空间）→ 右侧抽屉 drawer；
 * - 紧凑布局（760–1179px）→ 锚定 popover；
 * - 移动断点以下（<760px）→ 底部面板/对话框 sheet。
 *
 * 断点取值来自 DESIGN.md「桌面优先，1180px 及以上；紧凑布局低至 760px；
 * 760px 以下为堆叠回退」。形态只由 shell 级装配决定，组件本身保持与
 * 形态解耦（DESIGN.md 组件归属）。
 */

export type LookupVariant = 'drawer' | 'popover' | 'sheet'

export const LOOKUP_BREAKPOINTS = {
  /** 宽屏下限（含）：≥ 该宽度用右侧抽屉。 */
  drawer: 1180,
  /** 紧凑布局下限（含）：≥ 该宽度用锚定 popover，低于则用底部面板。 */
  popover: 760,
} as const

export function resolveLookupVariant(width: number): LookupVariant {
  if (width >= LOOKUP_BREAKPOINTS.drawer) return 'drawer'
  if (width >= LOOKUP_BREAKPOINTS.popover) return 'popover'
  return 'sheet'
}

/**
 * 订阅视口宽度的 hook。用 innerWidth + resize 而不是 matchMedia：
 * jsdom 测试环境没有 matchMedia，而断点判定只需要宽度。
 */
export function useLookupVariant(): LookupVariant {
  const read = () => (typeof window === 'undefined' ? LOOKUP_BREAKPOINTS.drawer : window.innerWidth)
  const [variant, setVariant] = useState<LookupVariant>(() => resolveLookupVariant(read()))
  useEffect(() => {
    const update = () => setVariant(resolveLookupVariant(window.innerWidth))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return variant
}
