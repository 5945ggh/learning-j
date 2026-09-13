export type {
  EvidenceSummary,
  EvidenceSummaryScope,
  LexemeDecisionResult,
} from '@/lib/api-contracts'
import type {
  DecisionCreateBody,
  EvidenceSummary,
  EvidenceSummaryScope,
  LexemeDecisionResult,
} from '@/lib/api-contracts'

/**
 * Lexeme 证据客户端（`POST /lexemes/{lexeme_id}/decisions`、
 * `GET /lexemes/{lexeme_id}/evidence-summary`）。
 *
 * 契约唯一来源是生成的 `backend/fixtures/openapi.json`（DecisionCreateIn /
 * DecisionOut / EvidenceSummaryOut）。裁定是唯一的显式证据写路径：查词、
 * 阅读、播放不会调用这里的 POST。`expected_decision_seq` 是必填版本令牌
 * （data-model §0/§2.2 的乐观并发边界）：本客户端在请求前强制校验其存在，
 * 409 映射为显式冲突错误供界面提示刷新，201/200 区分新建与幂等重放。
 */

export type LexemeDecisionValue = 'known' | 'unknown' | 'clear'

export type LexemeDecisionRequest = {
  lexemeId: string
  decision: LexemeDecisionValue
  /** 本次遇到的词形表层；仅作为输入事实保存，不影响作用域。 */
  inputSurface: string
  /** 必填版本令牌：来自 evidence-summary 的当前 decision_seq（无裁定为 0）。 */
  expectedDecisionSeq: number
  operationKey: string
  inputReading?: string | null
  conjugatedForm?: string | null
  materialId?: string | null
}

/** 裁定缺少必填版本令牌：在请求发出前拒绝（契约要求的 canonical 字段）。 */
export class MissingExpectedDecisionSeqError extends Error {
  constructor() {
    super('缺少必填版本令牌 expected_decision_seq；请先读取按词证据摘要后重试')
    this.name = 'MissingExpectedDecisionSeqError'
  }
}

/** 同作用域裁定序号已变更（HTTP 409）：需要刷新摘要后重试。 */
export class DecisionConflictError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'DecisionConflictError'
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

function parseDecision(value: unknown): LexemeDecisionResult {
  const item = requireRecord(value, '裁定')
  const decision = requireString(item.decision, 'decision', '裁定')
  if (!['known', 'unknown', 'clear'].includes(decision)) {
    throw new Error('裁定响应缺少有效的 decision')
  }
  // created 是 DecisionOut 的 required 字段：缺失/非布尔直接拒绝，
  // 不把 malformed 的 201 响应误判成幂等重放。
  const created = item.created
  if (typeof created !== 'boolean') {
    throw new Error('裁定响应缺少有效的 created')
  }
  return {
    decision_id: requireString(item.decision_id, 'decision_id', '裁定'),
    lexeme_id: requireString(item.lexeme_id, 'lexeme_id', '裁定'),
    scope_form_key: requireString(item.scope_form_key, 'scope_form_key', '裁定'),
    decision: decision as LexemeDecisionValue,
    decision_seq: requireInteger(item.decision_seq, 'decision_seq', '裁定'),
    operation_key: requireString(item.operation_key, 'operation_key', '裁定'),
    created_at: requireString(item.created_at, 'created_at', '裁定'),
    created,
    evidence_id: nullableString(item.evidence_id, 'evidence_id', '裁定'),
    conjugated_form: nullableString(item.conjugated_form, 'conjugated_form', '裁定'),
  }
}

