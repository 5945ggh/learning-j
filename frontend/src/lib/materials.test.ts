import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MATERIAL_IMPORT_TYPE_DETAIL,
  createMaterial,
  fetchLexemeCounts,
  fetchMaterials,
  fetchSentences,
  fetchSidecar,
  isSupportedImportFilename,
  materialDefaultTitle,
  materialFilenameExtension,
  parseEpubSpineIndex,
} from './materials'

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

describe('material import filename helpers', () => {
  it.each([
    ['sample.txt', 'txt'],
    ['字幕.SRT', 'srt'],
    ['episode.ja.vtt', 'vtt'],
    ['no-extension', ''],
    ['plain', ''],
  ])('extracts the lowercased last extension: %s -> %s', (filename, expected) => {
    expect(materialFilenameExtension(filename)).toBe(expected)
  })

  it('accepts only the extensions the backend allows for POST /materials', () => {
    expect(isSupportedImportFilename('sample.txt')).toBe(true)
    expect(isSupportedImportFilename('sample.srt')).toBe(true)
    expect(isSupportedImportFilename('sample.vtt')).toBe(true)
    expect(isSupportedImportFilename('sample.epub')).toBe(true)
    expect(isSupportedImportFilename('sample.doc')).toBe(false)
    expect(isSupportedImportFilename('sample')).toBe(false)
  })

  it.each([
    ['我的材料.txt', '我的材料'],
    ['a.b.srt', 'a.b'],
    ['no-extension', 'no-extension'],
    ['.txt', '.txt'],
  ])('derives the default title from the filename: %s -> %s', (filename, expected) => {
    expect(materialDefaultTitle(filename)).toBe(expected)
  })
})

describe('createMaterial API contract', () => {
  const importedMaterial = {
    id: 'fixture-id-010',
    title: 'sample',
    content_hash: 'hash',
    locator: 'sample.txt',
    kind: 'text',
    copy_stored: false,
    storage_mode: 'external_reference',
    source_sha256: null,
    current_sidecar_id: null,
    sentence_count: 0,
  }

  function txtFile(name = 'sample.txt'): File {
    return new File(['ファイルの中身'], name, { type: 'text/plain' })
  }

  function postedForm(request: ReturnType<typeof vi.fn>): FormData {
    const init = request.mock.calls[0]?.[1] as RequestInit | undefined
    if (!(init?.body instanceof FormData)) throw new Error('createMaterial 必须发送 multipart FormData')
    return init.body
  }

  it('posts the multipart contract with file and title, leaving locator/storage_mode to the backend', async () => {
    const request = vi.fn().mockResolvedValue(response(importedMaterial, 201))
    vi.stubGlobal('fetch', request)

    await expect(createMaterial({ file: txtFile(), title: '  我的材料  ' })).resolves.toMatchObject({
      id: 'fixture-id-010',
      kind: 'text',
      storage_mode: 'external_reference',
    })
    expect(request).toHaveBeenCalledWith('/materials', expect.objectContaining({ method: 'POST' }))
    const form = postedForm(request)
    expect(form.get('file')).toBeInstanceOf(File)
    expect((form.get('file') as File).name).toBe('sample.txt')
    expect(form.get('title')).toBe('我的材料')
    expect(form.get('locator')).toBeNull()
    expect(form.get('storage_mode')).toBeNull()
  })

  it('omits the title field when it is blank instead of sending whitespace', async () => {
    const request = vi.fn().mockResolvedValue(response(importedMaterial, 201))
    vi.stubGlobal('fetch', request)

    await createMaterial({ file: txtFile(), title: '   ' })
    expect(postedForm(request).get('title')).toBeNull()
  })

  it('passes an abort signal through to the fetch call', async () => {
    const request = vi.fn().mockResolvedValue(response(importedMaterial, 201))
    vi.stubGlobal('fetch', request)
    const controller = new AbortController()

    await createMaterial({ file: txtFile() }, controller.signal)
    expect(request).toHaveBeenCalledWith('/materials', expect.objectContaining({ signal: controller.signal }))
  })

  it('surfaces the backend 415 detail text for unsupported extensions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ detail: MATERIAL_IMPORT_TYPE_DETAIL }, 415)))

    await expect(createMaterial({ file: txtFile('bad.doc') })).rejects.toThrow(MATERIAL_IMPORT_TYPE_DETAIL)
  })

  it('surfaces the backend 422 detail text from import failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ detail: '字幕解析失败：无法读取文件内容' }, 422)))

    await expect(createMaterial({ file: txtFile('broken.srt') })).rejects.toThrow('字幕解析失败：无法读取文件内容')
  })

  it('joins FastAPI validation messages when 422 detail is an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      detail: [{ loc: ['body', 'file'], msg: 'field required', type: 'missing' }],
    }, 422)))

    await expect(createMaterial({ file: txtFile() })).rejects.toThrow('field required')
  })

  it('falls back to a status-bearing message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gateway timeout', { status: 502 })))

    await expect(createMaterial({ file: txtFile() })).rejects.toThrow('素材导入失败（502）')
  })
})
