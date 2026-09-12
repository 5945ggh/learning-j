import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLexemeCounts, fetchMaterials, fetchSentences, fetchSidecar, parseEpubSpineIndex } from './materials'

afterEach(() => vi.unstubAllGlobals())

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('material API contract', () => {
  it.each([
    ['missing', {}, null],
    ['negative', { spine_index: -1 }, null],
    ['fractional', { spine_index: 1.5 }, null],
    ['string', { spine_index: '0' }, null],
    ['valid zero', { spine_index: 0 }, 0],
  ])('accepts only valid EPUB spine indexes: %s', (_label, payload, expected) => {
    expect(parseEpubSpineIndex('epub', payload)).toBe(expected)
  })

  it('does not interpret non-EPUB anchor payload as an EPUB location', () => {
    expect(parseEpubSpineIndex('plain_text', { spine_index: 0 })).toBeNull()
  })

  it('reads fixture-shaped materials and preserves the material-only endpoint', async () => {
    const request = vi.fn().mockResolvedValue(response([{
      id: 'fixture-id-001',
      title: 'fixture-sample',
      content_hash: 'hash',
      locator: 'fixture-sample.txt',
      kind: 'text',
      copy_stored: false,
      storage_mode: 'external_reference',
      source_sha256: 'raw-file-hash',
      current_sidecar_id: 'fixture-id-003',
      sentence_count: 3,
    }]))
    vi.stubGlobal('fetch', request)

    await expect(fetchMaterials()).resolves.toMatchObject([{ id: 'fixture-id-001', kind: 'text' }])
    expect(request).toHaveBeenCalledWith('/materials', { signal: undefined })
  })

  it('accepts code-point sentence anchors and non-numeric anchor payload values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([{
      id: 'fixture-id-002',
      material_id: 'fixture-id-001',
      index: 0,
      text: '𠮟られた。',
      time_start: null,
      time_end: null,
      translation: null,
      anchor_type: 'plain_text',
      anchor_payload: { char_start: 0, char_end: 5, label: 'source' },
    }])))

    await expect(fetchSentences('fixture-id-001')).resolves.toEqual([expect.objectContaining({
      text: '𠮟られた。',
      anchor_payload: { char_start: 0, char_end: 5, label: 'source' },
    })])
  })

  it('reads sidecar provenance without creating a second domain contract', async () => {
    const request = vi.fn().mockResolvedValue(response({
      material_id: 'fixture-id-001',
      sidecar_generation_id: 'fixture-id-003',
      content_hash: 'hash',
      segmenter_version: 'learningj-segmenter-v1',
      tokenizer_version: '0.6.11',
      analyzer_dict_version: '20260723',
      payload: { sentences: [] },
    }))
    vi.stubGlobal('fetch', request)

    await expect(fetchSidecar('fixture/id')).resolves.toMatchObject({
      analyzer_dict_version: '20260723',
      sidecar_generation_id: 'fixture-id-003',
    })
    expect(request).toHaveBeenCalledWith('/materials/fixture%2Fid/sidecar', { signal: undefined })
  })

  it('rejects malformed material responses instead of inventing UI state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([{
      id: 'missing-title',
      content_hash: 'hash',
      locator: 'fixture-sample.txt',
      kind: 'text',
      copy_stored: false,
      sentence_count: 0,
    }])))

    await expect(fetchMaterials()).rejects.toThrow('素材响应缺少有效的 title')
  })

  it('reports material endpoint failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ detail: 'down' }, 503)))

    await expect(fetchMaterials()).rejects.toThrow('素材加载失败（503）')
  })
})

describe('lexeme-counts API contract', () => {
  it('reads the single-generation sparse counts shape (MaterialLexemeCountsOut)', async () => {
    const request = vi.fn().mockResolvedValue(response({
      material_id: 'fixture-id-001',
      sidecar_generation_id: 'fixture-id-002',
      counts: [
        { lexeme_id: 'lx_9ca0779be06cdd19bcb8577014b30bdcf35ed0aae61773d3f3e62641deaf0bac', token_count: 2 },
        { lexeme_id: 'lx_621560ee20f258b69e3d35cda37560af3002dded248372c5ec3ec2c9cdaa6624', token_count: 1 },
      ],
    }))
    vi.stubGlobal('fetch', request)

    await expect(fetchLexemeCounts('fixture-id-001')).resolves.toEqual({
      material_id: 'fixture-id-001',
      sidecar_generation_id: 'fixture-id-002',
      counts: [
        { lexeme_id: 'lx_9ca0779be06cdd19bcb8577014b30bdcf35ed0aae61773d3f3e62641deaf0bac', token_count: 2 },
        { lexeme_id: 'lx_621560ee20f258b69e3d35cda37560af3002dded248372c5ec3ec2c9cdaa6624', token_count: 1 },
      ],
    })
    expect(request).toHaveBeenCalledWith('/materials/fixture-id-001/lexeme-counts', { signal: undefined })
  })

  it('URL-encodes material ids on the lexeme-counts path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      material_id: 'fixture/id',
      sidecar_generation_id: 'fixture-id-002',
      counts: [],
    })))

    await expect(fetchLexemeCounts('fixture/id')).resolves.toMatchObject({ material_id: 'fixture/id' })
    expect(fetch).toHaveBeenCalledWith('/materials/fixture%2Fid/lexeme-counts', { signal: undefined })
  })

  it('rejects malformed lexeme-counts responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      material_id: 'fixture-id-001',
      sidecar_generation_id: 'fixture-id-002',
      counts: [{ lexeme_id: 'lx_missing_count' }],
    })))

    await expect(fetchLexemeCounts('fixture-id-001')).rejects.toThrow('词频响应缺少有效的 token_count')
  })

  it('rejects non-array counts instead of rendering them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      material_id: 'fixture-id-001',
      sidecar_generation_id: 'fixture-id-002',
      counts: {},
    })))

    await expect(fetchLexemeCounts('fixture-id-001')).rejects.toThrow('词频响应缺少有效的 counts')
  })

  it('reports lexeme-counts endpoint failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ detail: 'missing' }, 404)))

    await expect(fetchLexemeCounts('fixture-id-404')).rejects.toThrow('词频加载失败（404）')
  })
})
