import type { Material } from '@/lib/materials'

type MaterialListProps = {
  materials: Material[]
  selectedId: string | null
  onSelect: (material: Material) => void
}

export function MaterialList({ materials, selectedId, onSelect }: MaterialListProps) {
  if (materials.length === 0) {
    return <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">还没有素材。导入 txt、srt、vtt 或 EPUB 后会显示在这里。</p>
  }
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
            <span className="text-xs text-muted-foreground">{material.kind} · {material.sentence_count} 句</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