function parseSummaryScope(value: unknown): EvidenceSummaryScope {
  const item = requireRecord(value, '作用域摘要')
  const current = item.current_decision
  if (current !== null && current !== undefined && !['known', 'unknown', 'clear'].includes(current as string)) {
    throw new Error('作用域摘要响应缺少有效的 current_decision')
  }
  const counts = item.valid_source_counts
  if (!isRecord(counts)) throw new Error('作用域摘要响应缺少有效的 valid_source_counts')
  const validSourceCounts: Record<string, number> = {}
  for (const [key, count] of Object.entries(counts)) {
    validSourceCounts[key] = requireInteger(count, 'valid_source_counts', '作用域摘要')
  }
  return {
    scope_form_key: requireString(item.scope_form_key, 'scope_form_key', '作用域摘要'),
    current_decision: current === null || current === undefined ? null : current as LexemeDecisionValue,
    current_decision_id: nullableString(item.current_decision_id, 'current_decision_id', '作用域摘要'),
    current_decision_seq: item.current_decision_seq === null || item.current_decision_seq === undefined
      ? null
      : requireInteger(item.current_decision_seq, 'current_decision_seq', '作用域摘要'),
    valid_source_counts: validSourceCounts,
    known_rule_version: requireString(item.known_rule_version, 'known_rule_version', '作用域摘要'),
    resolver_version: requireString(item.resolver_version, 'resolver_version', '作用域摘要'),
    input_revision: requireInteger(item.input_revision, 'input_revision', '作用域摘要'),
  }
}

function parseSummary(value: unknown): EvidenceSummary {
  const item = requireRecord(value, '证据摘要')
  const scopes = item.scopes
  if (!Array.isArray(scopes)) throw new Error('证据摘要响应缺少有效的 scopes')
  return {
    lexeme_id: requireString(item.lexeme_id, 'lexeme_id', '证据摘要'),
    projection_revision: requireInteger(item.projection_revision, 'projection_revision', '证据摘要'),
    scopes: scopes.map(parseSummaryScope),
  }
}

async function readJson(response: Response, resource: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${resource}加载失败（${response.status}）`)
  return response.json() as Promise<unknown>
}

/** `GET /lexemes/{lexeme_id}/evidence-summary`：按词摘要（写后读一致）。 */
export async function fetchEvidenceSummary(lexemeId: string, signal?: AbortSignal): Promise<EvidenceSummary> {
  const response = await fetch(`/lexemes/${encodeURIComponent(lexemeId)}/evidence-summary`, { signal })
  if (response.status === 404) throw new Error('词元不存在')
  return parseSummary(await readJson(response, '证据摘要'))
}

/**
 * `POST /lexemes/{lexeme_id}/decisions`：显式记录 known/unknown/clear 裁定。
 *
 * - 201 新建；200 同 operation_key 同输入幂等重放（created=false）；
 * - 409 同键异输入或 expected_decision_seq 过期 → DecisionConflictError；
 * - 422（含缺令牌等校验失败）与其他非 2xx → 普通 Error。
 */
export async function postLexemeDecision(request: LexemeDecisionRequest): Promise<LexemeDecisionResult> {
  // expected_decision_seq 是必填版本令牌；缺失时在发出请求前拒绝，
  // 保证客户端永远发送 canonical 字段（不依赖后端 422 兜底）。
  if (!Number.isInteger(request.expectedDecisionSeq) || request.expectedDecisionSeq < 0) {
    throw new MissingExpectedDecisionSeqError()
  }
  const body: DecisionCreateBody = {
    decision: request.decision,
    input_surface: request.inputSurface,
    operation_key: request.operationKey,
    expected_decision_seq: request.expectedDecisionSeq,
    input_reading: request.inputReading ?? null,
    conjugated_form: request.conjugatedForm ?? null,
    material_id: request.materialId ?? null,
  }
  const response = await fetch(`/lexemes/${encodeURIComponent(request.lexemeId)}/decisions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.status === 409) {
    const detail: unknown = await response.json().catch(() => null)
    const message = isRecord(detail) && typeof detail.detail === 'string'
      ? detail.detail
      : '裁定序号已变更，请刷新后重试'
    throw new DecisionConflictError(message, 409)
  }
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => null)
    const message = isRecord(detail) && typeof detail.detail === 'string'
      ? detail.detail
      : `裁定提交失败（${response.status}）`
    throw new Error(message)
  }
  return parseDecision(await response.json() as unknown)
}
