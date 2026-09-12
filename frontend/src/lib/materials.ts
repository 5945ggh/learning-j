export type MaterialKind = 'subtitle_video' | 'subtitle_audio' | 'text' | 'epub'

export type MaterialStorageMode = 'external_reference' | 'managed_copy'

export type Material = {
  id: string
  title: string
  content_hash: string
  locator: string
  kind: MaterialKind
  copy_stored: boolean
  storage_mode: MaterialStorageMode
  source_sha256: string | null
  current_sidecar_id: string | null
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
  anchor_payload: Record<string, unknown>
}

export type Sidecar = {
  material_id: string
  sidecar_generation_id: string
  content_hash: string
  segmenter_version: string
  tokenizer_version: string
  analyzer_dict_version: string
  payload: Record<string, unknown>
}

/** 单条稀疏词频（OpenAPI `MaterialLexemeCountOut`）。 */
export type MaterialLexemeCount = {
  lexeme_id: string
  token_count: number
}

/**
 * 单代次材料词频（OpenAPI `MaterialLexemeCountsOut`，data-model §2.5/§11）。
 * 契约保证一个响应只携带一个 sidecar 代次的词频。
 */
export type MaterialLexemeCounts = {
  material_id: string
  sidecar_generation_id: string
  counts: MaterialLexemeCount[]
}

/** Return an EPUB spine index only when the anchor contract carries a valid location. */
export function parseEpubSpineIndex(
  anchorType: Sentence['anchor_type'],
  anchorPayload: Record<string, unknown>,
): number | null {
  if (anchorType !== 'epub') return null
  const value = anchorPayload.spine_index
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, resource: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${resource} 响应格式无效`)
  return value
}

function requireString(value: unknown, field: string, resource: string): string {
  if (typeof value !== 'string') throw new Error(`${resource}响应缺少有效的 ${field}`)
  return value
}

function requireInteger(value: unknown, field: string, resource: string): number {
  if (!Number.isInteger(value)) throw new Error(`${resource}响应缺少有效的 ${field}`)
  return value as number
}

function requireBoolean(value: unknown, field: string, resource: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${resource}响应缺少有效的 ${field}`)
  return value
}

function nullableInteger(value: unknown, field: string, resource: string): number | null {
  if (value === null || value === undefined) return null
  return requireInteger(value, field, resource)
}

function parseMaterial(value: unknown): Material {
  const item = requireRecord(value, '素材')
  // 按字段顺序校验，缺字段时报告最靠前的缺失项。
  const id = requireString(item.id, 'id', '素材')
  const title = requireString(item.title, 'title', '素材')
  const contentHash = requireString(item.content_hash, 'content_hash', '素材')
  const locator = requireString(item.locator, 'locator', '素材')
  const kind = requireString(item.kind, 'kind', '素材')
  if (!['subtitle_video', 'subtitle_audio', 'text', 'epub'].includes(kind)) {
    throw new Error('素材响应缺少有效的 kind')
  }
  const storageMode = requireString(item.storage_mode, 'storage_mode', '素材')
  if (!['external_reference', 'managed_copy'].includes(storageMode)) {
    throw new Error('素材响应缺少有效的 storage_mode')
  }
  return {
    id,
    title,
    content_hash: contentHash,
    locator,
    kind: kind as MaterialKind,
    copy_stored: requireBoolean(item.copy_stored, 'copy_stored', '素材'),
    storage_mode: storageMode as MaterialStorageMode,
    source_sha256: item.source_sha256 === null || item.source_sha256 === undefined
      ? null
      : requireString(item.source_sha256, 'source_sha256', '素材'),
    current_sidecar_id: item.current_sidecar_id === null || item.current_sidecar_id === undefined
      ? null
      : requireString(item.current_sidecar_id, 'current_sidecar_id', '素材'),
    sentence_count: requireInteger(item.sentence_count, 'sentence_count', '素材'),
  }
}

