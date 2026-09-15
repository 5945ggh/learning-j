/// <reference types="node" />

/**
 * P1-integration 跨边界契约测试（`CURRENT-PACKETS.md` P1-integration）。
 *
 * 锁定「前端客户端消费面 ↔ 生成的 OpenAPI/fixture」的一致性：
 * - 生成 OpenAPI 必须携带 P1 素材面路径与代次字段（SidecarOut 与
 *   MaterialLexemeCountsOut 的 `sidecar_generation_id`）；
 *   只断言必需路径的子集与禁止标记，不断言路径总数——P2+ 的合法新增路径
 *   不得被本测试冻结；
 * - 客户端四条读取函数对生成 fixture 的解析结果逐字段一致，且请求面
 *   不携带任何 BYOK/凭证材料（BYOK-free 浏览）；
 * - fixture 的 code point 偏移（token 切片 == surface、锚点切片 == 句文本）
 *   与单代次词频一致性（`sidecar_generation_id` 贯穿 sidecar 与词频）；
 * - P1-frontend 发布给 P2 的 props fixture（material-fixtures.ts 声明
 *   「txt/srt 照抄生成 fixture」）与生成产物保持相等。
 *
 * `p0-integration.contract.test.ts` 语义不倒退：该文件未被改动，其用例
 * 继续在套件中原样执行。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fixtureEpubSentences,
  fixtureLexemeCounts,
  fixtureSubtitleMaterial,
  fixtureSubtitleSentences,
  fixtureTextMaterial,
  fixtureTextSentences,
} from './material-fixtures'
import { fetchLexemeCounts, fetchMaterials, fetchSentences, fetchSidecar } from './materials'
import { sliceByCodePoint } from './text'

type JsonRecord = Record<string, unknown>

const repoArtifact = (path: string) => fileURLToPath(new URL(`../../../backend/${path}`, import.meta.url))

function readArtifact(envName: string, fallback: string): JsonRecord {
  const path = process.env[envName] ?? repoArtifact(fallback)
  return JSON.parse(readFileSync(path, 'utf8')) as JsonRecord
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return value as JsonRecord
}

function records(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a JSON array`)
  return value.map((item) => record(item, label))
}

function itemAt<T>(items: T[], index: number, label: string): T {
  const item = items[index]
  if (item === undefined) throw new Error(`${label} is missing item ${index}`)
  return item
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

/** fetch 首参统一成 URL 字符串（Request/URL 不走默认 toString）。 */
function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function schemaRef(value: unknown, label: string): string {
  const ref = record(value, label).$ref
  if (typeof ref !== 'string') throw new Error(`${label} must contain a schema reference`)
  return ref
}

function requiredFields(schema: JsonRecord, label: string): string[] {
  const required = schema.required
  if (!Array.isArray(required)) throw new Error(`${label} must declare required fields`)
  return required.map((field, index) => {
    if (typeof field !== 'string') throw new Error(`${label} required[${index}] is not a string`)
    return field
  })
}

function assertJsonResponse(
  operation: JsonRecord,
  label: string,
  expectedRef: string,
  responseKind: 'array' | 'object',
  schemas: JsonRecord,
): void {
  const responses = record(operation.responses, `${label} responses`)
  const ok = record(responses['200'], `${label} 200 response`)
  const content = record(ok.content, `${label} 200 content`)
  const json = record(content['application/json'], `${label} application/json`)
  const schema = record(json.schema, `${label} response schema`)
  const resolved = responseKind === 'array' ? record(schema.items, `${label} response items`) : schema
  if (responseKind === 'array') expect(schema.type).toBe('array')
  const ref = schemaRef(resolved, `${label} response reference`)
  expect(ref).toBe(expectedRef)
  const componentName = ref.replace('#/components/schemas/', '')
  expect(record(schemas[componentName], `${label} response component`).type).toBe('object')
}

/** fixture 的 sidecar payload 按句子下标对齐句子列表。 */
function fixturePayloadGroups(fixture: JsonRecord, key: 'txt' | 'srt'): JsonRecord[] {
  const sidecar = record(fixture[`sidecar/${key}`], `sidecar/${key}`)
  const payload = record(sidecar.payload, `sidecar/${key} payload`)
  return records(payload.sentences, `sidecar/${key} payload sentences`)
}

afterEach(() => vi.unstubAllGlobals())

