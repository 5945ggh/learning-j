/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMaterials, fetchSentences, fetchSidecar } from './materials'
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

function schemaRef(value: unknown, label: string): string {
  const ref = record(value, label).$ref
  if (typeof ref !== 'string') throw new Error(`${label} must contain a schema reference`)
  return ref
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

afterEach(() => vi.unstubAllGlobals())

describe('P0 generated backend contract', () => {
  it('exposes only the material routes and schema fields consumed by the client', () => {
    const spec = readArtifact('LEARNINGJ_P0_OPENAPI', 'fixtures/openapi.json')
    const paths = record(spec.paths, 'OpenAPI paths')
    for (const requiredPath of [
      '/healthz',
      '/materials',
      '/materials/{material_id}/sentences',
      '/materials/{material_id}/sidecar',
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
    for (const [schemaName, fields] of Object.entries({
      MaterialOut: ['id', 'title', 'content_hash', 'locator', 'kind', 'copy_stored', 'sentence_count'],
      SentenceOut: ['id', 'material_id', 'index', 'text', 'time_start', 'time_end', 'translation', 'anchor_type', 'anchor_payload'],
      SidecarOut: ['material_id', 'content_hash', 'segmenter_version', 'tokenizer_version', 'analyzer_dict_version', 'payload'],
    })) {
      const schema = record(schemas[schemaName], schemaName)
      const properties = record(schema.properties, `${schemaName} properties`)
      for (const field of fields) expect(properties).toHaveProperty(field)
      const required = Array.isArray(schema.required) ? schema.required : []
      for (const field of fields) {
        if (schemaName === 'SentenceOut' && field === 'anchor_payload') {
          expect(required).toContain(field)
        }
      }
    }

    const materialPath = record(paths['/materials'], '/materials path')
    const sentencePath = record(paths['/materials/{material_id}/sentences'], 'sentences path')
    const sidecarPath = record(paths['/materials/{material_id}/sidecar'], 'sidecar path')
    assertJsonResponse(record(materialPath.get, 'GET /materials'), 'GET /materials', '#/components/schemas/MaterialOut', 'array', schemas)
    assertJsonResponse(record(sentencePath.get, 'GET sentences'), 'GET sentences', '#/components/schemas/SentenceOut', 'array', schemas)
    assertJsonResponse(record(sidecarPath.get, 'GET sidecar'), 'GET sidecar', '#/components/schemas/SidecarOut', 'object', schemas)
  })

  it('lets the frontend consume generated fixture responses and preserve their links', async () => {
    const fixture = readArtifact('LEARNINGJ_P0_FIXTURE', 'fixtures/material-fixture.json')
    const txtMaterial = record(fixture['materials/txt'], 'txt material')
    const srtMaterial = record(fixture['materials/srt'], 'srt material')
    const txtSentences = records(fixture['sentences/txt'], 'txt sentences')
    const srtSentences = records(fixture['sentences/srt'], 'srt sentences')
    const txtSidecar = record(fixture['sidecar/txt'], 'txt sidecar')
    const srtSidecar = record(fixture['sidecar/srt'], 'srt sidecar')

    vi.stubGlobal('fetch', vi.fn((input: string) => {
      const responses: Record<string, unknown> = {
        '/materials': [txtMaterial, srtMaterial],
        [`/materials/${txtMaterial.id as string}/sentences`]: txtSentences,
        [`/materials/${srtMaterial.id as string}/sentences`]: srtSentences,
        [`/materials/${txtMaterial.id as string}/sidecar`]: txtSidecar,
        [`/materials/${srtMaterial.id as string}/sidecar`]: srtSidecar,
      }
      const body = responses[input]
      if (body === undefined) throw new Error(`unexpected frontend request: ${input}`)
      return Promise.resolve(response(body))
    }))

    const materials = await fetchMaterials()
    const txt = itemAt(materials, 0, 'loaded materials')
    const srt = itemAt(materials, 1, 'loaded materials')
    expect(txt).toMatchObject(txtMaterial)
    expect(srt).toMatchObject(srtMaterial)

    const [loadedTxtSentences, loadedSrtSentences, loadedTxtSidecar, loadedSrtSidecar] = await Promise.all([
      fetchSentences(txt.id),
      fetchSentences(srt.id),
      fetchSidecar(txt.id),
      fetchSidecar(srt.id),
    ])
    expect(loadedTxtSentences).toEqual(txtSentences)
    expect(loadedSrtSentences).toEqual(srtSentences)
    expect(loadedTxtSidecar).toEqual(txtSidecar)
    expect(loadedSrtSidecar).toEqual(srtSidecar)
    expect(loadedTxtSentences.every((sentence) => sentence.material_id === txt.id)).toBe(true)
    expect(loadedSrtSentences.every((sentence) => sentence.material_id === srt.id)).toBe(true)
    expect(loadedTxtSidecar.material_id).toBe(txt.id)
    expect(loadedTxtSidecar.content_hash).toBe(txt.content_hash)
    expect(loadedSrtSidecar.material_id).toBe(srt.id)
    expect(loadedSrtSidecar.content_hash).toBe(srt.content_hash)
  })

  it('shares the backend fixture token surfaces through code-point half-open slices', () => {
    const fixture = readArtifact('LEARNINGJ_P0_FIXTURE', 'fixtures/material-fixture.json')
    const sentence = itemAt(records(fixture['sentences/txt'], 'txt sentences'), 0, 'txt sentences')
    const sidecar = record(fixture['sidecar/txt'], 'txt sidecar')
    const payload = record(sidecar.payload, 'sidecar payload')
    const sidecarSentence = itemAt(records(payload.sentences, 'sidecar sentences'), 0, 'sidecar sentences')
    const tokens = records(sidecarSentence.tokens, 'sidecar tokens')
    const text = sentence.text as string

    expect(text).toBe('𠮟られた。')
    for (const token of tokens) {
      expect(sliceByCodePoint(text, token.char_start as number, token.char_end as number)).toBe(token.surface)
    }
  })
})
