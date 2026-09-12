import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DictionaryRequestError,
  fetchDictionaries,
  lookupDictionary,
  searchDictionary,
} from './dictionary'
import { fixtureDictionaries, fixtureLookupResult, fixtureSearchResult } from './reader-fixtures'

afterEach(() => vi.unstubAllGlobals())

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('dictionary 客户端（lookup / search / 列表）', () => {
  it('lookup 带 expression 查询参数，解析生成 fixture 形状的词条', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(fixtureLookupResult)))
    vi.stubGlobal('fetch', fetchMock)
    const result = await lookupDictionary('君')
    expect(fetchMock).toHaveBeenCalledWith('/dictionaries/lookup?expression=%E5%90%9B', { signal: undefined })
    expect(result.expression).toBe('君')
    expect(result.entries[0]!).toMatchObject({
      source_id: 'fixture-id-001',
      display_name: 'fixture-辞書',
      source_version: '2026-09-12',
      expression: '君',
      reading: 'きみ',
      score: 8,
    })
    expect(result.entries[0]!.definitions[1]).toEqual({
      ordinal: 1,
      plain_text: '第二人称代词',
      structured_content: { text: '第二人称代词', type: 'text' },
    })
  })

  it('lookup 的可选 reading 进入查询串', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ...fixtureLookupResult, reading: 'きみ' })))
    vi.stubGlobal('fetch', fetchMock)
    await lookupDictionary('君', { reading: 'きみ' })
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/dictionaries/lookup?expression=%E5%90%9B&reading=%E3%81%8D%E3%81%BF')
  })

  it('search 带 query 查询参数并解析前缀搜索结果', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(fixtureSearchResult))))
    const result = await searchDictionary('頑')
    expect(result.query).toBe('頑')
    expect(result.entries[0]!.expression).toBe('頑張る')
    expect(result.entries[0]!.tags).toEqual(['動詞', 'v5'])
  })

  it('已导入词典列表被解析为来源数组（区分「无词典」与「无结果」）', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(fixtureDictionaries)))
    vi.stubGlobal('fetch', fetchMock)
    const sources = await fetchDictionaries()
    expect(fetchMock).toHaveBeenCalledWith('/dictionaries', { signal: undefined })
    expect(sources[0]!).toMatchObject({ id: 'fixture-id-001', display_name: 'fixture-辞書', schema_version: 'term_bank_v1' })
  })

  it('search 的 503 映射为 fts_unavailable（FTS 派生索引缺失/损坏不静默为空结果）', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ detail: '搜索索引缺失' }, 503))))
    const error = await searchDictionary('頑').catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(DictionaryRequestError)
    expect((error as DictionaryRequestError).kind).toBe('fts_unavailable')
    expect((error as DictionaryRequestError).status).toBe(503)
  })

  it('lookup 的 503 同样映射为 fts_unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ detail: 'x' }, 503))))
    const error = await lookupDictionary('君').catch((cause: unknown) => cause)
    expect((error as DictionaryRequestError).kind).toBe('fts_unavailable')
  })

  it('普通错误（500）保持 http 类别', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ detail: 'down' }, 500))))
    const error = await lookupDictionary('君').catch((cause: unknown) => cause)
    expect((error as DictionaryRequestError).kind).toBe('http')
    expect((error as Error).message).toContain('500')
  })

  it('请求面无凭证/BYOK 材料，URL 只落在 dictionaries 端点', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(fixtureLookupResult)))
    vi.stubGlobal('fetch', fetchMock)
    await lookupDictionary('君')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toBeUndefined()
    expect(init.credentials).toBeUndefined()
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url.startsWith('/dictionaries/')).toBe(true)
  })
})
