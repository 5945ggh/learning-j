import { asSentenceText } from '@/lib/text'
export type { Annotation, AnnotationSpan } from '@/lib/api-contracts'
import type { Annotation, AnnotationSpan } from '@/lib/api-contracts'

export type AnnotationListOptions = {
  q?: string | null
  since?: string | null
  until?: string | null
  limit?: number
  offset?: number
  signal?: AbortSignal
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown, resource: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${resource}响应格式无效`)
  return value
}

function string(value: unknown, field: string, resource: string): string {
  if (typeof value !== 'string') throw new Error(`${resource}响应缺少有效的 ${field}`)
  return value
}

function nullableString(value: unknown, field: string, resource: string): string | null {
  if (value === null || value === undefined) return null
  return string(value, field, resource)
}

function integer(value: unknown, field: string, resource: string): number {
  if (!Number.isInteger(value)) throw new Error(`${resource}响应缺少有效的 ${field}`)
  return value as number
}

function nullableInteger(value: unknown, field: string, resource: string): number | null {
  if (value === null || value === undefined) return null
  return integer(value, field, resource)
}

function parseSpan(value: unknown): AnnotationSpan {
  const item = record(value, '批注 Span')
  const status = string(item.alignment_status, 'alignment_status', '批注 Span')
  if (!['aligned', 'partial', 'ambiguous', 'unaligned'].includes(status)) throw new Error('批注 Span响应缺少有效的 alignment_status')
  const start = integer(item.char_start, 'char_start', '批注 Span')
  const end = integer(item.char_end, 'char_end', '批注 Span')
  if (start < 0 || end <= start) throw new Error('批注 Span 不是合法的 code point 半开区间')
  return {
    span_id: string(item.span_id, 'span_id', '批注 Span'),
    sentence_id: string(item.sentence_id, 'sentence_id', '批注 Span'),
    surface: asSentenceText(string(item.surface, 'surface', '批注 Span')),
    char_start: start,
    char_end: end,
    alignment_sidecar_id: nullableString(item.alignment_sidecar_id, 'alignment_sidecar_id', '批注 Span'),
    token_start: nullableInteger(item.token_start, 'token_start', '批注 Span'),
    token_end: nullableInteger(item.token_end, 'token_end', '批注 Span'),
    alignment_status: status as AnnotationSpan['alignment_status'],
  }
}

function parseAnnotation(value: unknown): Annotation {
  const item = record(value, '批注')
  const spans = item.spans
  if (!Array.isArray(spans)) throw new Error('批注响应缺少有效的 spans')
  return {
    id: string(item.id, 'id', '批注'),
    material_id: string(item.material_id, 'material_id', '批注'),
    created_at: string(item.created_at, 'created_at', '批注'),
    spans: spans.map(parseSpan),
    note: nullableString(item.note, 'note', '批注'),
    color: nullableString(item.color, 'color', '批注'),
  }
}

async function readJson(response: Response, resource: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${resource}加载失败（${response.status}）`)
  return response.json() as Promise<unknown>
}

/** `GET /materials/{material_id}/annotations` — read-only annotation list. */
export async function fetchAnnotations(materialId: string, options: AnnotationListOptions = {}): Promise<Annotation[]> {
  const params = new URLSearchParams()
  if (options.q) params.set('q', options.q)
  if (options.since) params.set('since', options.since)
  if (options.until) params.set('until', options.until)
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.offset !== undefined) params.set('offset', String(options.offset))
  const query = params.toString()
  const suffix = query ? `?${query}` : ''
  const response = await fetch(`/materials/${encodeURIComponent(materialId)}/annotations${suffix}`, { signal: options.signal })
  const body = await readJson(response, '批注')
  if (!Array.isArray(body)) throw new Error('批注响应格式无效')
  return body.map(parseAnnotation)
}
