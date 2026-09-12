import type { Material, MaterialKind } from '@/lib/materials'

const KIND_LABELS: Record<MaterialKind, string> = {
  subtitle_video: '视频',
  subtitle_audio: '音频',
  text: '文本',
  epub: 'EPUB',
}

type MaterialListProps = {
  materials: Material[]
  selectedId: string | null
  onSelect: (material: Material) => void
}

/** 素材卡片列表：名称 + 最有用的元数据（DESIGN.md 应用外壳与素材界面）。 */
export function MaterialList({ materials, selectedId, onSelect }: MaterialListProps) {
  return (
    <ul className="space-y-1" aria-label="素材列表">
      {materials.map((material) => (
        <li key={material.id}>
          <button
            type="button"
            onClick={() => onSelect(material)}
            aria-pressed={selectedId === material.id}
            className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${selectedId === material.id ? 'border-study bg-study/10' : 'border-transparent hover:border-border hover:bg-muted'}`}
          >
            <span className="block truncate font-medium">{material.title}</span>
            <span className="text-xs text-muted-foreground">
              {KIND_LABELS[material.kind]} · {material.sentence_count} 句 ·{' '}
              {material.current_sidecar_id ? '已建内容索引' : '未建内容索引'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
