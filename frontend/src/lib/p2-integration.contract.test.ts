/** P2-integration -> P3 reader contract.
 *
 * The generated reader fixture is the only cross-boundary artifact.  This
 * test keeps the props handed to P3 aligned with the real backend fixture and
 * makes the BYOK-free/read-only boundary explicit.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDictionaries } from './dictionary'
import { fetchSentenceTokens } from './tokens'
import { fixtureDictionaries, fixtureSentenceTokens } from './reader-fixtures'

type RecordValue = Record<string, unknown>

const fixturePath = fileURLToPath(new URL('../../../backend/fixtures/reader-fixture.json', import.meta.url))
const readerFixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as RecordValue

function object(value: unknown, label: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as RecordValue
}

afterEach(() => vi.unstubAllGlobals())

describe('P2 integration publishes the P3 reader contract', () => {
  it('contains the complete token/dictionary/annotation/evidence fixture surfaces', () => {
    const tokens = object(readerFixture['tokens/txt'], 'tokens/txt')
    const source = object(readerFixture['dictionary/source'], 'dictionary/source')
    const lookup = object(readerFixture['dictionary/lookup'], 'dictionary/lookup')
    const search = object(readerFixture['dictionary/search'], 'dictionary/search')
    const annotation = object(readerFixture['annotations/txt'], 'annotations/txt')
    const decision = object(readerFixture['evidence/decision'], 'evidence/decision')
    const summary = object(readerFixture['evidence/summary'], 'evidence/summary')
    const knownViews = object(readerFixture['evidence/known-views'], 'evidence/known-views')

    expect(tokens).toHaveProperty('tokens')
    expect(tokens).toHaveProperty('sidecar_generation_id')
    expect(tokens).toHaveProperty('analyzer_dict_version')
    expect(source).toHaveProperty('source')
    expect(lookup).toHaveProperty('entries')
    expect(search).toHaveProperty('entries')
    expect(annotation).toHaveProperty('spans')
    expect(decision).toHaveProperty('decision_seq')
    expect(summary).toHaveProperty('projection_revision')
    expect(knownViews).toHaveProperty('items')
    // P3 receives persisted facts only; no provider key/token is part of the artifact.
    expect(JSON.stringify(readerFixture)).not.toMatch(/api[_-]?key|authorization|byok|provider[_-]?secret/i)
  })

  it('keeps exported P3 props byte-for-byte equivalent to generated responses', async () => {
    const tokenPayload = readerFixture['tokens/txt']
    const sourcePayload = object(readerFixture['dictionary/source'], 'dictionary/source').source
    const calls: Array<[string, RequestInit | undefined]> = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push([url, init])
      if (url.includes('/tokens')) return Promise.resolve(new Response(JSON.stringify(tokenPayload), { status: 200 }))
      if (url === '/dictionaries') return Promise.resolve(new Response(JSON.stringify([sourcePayload]), { status: 200 }))
      throw new Error(`unexpected reader request: ${url}`)
    }))

    expect(await fetchSentenceTokens('fixture-id-003')).toEqual(fixtureSentenceTokens)
    expect(await fetchDictionaries()).toEqual(fixtureDictionaries)
    expect(calls.map(([url]) => url)).toEqual(['/sentences/fixture-id-003/tokens', '/dictionaries'])
    for (const [, init] of calls) {
      expect(init?.headers).toBeUndefined()
      expect(init?.credentials).toBeUndefined()
    }
  })
})
