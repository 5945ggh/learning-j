export type {
  DictionaryDefinition,
  DictionaryEntry,
  DictionaryLookupResult,
  DictionarySearchResult,
  DictionarySource,
} from '@/lib/api-contracts'
import type {
  DictionaryDefinition,
  DictionaryEntry,
  DictionaryLookupResult,
  DictionarySearchResult,
  DictionarySource,
} from '@/lib/api-contracts'

/**
 * 词典客户端（`GET /dictionaries`、`GET /dictionaries/lookup`、
 * `GET /dictionaries/search`）。
 *
 * 契约唯一来源是生成的 `backend/fixtures/openapi.json`。查词是纯只读
 * 路径：不产生 KE、不创建 KnowledgePoint（data-model §9 不变量 8）。
 * FTS5 派生索引损坏/缺失时后端返回 503，客户端把它映射为显式的
 * `fts_unavailable` 错误，让界面能区分「无结果」与「搜索索引不可用」。
 */

/** 查词典错误分类：`fts_unavailable` 对应后端 503（FTS 派生索引缺失/损坏）。 */
export type DictionaryRequestErrorKind = 'http' | 'fts_unavailable'

export class DictionaryRequestError extends Error {
  readonly kind: DictionaryRequestErrorKind
  readonly status: number

  constructor(kind: DictionaryRequestErrorKind, status: number, message: string) {
    super(message)
    this.name = 'DictionaryRequestError'
    this.kind = kind
    this.status = status
  }
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

function nullableString(value: unknown, field: string, resource: string): string | null {
  if (value === null || value === undefined) return null
  return requireString(value, field, resource)
}

function nullableInteger(value: unknown, field: string, resource: string): number | null {
  if (value === null || value === undefined) return null
  return requireInteger(value, field, resource)
}

function parseDefinition(value: unknown): DictionaryDefinition {
  const item = requireRecord(value, '释义')
  const structured = item.structured_content
  return {
    ordinal: requireInteger(item.ordinal, 'ordinal', '释义'),
    plain_text: requireString(item.plain_text, 'plain_text', '释义'),
    structured_content: structured === null || structured === undefined
      ? null
      : requireRecord(structured, '释义'),
  }
}

function parseEntry(value: unknown): DictionaryEntry {
  const item = requireRecord(value, '词条')
  const tags = item.tags
  const definitions = item.definitions
  if (!Array.isArray(tags)) throw new Error('词条响应缺少有效的 tags')
  if (!Array.isArray(definitions)) throw new Error('词条响应缺少有效的 definitions')
  return {
    source_id: requireString(item.source_id, 'source_id', '词条'),
    display_name: requireString(item.display_name, 'display_name', '词条'),
    source_version: requireString(item.source_version, 'source_version', '词条'),
    source_local_id: requireString(item.source_local_id, 'source_local_id', '词条'),
    expression: requireString(item.expression, 'expression', '词条'),
    reading: nullableString(item.reading, 'reading', '词条'),
    tags: tags.map((tag) => requireString(tag, 'tags', '词条')),
    score: requireInteger(item.score, 'score', '词条'),
    sequence: nullableInteger(item.sequence, 'sequence', '词条'),
    definitions: definitions.map(parseDefinition),
  }
}

function parseSource(value: unknown): DictionarySource {
  const item = requireRecord(value, '词典来源')
  return {
    id: requireString(item.id, 'id', '词典来源'),
    format: requireString(item.format, 'format', '词典来源'),
    display_name: requireString(item.display_name, 'display_name', '词典来源'),
    source_version: requireString(item.source_version, 'source_version', '词典来源'),
    schema_version: requireString(item.schema_version, 'schema_version', '词典来源'),
    archive_hash: requireString(item.archive_hash, 'archive_hash', '词典来源'),
    imported_at: requireString(item.imported_at, 'imported_at', '词典来源'),
  }
}

async function readJson(response: Response, resource: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${resource}加载失败（${response.status}）`)
  return response.json() as Promise<unknown>
}

function parseRequestError(response: Response, resource: string): DictionaryRequestError {
  // 503 是后端对 FTS 派生索引缺失/损坏的显式失败边界（ADR-032：可见失败，
  // 不静默降级为空结果），单独分类供界面提示重建/稍后重试。
  if (response.status === 503) {
    return new DictionaryRequestError('fts_unavailable', 503, `${resource}暂不可用（503）：搜索索引缺失或损坏，请稍后重试`)
  }
  return new DictionaryRequestError('http', response.status, `${resource}加载失败（${response.status}）`)
}

/** `GET /dictionaries`：已导入词典来源列表（区分「无词典」与「无结果」）。 */
export async function fetchDictionaries(signal?: AbortSignal): Promise<DictionarySource[]> {
  const response = await fetch('/dictionaries', { signal })
  if (!response.ok) throw parseRequestError(response, '词典来源')
  const body = await readJson(response, '词典来源')
  if (!Array.isArray(body)) throw new Error('词典来源响应格式无效')
  return body.map(parseSource)
}

/** `GET /dictionaries/lookup?expression=&reading=`：精确查找；无命中为空 entries。 */
export async function lookupDictionary(
  expression: string,
  options: { reading?: string | null; signal?: AbortSignal } = {},
): Promise<DictionaryLookupResult> {
  const params = new URLSearchParams({ expression })
  if (options.reading) params.set('reading', options.reading)
  const response = await fetch(`/dictionaries/lookup?${params.toString()}`, { signal: options.signal })
  if (!response.ok) throw parseRequestError(response, '词典查词')
  const body = requireRecord(await readJson(response, '词典查词'), '词典查词')
  const entries = body.entries
  if (!Array.isArray(entries)) throw new Error('词典查词响应缺少有效的 entries')
  return {
    expression: requireString(body.expression, 'expression', '词典查词'),
    reading: nullableString(body.reading, 'reading', '词典查词'),
    entries: entries.map(parseEntry),
  }
}

/** `GET /dictionaries/search?query=`：精确优先 + FTS5 前缀；503 显式失败。 */
export async function searchDictionary(
  query: string,
  options: { signal?: AbortSignal } = {},
): Promise<DictionarySearchResult> {
  const params = new URLSearchParams({ query })
  const response = await fetch(`/dictionaries/search?${params.toString()}`, { signal: options.signal })
  if (!response.ok) throw parseRequestError(response, '词典搜索')
  const body = requireRecord(await readJson(response, '词典搜索'), '词典搜索')
  const entries = body.entries
  if (!Array.isArray(entries)) throw new Error('词典搜索响应缺少有效的 entries')
  return {
    query: requireString(body.query, 'query', '词典搜索'),
    entries: entries.map(parseEntry),
  }
}
