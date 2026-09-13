import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixtureSubtitleMaterial, fixtureTextMaterial, fixtureTextSentences } from '@/lib/material-fixtures'
import { fixtureDecision, fixtureEvidenceSummary, fixtureSentenceTokens, fixtureSubtitleSentenceTokens } from '@/lib/reader-fixtures'
import { MaterialApiAdapter, MaterialFixtureAdapter } from '@/lib/material-repository'
import { ReaderApiAdapter, ReaderFixtureAdapter } from '@/lib/reader-repository'
import { KnowledgeApiAdapter, KnowledgeFixtureAdapter } from '@/lib/knowledge-repository'
import { ReviewApiAdapter, ReviewFixtureAdapter } from '@/lib/review-repository'
import { StudyApiAdapter, StudyFixtureAdapter } from '@/lib/study-repository'
import {
  createFixtureComposition,
  fixtureCompositionIds,
  FixtureResolvingMaterialRepository,
  FixtureResolvingReaderRepository,
} from '@/lib/fixture-composition'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

afterEach(() => vi.unstubAllGlobals())

describe('MaterialRepository adapters', () => {
  it('API adapter delegates to the existing P1 clients and does not create a second request contract', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url === '/materials') return Promise.resolve(jsonResponse([fixtureTextMaterial]))
      if (url === '/materials/fixture-id-001/sentences') return Promise.resolve(jsonResponse(fixtureTextSentences))
      throw new Error(`unexpected URL ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const repository = new MaterialApiAdapter()
    await expect(repository.getMaterial('fixture-id-001')).resolves.toMatchObject({ id: 'fixture-id-001' })
    await expect(repository.listSentences('fixture-id-001')).resolves.toHaveLength(3)

    expect(fetchMock.mock.calls.map(([input]) => requestUrl(input))).toEqual([
      '/materials',
      '/materials/fixture-id-001/sentences',
    ])
    expect(repository.source).toBe('api')
    expect(repository.unstable).toBe(false)
  })

  it('fixture adapter clones formal P1 fixture values and keeps each read isolated', async () => {
    const repository = new MaterialFixtureAdapter()
    const first = await repository.listMaterials()
    first[0]!.title = 'mutated in component'
    const second = await repository.listMaterials()

    expect(second[0]!.title).toBe('fixture-sample')
    await expect(repository.listSentences('fixture-id-001')).resolves.toEqual(fixtureTextSentences)
    expect(repository.source).toBe('fixture')
    expect(repository.unstable).toBe(false)
  })
})

describe('ReaderRepository adapters', () => {
  it('API adapter uses the shipped tokens/dictionary/lexeme clients', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      if (url === '/sentences/fixture-id-003/tokens') return Promise.resolve(jsonResponse(fixtureSentenceTokens))
      if (url === '/dictionaries') return Promise.resolve(jsonResponse([]))
      if (url === '/lexemes/lx_da/evidence-summary') return Promise.resolve(jsonResponse(fixtureEvidenceSummary))
      if (url === '/lexemes/lx_da/decisions' && init?.method === 'POST') return Promise.resolve(jsonResponse(fixtureDecision, 201))
      throw new Error(`unexpected URL ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const repository = new ReaderApiAdapter()

    await expect(repository.getSentenceTokens('fixture-id-003')).resolves.toEqual(fixtureSentenceTokens)
    await expect(repository.listDictionaries()).resolves.toEqual([])
    await expect(repository.getEvidenceSummary('lx_da')).resolves.toEqual(fixtureEvidenceSummary)
    await expect(repository.recordLexemeDecision({
      lexemeId: 'lx_da',
      decision: 'known',
      inputSurface: '君',
      expectedDecisionSeq: 0,
      operationKey: 'adapter-test',
    })).resolves.toEqual(fixtureDecision)

    expect(fetchMock.mock.calls.map(([input]) => requestUrl(input))).toEqual([
      '/sentences/fixture-id-003/tokens',
      '/dictionaries',
      '/lexemes/lx_da/evidence-summary',
      '/lexemes/lx_da/decisions',
    ])
    expect(repository.source).toBe('api')
  })

  it('fixture adapter exposes undecided/no-result states without any network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const repository = new ReaderFixtureAdapter()

    await expect(repository.lookupDictionary('not-in-fixture')).resolves.toEqual({
      expression: 'not-in-fixture',
      reading: null,
      entries: [],
    })
    await expect(repository.lookupDictionary('君', { reading: 'きみ' })).resolves.toMatchObject({
      expression: '君',
      entries: [expect.objectContaining({ expression: '君', reading: 'きみ' })],
    })
    await expect(repository.searchDictionary('not-in-fixture')).resolves.toEqual({
      query: 'not-in-fixture',
      entries: [],
    })
    await expect(repository.getEvidenceSummary('new-lexeme')).resolves.toEqual({
      lexeme_id: 'new-lexeme',
      projection_revision: 0,
      scopes: [],
    })
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(repository.listAnnotations('fixture-id-004')).resolves.toHaveLength(1)
  })

  it('fixture decisions retain expected sequence and make explicit replay visible', async () => {
    const repository = new ReaderFixtureAdapter()
    const request = {
      lexemeId: 'lx_f7b9336979d127199e41f12a8b8d1470a9b412c158b5c8813589cb20033ac080',
      decision: 'known' as const,
      inputSurface: '次',
      expectedDecisionSeq: 0,
      operationKey: 'fixture-repository-test',
    }
    await expect(repository.recordLexemeDecision(request)).resolves.toMatchObject({
      decision: 'known',
      decision_seq: 1,
      created: true,
    })
    await expect(repository.recordLexemeDecision(request)).resolves.toMatchObject({
      decision: 'known',
      decision_seq: 1,
      created: false,
    })
    await expect(repository.getEvidenceSummary(request.lexemeId)).resolves.toMatchObject({
      projection_revision: 1,
      scopes: [expect.objectContaining({ current_decision: 'known', current_decision_seq: 1 })],
    })
  })
})