function parseSentence(value: unknown): Sentence {
  const item = requireRecord(value, '句子')
  const anchorType = requireString(item.anchor_type, 'anchor_type', '句子')
  if (!['subtitle', 'plain_text', 'epub'].includes(anchorType)) {
    throw new Error('句子响应缺少有效的 anchor_type')
  }
  return {
    id: requireString(item.id, 'id', '句子'),
    material_id: requireString(item.material_id, 'material_id', '句子'),
    index: requireInteger(item.index, 'index', '句子'),
    text: requireString(item.text, 'text', '句子'),
    time_start: nullableInteger(item.time_start, 'time_start', '句子'),
    time_end: nullableInteger(item.time_end, 'time_end', '句子'),
    translation: item.translation === null || item.translation === undefined
      ? null
      : requireString(item.translation, 'translation', '句子'),
    anchor_type: anchorType as Sentence['anchor_type'],
    anchor_payload: requireRecord(item.anchor_payload, '句子'),
  }
}

function parseSidecar(value: unknown): Sidecar {
  const item = requireRecord(value, 'sidecar')
  return {
    material_id: requireString(item.material_id, 'material_id', 'sidecar'),
    sidecar_generation_id: requireString(item.sidecar_generation_id, 'sidecar_generation_id', 'sidecar'),
    content_hash: requireString(item.content_hash, 'content_hash', 'sidecar'),
    segmenter_version: requireString(item.segmenter_version, 'segmenter_version', 'sidecar'),
    tokenizer_version: requireString(item.tokenizer_version, 'tokenizer_version', 'sidecar'),
    analyzer_dict_version: requireString(item.analyzer_dict_version, 'analyzer_dict_version', 'sidecar'),
    payload: requireRecord(item.payload, 'sidecar'),
  }
}

function parseLexemeCounts(value: unknown): MaterialLexemeCounts {
  const item = requireRecord(value, '词频')
  const countsValue = item.counts
  if (!Array.isArray(countsValue)) throw new Error('词频响应缺少有效的 counts')
  return {
    material_id: requireString(item.material_id, 'material_id', '词频'),
    sidecar_generation_id: requireString(item.sidecar_generation_id, 'sidecar_generation_id', '词频'),
    counts: countsValue.map((entry) => {
      const record = requireRecord(entry, '词频')
      return {
        lexeme_id: requireString(record.lexeme_id, 'lexeme_id', '词频'),
        token_count: requireInteger(record.token_count, 'token_count', '词频'),
      }
    }),
  }
}

async function readJson(response: Response, resource: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${resource}加载失败（${response.status}）`)
  return response.json() as Promise<unknown>
}

export async function fetchMaterials(signal?: AbortSignal): Promise<Material[]> {
  const response = await fetch('/materials', { signal })
  const body = await readJson(response, '素材')
  if (!Array.isArray(body)) throw new Error('素材响应格式无效')
  return body.map(parseMaterial)
}

export async function fetchSentences(materialId: string, signal?: AbortSignal): Promise<Sentence[]> {
  const response = await fetch(`/materials/${encodeURIComponent(materialId)}/sentences`, { signal })
  const body = await readJson(response, '句子')
  if (!Array.isArray(body)) throw new Error('句子响应格式无效')
  return body.map(parseSentence)
}

export async function fetchSidecar(materialId: string, signal?: AbortSignal): Promise<Sidecar> {
  const response = await fetch(`/materials/${encodeURIComponent(materialId)}/sidecar`, { signal })
  return parseSidecar(await readJson(response, 'sidecar'))
}

/** `GET /materials/{material_id}/lexeme-counts`：单代次稀疏材料词频。 */
export async function fetchLexemeCounts(
  materialId: string,
  signal?: AbortSignal,
): Promise<MaterialLexemeCounts> {
  const response = await fetch(`/materials/${encodeURIComponent(materialId)}/lexeme-counts`, { signal })
  return parseLexemeCounts(await readJson(response, '词频'))
}
