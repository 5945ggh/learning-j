import { describe, expect, it, vi } from 'vitest'
import { fetchSentenceTokens } from './tokens'
import { fixtureSentenceTokens } from './reader-fixtures'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('tokens 客户端（GET /sentences/{id}/tokens）', () => {
  it('解析生成 fixture 形状的 token 表：版本戳、provenance 与 code point 偏移', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(fixtureSentenceTokens)))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const tokens = await fetchSentenceTokens('fixture-id-003')
      expect(tokens.sentence_id).toBe('fixture-id-003')
      expect(tokens.sidecar_generation_id).toBe('fixture-id-005')
      expect(tokens.segmenter_version).toBe('learningj-segmenter-v1')
      expect(tokens.tokenizer_version).toBe('0.6.11')
      expect(tokens.analyzer_dict_version).toBe('20260723')
      expect(tokens.dictionary_sources).toEqual([
        { source_id: 'fixture-id-001', display_name: 'fixture-辞書', source_version: '2026-09-12' },
      ])
      expect(tokens.tokens[2]).toEqual({
        surface: '君',
        normalized_form: '君',
        pos: '代名詞,*,*,*,*,*',
        reading_form: 'キミ',
        reading_source: 'sudachi',
        lexeme_id: 'lx_da636c71bab3557686de138257d58e6dec4abbbfc2eaabfac6c70ca7eb5d5150',
        char_start: 2,
        char_end: 3,
        dictionary_source_ids: ['fixture-id-001'],
      })
      expect(fetchMock).toHaveBeenCalledWith('/sentences/fixture-id-003/tokens', { signal: undefined })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('请求面只访问 sentences 端点，不携带任何凭证或 BYOK 材料', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(fixtureSentenceTokens)))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await fetchSentenceTokens('s1')
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('/sentences/s1/tokens')
      expect(init.headers).toBeUndefined()
      expect(init.credentials).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('缺少 lexeme_id 的响应被拒绝（读取层防御，不静默渲染）', async () => {
    const broken = { ...fixtureSentenceTokens, tokens: fixtureSentenceTokens.tokens.map((token, index) => (
      index === 0 ? { ...token, lexeme_id: undefined } : token
    )) }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(broken))))
    try {
      await expect(fetchSentenceTokens('s1')).rejects.toThrow('lexeme_id')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('负偏移或非半开区间被拒绝（code point 偏移契约）', async () => {
    const broken = { ...fixtureSentenceTokens, tokens: [{ ...fixtureSentenceTokens.tokens[0], char_start: -1 }] }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(broken))))
    try {
      await expect(fetchSentenceTokens('s1')).rejects.toThrow('半开区间')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('404 时报告加载失败', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ detail: '句子不存在' }, 404))))
    try {
      await expect(fetchSentenceTokens('missing')).rejects.toThrow('token 表加载失败（404）')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
