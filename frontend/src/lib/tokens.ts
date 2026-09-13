import { asSentenceText } from '@/lib/text'
export type { AlgorithmToken, SentenceTokens, TokenProvenance } from '@/lib/api-contracts'
import type { AlgorithmToken, SentenceTokens, TokenProvenance } from '@/lib/api-contracts'

/**
 * 算法 token 客户端（`GET /sentences/{sentence_id}/tokens`）。
 *
 * 契约唯一来源是生成的 `backend/fixtures/openapi.json`（SentenceTokensOut /
 * AlgorithmTokenOut / TokenProvenanceOut）。偏移是 Unicode code point 半开
 * 区间（data-model §0），与句子文本（同样来自后端）可直接换算；本客户端
 * 不改写偏移语义，token 表层是原文切片而不是前端拼接结果。
 */

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

function requireStringArray(value: unknown, field: string, resource: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${resource}响应缺少有效的 ${field}`)
  return value.map((item) => requireString(item, field, resource))
}

function parseProvenance(value: unknown): TokenProvenance {
  const item = requireRecord(value, '词典来源')
  return {
    source_id: requireString(item.source_id, 'source_id', '词典来源'),
    display_name: requireString(item.display_name, 'display_name', '词典来源'),
    source_version: requireString(item.source_version, 'source_version', '词典来源'),
  }
}

function parseToken(value: unknown): AlgorithmToken {
  const item = requireRecord(value, 'token')
  const token: AlgorithmToken = {
    surface: asSentenceText(requireString(item.surface, 'surface', 'token')),
    normalized_form: requireString(item.normalized_form, 'normalized_form', 'token'),
    pos: requireString(item.pos, 'pos', 'token'),
    reading_form: requireString(item.reading_form, 'reading_form', 'token'),
    reading_source: requireString(item.reading_source, 'reading_source', 'token'),
    lexeme_id: requireString(item.lexeme_id, 'lexeme_id', 'token'),
    char_start: requireInteger(item.char_start, 'char_start', 'token'),
    char_end: requireInteger(item.char_end, 'char_end', 'token'),
    dictionary_source_ids: requireStringArray(item.dictionary_source_ids, 'dictionary_source_ids', 'token'),
  }
  if (token.char_start < 0 || token.char_end < token.char_start) {
    throw new Error('token 偏移不是合法的 code point 半开区间')
  }
  return token
}

function parseSentenceTokens(value: unknown): SentenceTokens {
  const item = requireRecord(value, 'token 表')
  const sourcesValue = item.dictionary_sources
  const tokensValue = item.tokens
  if (!Array.isArray(sourcesValue)) throw new Error('token 表响应缺少有效的 dictionary_sources')
  if (!Array.isArray(tokensValue)) throw new Error('token 表响应缺少有效的 tokens')
  return {
    sentence_id: requireString(item.sentence_id, 'sentence_id', 'token 表'),
    material_id: requireString(item.material_id, 'material_id', 'token 表'),
    sidecar_generation_id: requireString(item.sidecar_generation_id, 'sidecar_generation_id', 'token 表'),
    segmenter_version: requireString(item.segmenter_version, 'segmenter_version', 'token 表'),
    tokenizer_version: requireString(item.tokenizer_version, 'tokenizer_version', 'token 表'),
    analyzer_dict_version: requireString(item.analyzer_dict_version, 'analyzer_dict_version', 'token 表'),
    dictionary_sources: sourcesValue.map(parseProvenance),
    tokens: tokensValue.map(parseToken),
  }
}

async function readJson(response: Response, resource: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${resource}加载失败（${response.status}）`)
  return response.json() as Promise<unknown>
}

/** `GET /sentences/{sentence_id}/tokens`：当前已发布代次的算法 token 视图。 */
export async function fetchSentenceTokens(sentenceId: string, signal?: AbortSignal): Promise<SentenceTokens> {
  const response = await fetch(`/sentences/${encodeURIComponent(sentenceId)}/tokens`, { signal })
  return parseSentenceTokens(await readJson(response, 'token 表'))
}
