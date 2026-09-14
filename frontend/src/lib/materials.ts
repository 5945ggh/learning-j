export type {
  Material,
  MaterialLexemeCount,
  MaterialLexemeCounts,
  Sentence,
  Sidecar,
} from '@/lib/api-contracts'
import type { Material, MaterialLexemeCounts, Sentence, Sidecar } from '@/lib/api-contracts'
import type { components } from '@/lib/api-types'

/** Stable aliases retained for existing component/repository imports. */
export type MaterialKind = components['schemas']['MaterialOut']['kind']
export type MaterialStorageMode = components['schemas']['MaterialOut']['storage_mode']

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

/** 后端 `POST /materials` 对不支持的扩展名返回 415；前端校验沿用同一句 detail 文案。 */
export const MATERIAL_IMPORT_TYPE_DETAIL = '仅支持 .txt、.srt、.vtt、.epub'

const SUPPORTED_IMPORT_EXTENSIONS = new Set(['txt', 'srt', 'vtt', 'epub'])

/**
 * 提取文件扩展名（小写、不含点）。与后端 `filename.rsplit('.', 1)[-1].lower()`
 * 的语义一致；没有扩展名时返回空串。用 `split` 而非 `slice` 族，保持
 * code point 硬约束下的实现一致性。
 */
export function materialFilenameExtension(filename: string): string {
  const parts = filename.split('.')
  const last = parts[parts.length - 1]
  return parts.length < 2 || last === undefined ? '' : last.toLowerCase()
}

/** 是否为后端 `POST /materials` 接受的导入扩展名（.txt/.srt/.vtt/.epub）。 */
export function isSupportedImportFilename(filename: string): boolean {
  return SUPPORTED_IMPORT_EXTENSIONS.has(materialFilenameExtension(filename))
}

/** 默认标题：去掉最后一个扩展名；纯扩展名（如 `.txt`）或无扩展名时回退为原文件名。 */
export function materialDefaultTitle(filename: string): string {
  const parts = filename.split('.')
  if (parts.length < 2) return filename
  const stem = parts.slice(0, -1).join('.')
  return stem === '' ? filename : stem
}

/** `POST /materials` 的 multipart 输入；locator 与 storage_mode 留给后端默认值，不进 UI。 */
export type MaterialImportInput = {
  /** 必填；仅接受 .txt/.srt/.vtt/.epub，其余扩展名后端返回 415。 */
  file: File
  /** 可选展示标题；空白字符串视为未提供。 */
  title?: string
}

/** FastAPI 校验错误（detail 为数组）与其他非 JSON 错误体的兜底展示文本。 */
function errorDetailText(response: Response, detail: unknown): string {
  if (typeof detail === 'string' && detail.trim() !== '') return detail
  if (Array.isArray(detail)) {
    const messages = detail
      .map((part) => (isRecord(part) && typeof part.msg === 'string' ? part.msg : null))
      .filter((message): message is string => message !== null)
    if (messages.length > 0) return messages.join('；')
  }
  return `素材导入失败（${response.status}）`
}

async function importError(response: Response): Promise<Error> {
  try {
    const body: unknown = await response.json()
    if (isRecord(body)) return new Error(errorDetailText(response, body.detail))
  } catch {
    // 响应体不是 JSON（例如代理错误页）时走通用文案。
  }
  return new Error(`素材导入失败（${response.status}）`)
}

/**
 * `POST /materials`：multipart 导入素材，成功返回 201 与 MaterialOut（复用
 * `parseMaterial` 的字段校验）。locator 留给后端取默认值；EPUB 显式请求
 * managed_copy，其他格式沿用 external_reference。415 与 422 的后端 detail
 * 文本会作为 Error message 带给调用方，供 UI 直接展示。
 */
export async function createMaterial(
  input: MaterialImportInput,
  signal?: AbortSignal,
): Promise<Material> {
  const form = new FormData()
  form.append('file', input.file, input.file.name)
  const title = input.title?.trim() ?? ''
  if (title !== '') form.append('title', title)
  // RF-01 EPUB reader paths require an immutable server-managed copy.  Keep
  // existing txt/srt/vtt imports on their historical external-reference path.
  if (materialFilenameExtension(input.file.name) === 'epub') {
    form.append('storage_mode', 'managed_copy')
  }
  const response = await fetch('/materials', { method: 'POST', body: form, signal })
  if (!response.ok) throw await importError(response)
  return parseMaterial(await readJson(response, '素材'))
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
