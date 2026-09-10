export type MaterialKind = 'subtitle_video' | 'subtitle_audio' | 'text' | 'epub'

export type Material = {
  id: string
  title: string
  content_hash: string
  locator: string
  kind: MaterialKind
  copy_stored: boolean
  sentence_count: number
}

export type Sentence = {
  id: string
  material_id: string
  index: number
  text: string
  time_start: number | null
  time_end: number | null
  translation: string | null
  anchor_type: 'subtitle' | 'plain_text' | 'epub'
  anchor_payload: Record<string, number>
}

export async function fetchMaterials(signal?: AbortSignal): Promise<Material[]> {
  const response = await fetch('/materials', { signal })
  if (!response.ok) throw new Error(`素材加载失败（${response.status}）`)
  return response.json() as Promise<Material[]>
}

export async function fetchSentences(materialId: string, signal?: AbortSignal): Promise<Sentence[]> {
  const response = await fetch(`/materials/${encodeURIComponent(materialId)}/sentences`, { signal })
  if (!response.ok) throw new Error(`句子加载失败（${response.status}）`)
  return response.json() as Promise<Sentence[]>
}