describe('P3+ fixture-only repository boundaries', () => {
  it('Study covers preparation/discussion and separates active from parked/history', async () => {
    const repository = new StudyFixtureAdapter()
    const active = await repository.listActiveSessions()
    const history = await repository.listHistory()
    const preparation = active.find((item) => item.phase === 'preparation')
    const discussion = active.find((item) => item.phase === 'discussion')
    const parked = history.find((item) => item.status === 'parked')

    expect(preparation?.current_run?.status).toBe('queued')
    expect(discussion?.current_run?.status).toBe('succeeded')
    expect(parked?.current_run?.status).toBe('paused')
    expect(repository.source).toBe('fixture')
    expect(repository.unstable).toBe(true)
  })

  it('Knowledge preserves code-point spans, source revisions, and material filters', async () => {
    const repository = new KnowledgeFixtureAdapter()
    const occurrence = (await repository.listOccurrences({ material_id: 'fixture-id-001' }))[0]
    const aggregate = await repository.getAggregate('fixture-kp-kimi')

    expect(occurrence).toMatchObject({
      sentence_id: 'fixture-id-004',
      content_source: 'analysis_section',
      section_revision: 1,
    })
    expect(occurrence?.spans).toEqual([{ char_start: 2, char_end: 3 }])
    expect(aggregate?.knowledge_point.anchor_shape).toBe('lexical')
    expect(repository.unstable).toBe(true)
  })

  it('Review keeps queued, active, paused, and retired distinct without inventing ReviewState', async () => {
    const repository = new ReviewFixtureAdapter()
    const items = await repository.listReviewItems()
    const statuses = new Set(items.map((item) => item.status))

    expect(statuses).toEqual(new Set(['queued', 'active', 'paused', 'retired']))
    expect((await repository.listQueued()).every((item) => item.admitted_at === null)).toBe(true)
    expect((await repository.listAdmitted()).every((item) => item.status !== 'retired')).toBe(true)
    expect(repository.unstable).toBe(true)
  })

  it('P3+ API adapters fail explicitly without phantom network calls', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(new StudyApiAdapter().listSessions()).rejects.toThrow('StudySession API 当前仅有 fixture')
    await expect(new KnowledgeApiAdapter().listAggregates()).rejects.toThrow('KnowledgePoint API 当前仅有 fixture')
    await expect(new ReviewApiAdapter().listReviewItems()).rejects.toThrow('ReviewItem API 当前仅有 fixture')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('fixture composition provenance', () => {
  it('maps separately generated P1/P2 artifacts into one explicit UI identity space', async () => {
    const fixture = createFixtureComposition()
    const materials = new MaterialFixtureAdapter(fixture.materials)
    const reader = new ReaderFixtureAdapter(fixture.reader)
    const study = new StudyFixtureAdapter(fixture.study)
    const knowledge = new KnowledgeFixtureAdapter(fixture.knowledge)

    for (const session of await study.listSessions()) {
      const source = session.source_sentence_ids[0]
      expect(await materials.getMaterial(session.material_id)).not.toBeNull()
      expect((await materials.listSentences(session.material_id)).some((sentence) => sentence.id === source)).toBe(true)
    }
    for (const occurrence of await knowledge.listOccurrences()) {
      expect((await materials.listSentences(occurrence.material_id)).some((sentence) => sentence.id === occurrence.sentence_id)).toBe(true)
    }

    const txt = await reader.getSentenceTokens('fixture-ui-text-sentence')
    expect(txt.material_id).toBe('fixture-ui-text-material')
    expect((await materials.listSentences(txt.material_id)).find((sentence) => sentence.id === txt.sentence_id)?.text).toBe('次は君の番です！')
    const annotations = await reader.listAnnotations(txt.material_id)
    expect(annotations[0]?.spans[0]).toMatchObject({ sentence_id: 'fixture-ui-text-annotation-sentence', alignment_sidecar_id: 'fixture-ui-text-sidecar' })
    expect((await materials.getSidecar('fixture-ui-subtitle-material')).content_hash).toBe(fixtureSubtitleMaterial.content_hash)
  })

  it('uses fixture fallback only for the composition namespace, preserving real material listing', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (requestUrl(input) === '/materials') return Promise.resolve(jsonResponse([]))
      throw new Error(`unexpected URL ${requestUrl(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const repository = new FixtureResolvingMaterialRepository()

    await expect(repository.listMaterials()).resolves.toEqual([])
    await expect(repository.listSentences('fixture-ui-text-material')).resolves.toContainEqual(expect.objectContaining({ id: 'fixture-ui-text-sentence' }))
    expect(fetchMock.mock.calls.map(([input]) => requestUrl(input))).toEqual(['/materials'])
  })

  it('keeps the default reader API-backed while translating composed IDs at the endpoint boundary', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      if (url === '/sentences/fixture-id-004/tokens') {
        return Promise.resolve(jsonResponse({
          ...fixtureSentenceTokens,
          sentence_id: 'fixture-id-004',
          material_id: 'fixture-id-001',
          sidecar_generation_id: 'fixture-id-002',
        }))
      }
      if (url === '/sentences/fixture-id-008/tokens') {
        return Promise.resolve(jsonResponse({
          ...fixtureSubtitleSentenceTokens,
          sentence_id: 'fixture-id-008',
          material_id: 'fixture-id-006',
          sidecar_generation_id: 'fixture-id-007',
        }))
      }
      if (url === '/materials/fixture-id-001/annotations') return Promise.resolve(jsonResponse([{
        id: 'fixture-id-009', material_id: 'fixture-id-001', created_at: 'fixture-timestamp', note: 'fixture-annotation', color: 'yellow',
        spans: [{ span_id: 'fixture-id-010', sentence_id: 'fixture-id-003', surface: '𠮟られた', char_start: 0, char_end: 4, alignment_sidecar_id: 'fixture-id-002', token_start: 0, token_end: 3, alignment_status: 'aligned' }],
      }]))
      if (url.endsWith('/decisions') && init?.method === 'POST') return Promise.resolve(jsonResponse(fixtureDecision, 201))
      throw new Error(`unexpected URL ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const repository = new FixtureResolvingReaderRepository()

    const tokens = await repository.getSentenceTokens(fixtureCompositionIds.textSentence)
    expect(tokens).toMatchObject({ sentence_id: fixtureCompositionIds.textSentence, material_id: fixtureCompositionIds.textMaterial, sidecar_generation_id: 'fixture-ui-text-sidecar' })
    const subtitleTokens = await repository.getSentenceTokens(fixtureCompositionIds.subtitleSentence)
    expect(subtitleTokens).toMatchObject({ sentence_id: fixtureCompositionIds.subtitleSentence, material_id: fixtureCompositionIds.subtitleMaterial, sidecar_generation_id: 'fixture-ui-subtitle-sidecar' })
    const annotations = await repository.listAnnotations(fixtureCompositionIds.textMaterial)
    expect(annotations[0]).toMatchObject({ material_id: fixtureCompositionIds.textMaterial, spans: [{ sentence_id: fixtureCompositionIds.annotationSentence, alignment_sidecar_id: 'fixture-ui-text-sidecar' }] })
    await repository.recordLexemeDecision({ lexemeId: 'lx_probe', decision: 'known', inputSurface: '君', expectedDecisionSeq: 0, operationKey: 'resolver-test', materialId: fixtureCompositionIds.textMaterial })
    const body = JSON.parse((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string) as Record<string, unknown>
    expect(body.material_id).toBe('fixture-id-001')
    expect(fetchMock.mock.calls.map(([input]) => requestUrl(input))).toEqual([
      '/sentences/fixture-id-004/tokens',
      '/sentences/fixture-id-008/tokens',
      '/materials/fixture-id-001/annotations',
      '/lexemes/lx_probe/decisions',
    ])
  })
})
