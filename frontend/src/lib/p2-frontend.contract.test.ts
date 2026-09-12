/// <reference types="node" />

/**
 * P2-frontend 契约测试（`CURRENT-PACKETS.md` P2-frontend）。
 *
 * 锁定「P2 客户端/组件消费面 ↔ 生成的 OpenAPI/reader fixture」的一致性：
 * - 生成 OpenAPI 必须携带 P2 阅读器面的必需路径（token/词典查词/搜索/
 *   词典列表/Lexeme 裁定/按词摘要）；`DecisionCreateIn` 的必填集合必须
 *   包含 canonical 版本令牌 `expected_decision_seq`（f3d22c1 修复后的契约）；
 * - 客户端对生成 reader-fixture 的解析结果与 `reader-fixtures.ts` 中
 *   发布给 P3 的 props fixture 逐字段相等；
 * - token 偏移按 code point 契约可对句文本切片（切片 == surface）；
 * - 查词/裁定请求面无凭证材料；裁定写入仅来自显式提交。
 *
 * P1 集成测试（p0/p1-integration.contract.test.ts）零改动，继续原样执行。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSentenceTokens } from './tokens'
import { fetchDictionaries, lookupDictionary, searchDictionary } from './dictionary'
import { fetchEvidenceSummary, postLexemeDecision } from './lexemes'
import {
  fixtureDecision,
  fixtureDictionaries,
  fixtureEvidenceSummary,
  fixtureLookupResult,
  fixtureSearchResult,
  fixtureSentenceTokens,
} from './reader-fixtures'
import { fixtureTextSentences } from './material-fixtures'
import { sliceByCodePoint } from './text'

type JsonRecord = Record<string, unknown>

const repoArtifact = (path: string) => fileURLToPath(new URL(`../../../backend/${path}`, import.meta.url))

function readArtifact(envName: string, fallback: string): JsonRecord {
  const path = process.env[envName] ?? repoArtifact(fallback)
  return JSON.parse(readFileSync(path, 'utf8')) as JsonRecord
}

const openapi = readArtifact('LEARNINGJ_OPENAPI_PATH', 'fixtures/openapi.json')
const readerFixture = readArtifact('LEARNINGJ_READER_FIXTURE_PATH', 'fixtures/reader-fixture.json')

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return value as JsonRecord
}

function schema(name: string): JsonRecord {
  const components = record(openapi.components, 'openapi.components')
  const all = record(components.schemas, 'openapi.components.schemas')
  return record(all[name], `OpenAPI schema ${name}`)
}

function requiredOf(name: string): string[] {
  const required = schema(name).required
  if (!Array.isArray(required)) throw new Error(`schema ${name} 缺少 required`)
  return required as string[]
}

function fixtureSection(name: string): JsonRecord {
  return record(readerFixture[name], `reader fixture ${name}`)
}

function paths(): JsonRecord {
  return record(openapi.paths, 'openapi.paths')
}

/** fetch 首参统一成 URL 字符串（Request/URL 不走默认 toString）。 */
function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('生成 OpenAPI 的 P2 阅读器面（必需路径子集 + 令牌契约）', () => {
  it('携带 token/词典查词/搜索/词典列表/裁定/按词摘要路径', () => {
    const all = paths()
    for (const path of [
      '/sentences/{sentence_id}/tokens',
      '/dictionaries',
      '/dictionaries/lookup',
      '/dictionaries/search',
      '/lexemes/{lexeme_id}/decisions',
      '/lexemes/{lexeme_id}/evidence-summary',
    ]) {
      expect(all[path], `缺少路径 ${path}`).toBeTruthy()
    }
  })

  it('DecisionCreateIn 必填 canonical 字段含 expected_decision_seq（不可省略令牌）', () => {
    expect(requiredOf('DecisionCreateIn')).toEqual(
      expect.arrayContaining(['decision', 'input_surface', 'operation_key', 'expected_decision_seq']),
    )
  })

  it('SentenceTokensOut / AlgorithmTokenOut / TokenProvenanceOut 必填集合与客户端类型一致', () => {
    expect(requiredOf('SentenceTokensOut')).toEqual([
      'sentence_id', 'material_id', 'sidecar_generation_id', 'segmenter_version',
      'tokenizer_version', 'analyzer_dict_version', 'dictionary_sources', 'tokens',
    ])
    expect(requiredOf('AlgorithmTokenOut')).toEqual([
      'surface', 'normalized_form', 'pos', 'reading_form', 'reading_source',
      'lexeme_id', 'char_start', 'char_end', 'dictionary_source_ids',
    ])
    expect(requiredOf('TokenProvenanceOut')).toEqual(['source_id', 'display_name', 'source_version'])
  })

  it('DecisionOut / EvidenceSummaryOut 必填集合覆盖客户端解析字段', () => {
    expect(requiredOf('DecisionOut')).toEqual(expect.arrayContaining([
      'decision_id', 'lexeme_id', 'scope_form_key', 'decision', 'decision_seq',
      'operation_key', 'created_at', 'created',
    ]))
    expect(requiredOf('EvidenceSummaryOut')).toEqual(['lexeme_id', 'projection_revision', 'scopes'])
  })
})

