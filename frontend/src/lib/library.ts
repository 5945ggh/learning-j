import type { Material, MaterialKind } from '@/lib/materials'

/**
 * 素材库「书目／视听」两种模式（DESIGN.md 应用外壳与素材界面）。
 *
 * 这是素材库视图的分组规则，不是领域层的素材类型感知：data-model §8.2
 * 的「上层不得感知素材类型」约束针对解析、抽取、复习、聚合；素材库按
 * DESIGN.md 的契约以两种模式呈现同一份有序 Sentence 序列。
 */

export type LibraryMode = 'books' | 'audiovisual'

export function libraryModeForKind(kind: MaterialKind): LibraryMode {
  return kind === 'text' || kind === 'epub' ? 'books' : 'audiovisual'
}

export function materialsForMode(
  materials: Material[],
  mode: LibraryMode,
): Material[] {
  return materials.filter((material) => libraryModeForKind(material.kind) === mode)
}

export const LIBRARY_MODE_LABELS: Record<LibraryMode, string> = {
  books: '书目',
  audiovisual: '视听',
}
