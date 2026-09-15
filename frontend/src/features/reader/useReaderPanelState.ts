import { useCallback, useEffect, useState } from 'react'
import type { ReaderPanelSlot, ReaderTool } from '@/shells/ReaderShell'

/**
 * Reader stable panel / transient tool 状态机。
 *
 * RF-02 要求 EPUB 与非 EPUB 两个 workspace 共用同一份槽位状态，避免两份
 * `expandedPanels`/`activePanel`/`transientTool` + materialId 重置逻辑各自
 * 分叉（CR 修复轮）。此处是唯一实现：
 *
 * - `expandedPanels` 是“已展开槽位集合”，槽位互不排斥；
 * - `activePanel` 是窄屏当前呈现的槽位，宽屏只有一个 panel 时也用它决定
 *   覆盖层呈现（ReaderShell 负责具体形态）；
 * - `transientTool` 是临时 reader tool，与稳定槽位状态彼此独立；
 * - material 切换会清空旧材料作用域的槽位与工具状态。
 */
export type ReaderPanelState = {
  expandedPanels: ReaderPanelSlot[]
  activePanel: ReaderPanelSlot | null
  transientTool: ReaderTool | null
  isPanelOpen: (slot: ReaderPanelSlot) => boolean
  togglePanel: (slot: ReaderPanelSlot) => void
  openPanel: (slot: ReaderPanelSlot) => void
  closePanel: (slot: ReaderPanelSlot) => void
  setTransientTool: (tool: ReaderTool | null) => void
}

export function useReaderPanelState(materialId: string): ReaderPanelState {
  const [expandedPanels, setExpandedPanels] = useState<ReaderPanelSlot[]>([])
  const [activePanel, setActivePanel] = useState<ReaderPanelSlot | null>(null)
  const [transientTool, setTransientTool] = useState<ReaderTool | null>(null)

  useEffect(() => {
    // 换材料即换作用域：不泄漏上一材料的展开槽位、当前槽位或临时工具。
    setExpandedPanels([])
    setActivePanel(null)
    setTransientTool(null)
  }, [materialId])

  const isPanelOpen = useCallback((slot: ReaderPanelSlot) => expandedPanels.includes(slot), [expandedPanels])

  const openPanel = useCallback((slot: ReaderPanelSlot) => {
    setExpandedPanels((current) => (current.includes(slot) ? current : [...current, slot]))
    setActivePanel(slot)
  }, [])

  const closePanel = useCallback((slot: ReaderPanelSlot) => {
    setExpandedPanels((current) => current.filter((item) => item !== slot))
    setActivePanel((current) => (current === slot ? null : current))
  }, [])

  const togglePanel = useCallback((slot: ReaderPanelSlot) => {
    setExpandedPanels((current) => (current.includes(slot) ? current.filter((item) => item !== slot) : [...current, slot]))
    setActivePanel((current) => (current === slot ? null : slot))
  }, [])

  return {
    expandedPanels,
    activePanel,
    transientTool,
    isPanelOpen,
    togglePanel,
    openPanel,
    closePanel,
    setTransientTool,
  }
}
