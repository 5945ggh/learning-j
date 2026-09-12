import { MaterialList } from '@/components/MaterialList'
import {
  LIBRARY_MODE_LABELS,
  materialsForMode,
  type LibraryMode,
} from '@/lib/library'
import type { Material } from '@/lib/materials'

export type MaterialLibraryStatus = 'loading' | 'error' | 'ready'

type MaterialLibraryProps = {
  status: MaterialLibraryStatus
  materials: Material[]
  error: string | null
  mode: LibraryMode
  onModeChange: (mode: LibraryMode) => void
  selectedId: string | null
  onSelect: (material: Material) => void
  onRetry: () => void
}

const MODE_EMPTY_COPY: Record<LibraryMode, string> = {
  books: '书目里还没有文本或 EPUB 素材。',
  audiovisual: '视听里还没有字幕素材。',
}

/**
 * 素材库（DESIGN.md 应用外壳与素材界面）：「书目／视听」两种模式共用
 * 视图切换、空状态与素材卡片契约；数据与回调全部来自 props，
 * 组件不感知 shell 与路由（ADR-023）。
 */
export function MaterialLibrary({
  status,
  materials,
  error,
  mode,
  onModeChange,
  selectedId,
  onSelect,
  onRetry,
}: MaterialLibraryProps) {
  if (status === 'loading') {
    return <p role="status" className="text-sm text-muted-foreground">正在加载素材…</p>
  }
  if (status === 'error') {
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p>{error ?? '素材加载失败'}</p>
        <p className="mt-1 text-muted-foreground">素材浏览不依赖 BYOK；请确认本地后端已启动后重试。</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          重试
        </button>
      </div>
    )
  }

  const modeMaterials = materialsForMode(materials, mode)
  return (
    <div className="space-y-3">
      <div role="group" aria-label="素材模式" className="flex gap-1">
        {(Object.keys(LIBRARY_MODE_LABELS) as LibraryMode[]).map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={mode === candidate}
            onClick={() => onModeChange(candidate)}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${mode === candidate ? 'border-border bg-muted font-medium' : 'border-transparent text-muted-foreground hover:bg-muted/60'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
          >
            {LIBRARY_MODE_LABELS[candidate]}（{materialsForMode(materials, candidate).length}）
          </button>
        ))}
      </div>
      {materials.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          还没有素材。导入 txt、srt、vtt 或 EPUB 后会显示在这里。
        </p>
      ) : modeMaterials.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {MODE_EMPTY_COPY[mode]}
        </p>
      ) : (
        <MaterialList materials={modeMaterials} selectedId={selectedId} onSelect={onSelect} />
      )}
    </div>
  )
}
