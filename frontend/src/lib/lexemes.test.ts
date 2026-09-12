import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DecisionConflictError,
  MissingExpectedDecisionSeqError,
  fetchEvidenceSummary,
  postLexemeDecision,
} from './lexemes'
import { fixtureDecision, fixtureEvidenceSummary, fixtureEvidenceSummaryUndecided } from './reader-fixtures'

afterEach(() => vi.unstubAllGlobals())

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const baseRequest = {
  lexemeId: 'lx_da636c71bab3557686de138257d58e6dec4abbbfc2eaabfac6c70ca7eb5d5150',
  decision: 'known' as const,
  inputSurface: '君',
  expectedDecisionSeq: 0,
  operationKey: 'lexeme-decision:known:lx_da636c71bab3557686de138257d58e6dec4abbbfc2eaabfac6c70ca7eb5d5150:0',
}

describe('lexeme 证据客户端（decisions / evidence-summary）', () => {
  it('发出 canonical 请求体：decision、input_surface、operation_key 与必填 expected_decision_seq', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(fixtureDecision, 201)))
    vi.stubGlobal('fetch', fetchMock)
    await postLexemeDecision(baseRequest)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`/lexemes/${baseRequest.lexemeId}/decisions`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toEqual({
      decision: 'known',
      input_surface: '君',
      operation_key: baseRequest.operationKey,
      expected_decision_seq: 0,
      input_reading: null,
      conjugated_form: null,
      material_id: null,
    })
  })

  it('201 解析为 created=true 的裁定结果', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(fixtureDecision, 201))))
    const result = await postLexemeDecision(baseRequest)
    expect(result.created).toBe(true)
    expect(result.decision).toBe('known')
    expect(result.decision_seq).toBe(1)
    expect(result.scope_form_key).toBe('lexeme:')
    expect(result.evidence_id).toBe('fixture-id-013')
  })

  it('200 幂等重放解析为 created=false（同 operation_key 同输入）', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ ...fixtureDecision, created: false }, 200))))
    const result = await postLexemeDecision(baseRequest)
    expect(result.created).toBe(false)
    expect(result.decision_id).toBe('fixture-id-012')
  })

  it('malformed 的 201 响应（缺失或非布尔 created）被拒绝，不误判为幂等重放', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ ...fixtureDecision, created: undefined }, 201))))
    await expect(postLexemeDecision(baseRequest)).rejects.toThrow('created')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ ...fixtureDecision, created: 'yes' }, 201))))
    await expect(postLexemeDecision(baseRequest)).rejects.toThrow('created')
  })

  it('expected_decision_seq 缺失/非法时在请求发出前拒绝（不发送任何 POST）', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(postLexemeDecision({ ...baseRequest, expectedDecisionSeq: undefined as unknown as number }))
      .rejects.toBeInstanceOf(MissingExpectedDecisionSeqError)
    await expect(postLexemeDecision({ ...baseRequest, expectedDecisionSeq: -1 }))
      .rejects.toBeInstanceOf(MissingExpectedDecisionSeqError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('409 过期序号映射为 DecisionConflictError 并携带后端 detail', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(
      { detail: "作用域 'lexeme:' 的裁定序号已变更（expected=0, current=2）；请刷新后重试" },
      409,
    ))))
    const error = await postLexemeDecision(baseRequest).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(DecisionConflictError)
    expect((error as DecisionConflictError).status).toBe(409)
    expect((error as Error).message).toContain('expected=0, current=2')
  })

  it('422（含缺令牌等校验失败）解析后端 detail 为普通错误', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ detail: 'expected_decision_seq 必填' }, 422))))
    await expect(postLexemeDecision(baseRequest)).rejects.toThrow('expected_decision_seq')
  })

  it('请求面只落在 lexemes 端点且为 JSON POST', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(fixtureDecision, 201)))
    vi.stubGlobal('fetch', fetchMock)
    await postLexemeDecision(baseRequest)
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url.startsWith('/lexemes/')).toBe(true)
    expect(url.endsWith('/decisions')).toBe(true)
  })

  it('evidence-summary 解析未裁定词元的空 scopes（真实后端行为）', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(fixtureEvidenceSummaryUndecided)))
    vi.stubGlobal('fetch', fetchMock)
    const summary = await fetchEvidenceSummary('lx_f7b9')
    expect(fetchMock).toHaveBeenCalledWith('/lexemes/lx_f7b9/evidence-summary', { signal: undefined })
    expect(summary.projection_revision).toBe(0)
    expect(summary.scopes).toEqual([])
  })

  it('evidence-summary 解析已裁定 scope（写后读一致的读取面）', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(fixtureEvidenceSummary))))
    const summary = await fetchEvidenceSummary('lx_da63')
    expect(summary.scopes[0]!.current_decision).toBe('known')
    expect(summary.scopes[0]!.current_decision_seq).toBe(1)
    expect(summary.scopes[0]!.valid_source_counts).toEqual({ user_asserted: 1 })
  })
})
