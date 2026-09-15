import type { ReactNode } from 'react'

/**
 * Reader 语言工具/材料会话的不可用状态块。
 *
 * features/reader 内唯一一份定义：EPUB 与非 EPUB workspace 从同一个模块
 * 取用，而不是各写一份（CR 修复轮去重）。分层上放在 features/reader：
 * components/** 不得依赖 shell，feature 反向 import screens/ 也是层次倒置，
 * 因此共享的 presentational 原子留在 feature 内部。
 */
export function UnavailablePanel({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-3">
      <span className="inline-flex rounded-full border border-divider bg-grouped-surface px-2 py-0.5 text-[11px] text-secondary-text">待实现</span>
      <p className="text-sm leading-relaxed text-secondary-text">{children}</p>
    </div>
  )
}