describe('客户端对生成 reader-fixture 的解析与 P3 props fixture 一致', () => {
  it('tokens/txt：客户端解析结果逐字段等于 reader-fixtures 的 fixtureSentenceTokens', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      capturedUrl = urlOf(input)
      return Promise.resolve(jsonResponse(fixtureSection('tokens/txt')))
    }))
    const parsed = await fetchSentenceTokens('fixture-id-003')
    expect(capturedUrl).toBe('/sentences/fixture-id-003/tokens')
    expect(parsed).toEqual(fixtureSentenceTokens)
  })

  it('dictionary/lookup：解析结果逐字段等于 fixtureLookupResult', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(fixtureSection('dictionary/lookup')))))
    const parsed = await lookupDictionary('君')
    expect(parsed).toEqual(fixtureLookupResult)
  })

  it('dictionary/search：解析结果逐字段等于 fixtureSearchResult', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(fixtureSection('dictionary/search')))))
    const parsed = await searchDictionary('頑')
    expect(parsed).toEqual(fixtureSearchResult)
  })

  it('dictionary/source：词典来源解析等于 fixtureDictionaries', async () => {
    const runSource = fixtureSection('dictionary/source').source
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse([runSource]))))
    const parsed = await fetchDictionaries()
    expect(parsed).toEqual(fixtureDictionaries)
  })

  it('evidence/decision + evidence/summary：裁定与摘要解析等于对应 fixture', async () => {
    const decision = fixtureSection('evidence/decision')
    const summary = fixtureSection('evidence/summary')
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (init?.method === 'POST') return Promise.resolve(jsonResponse(decision, 201))
      if (url.endsWith('/evidence-summary')) return Promise.resolve(jsonResponse(summary))
      throw new Error(`unexpected: ${url}`)
    }))
    const posted = await postLexemeDecision({
      lexemeId: fixtureEvidenceSummary.lexeme_id,
      decision: 'known',
      inputSurface: '君',
      expectedDecisionSeq: 0,
      operationKey: 'lexeme-decision:known:probe:0',
    })
    expect(posted).toEqual(fixtureDecision)
    const fetched = await fetchEvidenceSummary(fixtureEvidenceSummary.lexeme_id)
    expect(fetched).toEqual(fixtureEvidenceSummary)
  })

  it('reader fixture 的字典来源显示名与 tokens provenance 一致', () => {
    const source = record(fixtureSection('dictionary/source').source, 'dictionary/source.source')
    const provenance = fixtureSentenceTokens.dictionary_sources.at(0)
    if (!provenance) throw new Error('fixtureSentenceTokens 缺少词典来源')
    expect(source.id).toBe(provenance.source_id)
    expect(source.display_name).toBe(provenance.display_name)
    expect(source.source_version).toBe(provenance.source_version)
  })
})

describe('token 偏移的 code point 契约（BMP 外安全）', () => {
  it('每个 token 的 code point 切片 == surface（对生成 fixture 的 token 表）', () => {
    const tokens = fixtureSection('tokens/txt').tokens
    if (!Array.isArray(tokens)) throw new Error('tokens/txt.tokens must be an array')
    // 生成 fixture 的 token 句（次は君の番です！）在素材 fixture 中同形。
    const sentence = fixtureTextSentences.find((item) => item.text === '次は君の番です！')
    if (!sentence) throw new Error('素材 fixture 缺少 token 句')
    for (const token of tokens) {
      const item = record(token, 'token')
      expect(sliceByCodePoint(sentence.text, item.char_start as number, item.char_end as number))
        .toBe(item.surface as string)
    }
  })

  it('tokenizer 的 token 区间单调推进且首尾覆盖句文（无重叠、无回退）', () => {
    let previousEnd = 0
    for (const token of fixtureSentenceTokens.tokens) {
      expect(token.char_start).toBeGreaterThanOrEqual(previousEnd)
      previousEnd = token.char_end
    }
    expect(previousEnd).toBeGreaterThan(0)
  })
})

describe('查词/裁定的请求面（BYOK-free + 显式写入）', () => {
  it('全部请求无 headers/credentials 且 URL 仅落允许端点', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      urls.push(url)
      expect(init?.credentials ?? undefined).toBeUndefined()
      if (init?.method === undefined) expect(init?.headers ?? undefined).toBeUndefined()
      if (url.includes('/tokens')) return Promise.resolve(jsonResponse(fixtureSection('tokens/txt')))
      if (url.includes('/lookup')) return Promise.resolve(jsonResponse(fixtureSection('dictionary/lookup')))
      if (url.includes('/evidence-summary')) return Promise.resolve(jsonResponse(fixtureSection('evidence/summary')))
      throw new Error(`unexpected: ${url}`)
    }))
    await fetchSentenceTokens('fixture-id-003')
    await lookupDictionary('君')
    await fetchEvidenceSummary(fixtureEvidenceSummary.lexeme_id)
    for (const url of urls) {
      expect(url).toMatch(/^\/(sentences|dictionaries|lexemes|materials)\//)
    }
  })

  it('裁定 POST 永远携带 expected_decision_seq（客户端在缺令牌时拒绝发送）', async () => {
    const bodies: JsonRecord[] = []
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string) as JsonRecord)
      return Promise.resolve(jsonResponse(fixtureSection('evidence/decision'), 201))
    }))
    await postLexemeDecision({
      lexemeId: 'lx_probe',
      decision: 'unknown',
      inputSurface: '君',
      expectedDecisionSeq: 3,
      operationKey: 'lexeme-decision:unknown:probe:3',
    })
    expect(bodies).toHaveLength(1)
    expect(bodies.at(0)?.expected_decision_seq).toBe(3)
  })
})
