import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  MATERIAL_IMPORT_TYPE_DETAIL,
  isSupportedImportFilename,
  materialDefaultTitle,
  type Material,
} from '@/lib/materials'

export type MaterialImportDraft = {
  file: File
  /** 展示标题；空串/空白表示不发送 title，由后端按文件名处理。 */
  title: string
}

export type ImportMaterialDialogProps = {
  /**
   * 提交导入；由调用方（screen/shell）绑定 createMaterial 客户端。
   * 组件保持 shell 无关（ADR-023），不直接依赖网络、路由或 shell 状态。
   */
  onImport: (draft: MaterialImportDraft) => Promise<Material>
  /** 导入成功；由调用方决定刷新列表或跳转详情。 */
  onImported: (material: Material) => void
  /** 关闭对话框；提交进行中被组件自身拦截，不会触发。 */
  onClose: () => void
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
 * 素材导入对话框（DESIGN.md：素材库共用搜索／导入入口）。
 *
 * - 文件选择带前端扩展名校验，拒绝文案与后端 415 detail 保持一致；
 * - 标题可选，未手动编辑时默认取文件名去扩展名；
 * - 提交中为诚实的禁用/进行中状态（不做假进度）：提交按钮显示
 *   「导入中…」并禁用，取消与 Escape 同步禁用；
 * - 失败以 role="alert" 展示后端 detail 文本；
 * - 模态 dialog 语义：打开时聚焦面板，Tab 在面板内循环，Escape/取消
 *   关闭后焦点返回触发元素（DESIGN.md 无障碍）。
 */
export function ImportMaterialDialog({ onImport, onImported, onClose }: ImportMaterialDialogProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [titleEdited, setTitleEdited] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const active = document.activeElement
    returnFocusRef.current = active instanceof HTMLElement ? active : null
    surfaceRef.current?.focus()
    return () => returnFocusRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (submitting) return
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key === 'Tab') {
        // 模态焦点陷阱：Tab/Shift+Tab 在面板内循环（DESIGN.md 无障碍）。
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
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [onClose, submitting])

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null
    if (!selected) {
      setFile(null)
      return
    }
    if (!isSupportedImportFilename(selected.name)) {
      setFile(null)
      setError(MATERIAL_IMPORT_TYPE_DETAIL)
      // 重置 input，让同一文件被拒后仍可再次选择。
      event.target.value = ''
      return
    }
    setError(null)
    setFile(selected)
    if (!titleEdited) setTitle(materialDefaultTitle(selected.name))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || file === null) return
    if (!isSupportedImportFilename(file.name)) {
      setFile(null)
      setError(MATERIAL_IMPORT_TYPE_DETAIL)
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const material = await onImport({ file, title })
      onImported(material)
    } catch (cause) {
      setError(cause instanceof Error && cause.message !== '' ? cause.message : '素材导入失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto">
      {/* 模态垫层：阻断背景指针交互；退出走 Escape/显式取消（与 LookupSurface sheet 一致）。 */}
      <div aria-hidden="true" data-import-backdrop="true" className="fixed inset-0 bg-foreground/40" />
      <div className="flex min-h-full items-end justify-center p-4 min-[760px]:items-center">
        <div
          ref={surfaceRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-material-dialog-title"
          aria-busy={submitting}
          tabIndex={-1}
          className="relative w-full max-w-md rounded-md border border-border bg-popover p-5 text-popover-foreground shadow-lg outline-none"
        >
          <form onSubmit={(formEvent) => { void handleSubmit(formEvent) }}>
            <h2 id="import-material-dialog-title" className="text-base font-semibold">导入素材</h2>
            <p className="mt-1 text-sm text-muted-foreground">支持 .txt、.srt、.vtt、.epub；导入后可在素材库中打开。</p>

            <label htmlFor="import-material-file" className="mt-4 block text-sm font-medium">文件</label>
            <input
              id="import-material-file"
              type="file"
              accept=".txt,.srt,.vtt,.epub"
              disabled={submitting}
              onChange={handleFileChange}
              className="mt-1.5 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />

            <label htmlFor="import-material-title-input" className="mt-4 block text-sm font-medium">标题（可选）</label>
            <input
              id="import-material-title-input"
              type="text"
              value={title}
              disabled={submitting}
              onChange={(inputEvent) => {
                setTitle(inputEvent.target.value)
                setTitleEdited(true)
              }}
              placeholder="默认使用文件名"
              className="mt-1.5 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />

            {error ? (
              <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" disabled={submitting} onClick={onClose}>取消</Button>
              <Button type="submit" variant="primary" disabled={file === null || submitting}>
                {submitting ? '导入中…' : '导入'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