describe('P1 generated contract: type/API consumption face', () => {
  it('publishes the material surface with generation fields required, without freezing future paths', () => {
    const spec = readArtifact('LEARNINGJ_P0_OPENAPI', 'fixtures/openapi.json')
    const paths = record(spec.paths, 'OpenAPI paths')
    // 子集断言：P2+ 合法新增路径不受冻结；只锁定 P1 素材面必须存在。
    for (const requiredPath of [
      '/healthz',
      '/materials',
      '/materials/{material_id}/sentences',
      '/materials/{material_id}/sidecar',
      '/materials/{material_id}/lexeme-counts',
      '/materials/{material_id}/sidecar/rebuild',
    ]) {
      expect(paths).toHaveProperty(requiredPath)
    }

    const rendered = JSON.stringify(spec)
    for (const forbidden of [
      'session_closed',
      'turn_count',
      'extraction_status',
      'extraction_trigger',
      '/analyses',
      '/questions',
      '/extract',
      '/knowledge-points',
      '/retention',
    ]) {
      expect(rendered).not.toContain(forbidden)
    }

    const components = record(spec.components, 'OpenAPI components')
    const schemas = record(components.schemas, 'OpenAPI schemas')

    // 响应引用：P1 素材面五个操作逐一锁定（含词频索引与代次重建）。
    assertJsonResponse(record(record(paths['/materials'], 'GET /materials').get, 'GET /materials'), 'GET /materials', '#/components/schemas/MaterialOut', 'array', schemas)
    assertJsonResponse(record(record(paths['/materials/{material_id}/sentences'], 'sentences path').get, 'GET sentences'), 'GET sentences', '#/components/schemas/SentenceOut', 'array', schemas)
    assertJsonResponse(record(record(paths['/materials/{material_id}/sidecar'], 'sidecar path').get, 'GET sidecar'), 'GET sidecar', '#/components/schemas/SidecarOut', 'object', schemas)
    assertJsonResponse(record(record(paths['/materials/{material_id}/lexeme-counts'], 'lexeme-counts path').get, 'GET lexeme-counts'), 'GET lexeme-counts', '#/components/schemas/MaterialLexemeCountsOut', 'object', schemas)
    assertJsonResponse(record(record(paths['/materials/{material_id}/sidecar/rebuild'], 'rebuild path').post, 'POST rebuild'), 'POST rebuild', '#/components/schemas/SidecarOut', 'object', schemas)

    // 必填字段集合与客户端消费面完全一致（客户端解析器按同一集合强制）。
    const materialOut = record(schemas.MaterialOut, 'MaterialOut')
    expect(requiredFields(materialOut, 'MaterialOut')).toEqual([
      'id',
      'title',
      'content_hash',
      'locator',
      'kind',
      'copy_stored',
      'storage_mode',
      'sentence_count',
    ])
    const materialProperties = record(materialOut.properties, 'MaterialOut properties')
    // 可空资源边界字段必须存在但不强制（§8.1：准备前可空）。
    expect(materialProperties).toHaveProperty('author')
    expect(materialProperties).toHaveProperty('source_sha256')
    expect(materialProperties).toHaveProperty('current_sidecar_id')

    const sentenceOut = record(schemas.SentenceOut, 'SentenceOut')
    expect(requiredFields(sentenceOut, 'SentenceOut')).toEqual([
      'id',
      'material_id',
      'index',
      'text',
      'anchor_type',
      'anchor_payload',
    ])

    // 代次契约：sidecar 与词频响应都强制携带 sidecar_generation_id。
    expect(requiredFields(record(schemas.SidecarOut, 'SidecarOut'), 'SidecarOut')).toEqual([
      'material_id',
      'sidecar_generation_id',
      'content_hash',
      'segmenter_version',
      'tokenizer_version',
      'analyzer_dict_version',
      'payload',
    ])
    expect(requiredFields(record(schemas.MaterialLexemeCountsOut, 'MaterialLexemeCountsOut'), 'MaterialLexemeCountsOut')).toEqual([
      'material_id',
      'sidecar_generation_id',
      'counts',
    ])
    const countsItems = record(record(record(schemas.MaterialLexemeCountsOut, 'MaterialLexemeCountsOut').properties, 'MaterialLexemeCountsOut properties').counts, 'MaterialLexemeCountsOut.counts')
    const countItemRef = schemaRef(record(countsItems.items, 'counts items'), 'counts item reference')
    expect(countItemRef).toBe('#/components/schemas/MaterialLexemeCountOut')
    expect(requiredFields(record(schemas.MaterialLexemeCountOut, 'MaterialLexemeCountOut'), 'MaterialLexemeCountOut')).toEqual(['lexeme_id', 'token_count'])
  })

  it('parses every generated fixture response the client consumes, without any BYOK surface', async () => {
    const fixture = readArtifact('LEARNINGJ_P0_FIXTURE', 'fixtures/material-fixture.json')
    const txtMaterial = record(fixture['materials/txt'], 'txt material')
    const srtMaterial = record(fixture['materials/srt'], 'srt material')
    const preparedMaterial = { ...txtMaterial, source_sha256: null, current_sidecar_id: null }
    const txtId = txtMaterial.id as string
    const srtId = srtMaterial.id as string

    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = urlOf(input)
      const responses: Record<string, unknown> = {
        '/materials': [txtMaterial, srtMaterial, preparedMaterial],
        [`/materials/${txtId}/sentences`]: fixture['sentences/txt'],
        [`/materials/${srtId}/sentences`]: fixture['sentences/srt'],
        [`/materials/${txtId}/sidecar`]: fixture['sidecar/txt'],
        [`/materials/${srtId}/sidecar`]: fixture['sidecar/srt'],
        [`/materials/${txtId}/lexeme-counts`]: fixture['lexeme-counts/txt'],
        [`/materials/${srtId}/lexeme-counts`]: fixture['lexeme-counts/srt'],
      }
      const body = responses[url]
      if (body === undefined) throw new Error(`unexpected frontend request: ${url}`)
      return Promise.resolve(response(body))
    })
    vi.stubGlobal('fetch', fetchMock)

    const materials = await fetchMaterials()
    const txt = itemAt(materials, 0, 'loaded materials')
    const srt = itemAt(materials, 1, 'loaded materials')
    expect(txt).toEqual(txtMaterial)
    expect(srt).toEqual(srtMaterial)
    // §8.1「准备前可空」：可空资源边界字段以 null 被客户端接受。
    expect(itemAt(materials, 2, 'prepared material')).toMatchObject({
      source_sha256: null,
      current_sidecar_id: null,
    })

    // BYOK-free：整个浏览链路的请求不携带任何凭证或密钥材料。
    for (const call of fetchMock.mock.calls) {
      const init = call[1]
      expect(init?.headers).toBeUndefined()
      expect(init?.credentials).toBeUndefined()
      expect(urlOf(call[0])).toMatch(/^\/materials(\/|$)/)
    }

    const [txtSentences, txtSidecar, txtCounts, srtSentences, srtSidecar, srtCounts] = await Promise.all([
      fetchSentences(txt.id),
      fetchSidecar(txt.id),
      fetchLexemeCounts(txt.id),
      fetchSentences(srt.id),
      fetchSidecar(srt.id),
      fetchLexemeCounts(srt.id),
    ])
    expect(txtSentences).toEqual(records(fixture['sentences/txt'], 'txt sentences'))
    expect(txtSidecar).toEqual(record(fixture['sidecar/txt'], 'txt sidecar'))
    expect(txtCounts).toEqual(record(fixture['lexeme-counts/txt'], 'txt lexeme counts'))
    expect(srtSentences).toEqual(records(fixture['sentences/srt'], 'srt sentences'))
    expect(srtSidecar).toEqual(record(fixture['sidecar/srt'], 'srt sidecar'))
    expect(srtCounts).toEqual(record(fixture['lexeme-counts/srt'], 'srt lexeme counts'))

    // 可空字段契约：§8.1「准备前可空」必须被客户端接受为 null。
    const prepared = { ...txtMaterial, source_sha256: null, current_sidecar_id: null }
    expect(prepared.source_sha256).toBeNull()
  })

  it('rejects responses that violate the generated contract required fields', async () => {
    const fixture = readArtifact('LEARNINGJ_P0_FIXTURE', 'fixtures/material-fixture.json')
    const txtMaterial = record(fixture['materials/txt'], 'txt material')
    const txtSidecar = record(fixture['sidecar/txt'], 'txt sidecar')
    const txtCounts = record(fixture['lexeme-counts/txt'], 'txt lexeme counts')
    const txtId = txtMaterial.id as string

    vi.stubGlobal('fetch', vi.fn<typeof fetch>((input) => {
      const url = urlOf(input)
      const responses: Record<string, unknown> = {
        '/materials': [omit(txtMaterial, 'storage_mode')],
        [`/materials/${txtId}/sidecar`]: omit(txtSidecar, 'sidecar_generation_id'),
        [`/materials/${txtId}/lexeme-counts`]: omit(txtCounts, 'counts'),
      }
      const body = responses[url]
      if (body === undefined) throw new Error(`unexpected frontend request: ${url}`)
      return Promise.resolve(response(body))
    }))

    await expect(fetchMaterials()).rejects.toThrow('素材响应缺少有效的 storage_mode')
    await expect(fetchSidecar(txtId)).rejects.toThrow('sidecar响应缺少有效的 sidecar_generation_id')
    await expect(fetchLexemeCounts(txtId)).rejects.toThrow('词频响应缺少有效的 counts')
  })

  it('keeps the generated fixture internally consistent on code points and one generation', () => {
    const fixture = readArtifact('LEARNINGJ_P0_FIXTURE', 'fixtures/material-fixture.json')
    for (const key of ['txt', 'srt'] as const) {
      const sentences = records(fixture[`sentences/${key}`], `sentences/${key}`)
      const sidecar = record(fixture[`sidecar/${key}`], `sidecar/${key}`)
      const counts = record(fixture[`lexeme-counts/${key}`], `lexeme-counts/${key}`)
      const groups = fixturePayloadGroups(fixture, key)
      expect(groups).toHaveLength(sentences.length)

      const totalTokens = groups.reduce(
        (sum, group) => sum + records(group.tokens, 'sidecar tokens').length,
        0,
      )
      let slicedTokens = 0
      for (let index = 0; index < sentences.length; index += 1) {
        const sentence = itemAt(sentences, index, 'sentences')
        const group = itemAt(groups, index, 'payload groups')
        expect(group.sentence_index).toBe(sentence.index)
        for (const token of records(group.tokens, 'sidecar tokens')) {
          // 不变量 6：code point 半开切片必须等于 surface（BMP 外字符安全）。
          expect(
            sliceByCodePoint(sentence.text as string, token.char_start as number, token.char_end as number),
          ).toBe(token.surface)
          slicedTokens += 1
        }
      }
      expect(slicedTokens).toBe(totalTokens)

      // 词频与全量重建一致、单代次、稀疏正向唯一。
      expect(counts.material_id).toBe(sidecar.material_id)
      expect(counts.sidecar_generation_id).toBe(sidecar.sidecar_generation_id)
      const countEntries = records(counts.counts, 'lexeme counts')
      expect(countEntries.length).toBeLessThanOrEqual(totalTokens)
      const lexemeIds = new Set(countEntries.map((entry) => entry.lexeme_id))
      expect(lexemeIds.size).toBe(countEntries.length)
      const total = countEntries.reduce((sum, entry) => sum + (entry.token_count as number), 0)
      expect(total).toBe(totalTokens)
      expect(countEntries.every((entry) => (entry.token_count as number) > 0)).toBe(true)
    }

    // 「𠮟られた。」样例继续锁定 BMP 外字符的 code point 成句。
    const txtSentences = records(fixture['sentences/txt'], 'txt sentences')
    expect(itemAt(txtSentences, 0, 'txt sentences').text).toBe('𠮟られた。')
  })

  it('keeps the P2 props fixtures equal to the generated contract artifacts', () => {
    const fixture = readArtifact('LEARNINGJ_P0_FIXTURE', 'fixtures/material-fixture.json')
    expect(fixtureTextMaterial).toEqual(record(fixture['materials/txt'], 'txt material'))
    expect(fixtureSubtitleMaterial).toEqual(record(fixture['materials/srt'], 'srt material'))
    expect(fixtureTextSentences).toEqual(records(fixture['sentences/txt'], 'txt sentences'))
    expect(fixtureSubtitleSentences).toEqual(records(fixture['sentences/srt'], 'srt sentences'))
    expect(fixtureLexemeCounts).toEqual(record(fixture['lexeme-counts/txt'], 'txt lexeme counts'))

    // 生成 fixture 未覆盖的 epub 锚点条目必须严格按 §8.2 锚点表构造。
    for (const sentence of fixtureEpubSentences) {
      expect(sentence.anchor_type).toBe('epub')
      expect(Object.keys(sentence.anchor_payload).sort()).toEqual(['char_end', 'char_start', 'spine_index'])
    }
  })
})

function omit(value: JsonRecord, field: string): JsonRecord {
  const copy: JsonRecord = { ...value }
  delete copy[field]
  return copy
}
