export type PublicationSpine = {
  index: number
  label: string
}

export type Publication = {
  material_id: string
  title: string
  publication_version: string
  projection_version: string
  spine: PublicationSpine[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`publication 缺少有效的 ${field}`)
  return value
}

function requireInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`publication 缺少有效的 ${field}`)
  return value as number
}

function parsePublication(value: unknown): Publication {
  if (!isRecord(value)) throw new Error('publication 响应格式无效')
  const spineValue = value.spine
  if (!Array.isArray(spineValue) || spineValue.length === 0) throw new Error('publication 缺少章节')
  return {
    material_id: requireString(value.material_id, 'material_id'),
    title: requireString(value.title, 'title'),
    publication_version: requireString(value.publication_version, 'publication_version'),
    projection_version: requireString(value.projection_version, 'projection_version'),
    spine: spineValue.map((entry) => {
      if (!isRecord(entry)) throw new Error('publication 章节格式无效')
      return {
        index: requireInteger(entry.index, 'spine.index'),
        label: requireString(entry.label, 'spine.label'),
      }
    }),
  }
}

export async function fetchPublication(materialId: string, signal?: AbortSignal): Promise<Publication> {
  const response = await fetch(`/materials/${encodeURIComponent(materialId)}/publication`, { signal })
  if (!response.ok) {
    let detail: string | null = null
    try {
      const body: unknown = await response.json()
      if (isRecord(body) && typeof body.detail === 'string') detail = body.detail
    } catch {
      // Fall through to status-bearing text for a proxy/server error page.
    }
    throw new Error(detail ?? `publication 加载失败（${response.status}）`)
  }
  return parsePublication(await response.json())
}

export function publicationChapterUrl(materialId: string, spineIndex: number): string {
  return `/materials/${encodeURIComponent(materialId)}/publication/spine/${spineIndex}`
}
