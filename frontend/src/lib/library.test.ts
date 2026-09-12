import { describe, expect, it } from 'vitest'
import { fixtureEpubMaterial, fixtureSubtitleMaterial, fixtureTextMaterial } from './material-fixtures'
import { libraryModeForKind, LIBRARY_MODE_LABELS, materialsForMode } from './library'

describe('libraryModeForKind', () => {
  it('文本与 EPUB 归入书目', () => {
    expect(libraryModeForKind('text')).toBe('books')
    expect(libraryModeForKind('epub')).toBe('books')
  })

  it('字幕素材归入视听', () => {
    expect(libraryModeForKind('subtitle_video')).toBe('audiovisual')
    expect(libraryModeForKind('subtitle_audio')).toBe('audiovisual')
  })
})

describe('materialsForMode', () => {
  const materials = [fixtureTextMaterial, fixtureSubtitleMaterial, fixtureEpubMaterial]

  it('书目只包含 text/epub，视听只包含字幕素材', () => {
    expect(materialsForMode(materials, 'books').map((material) => material.id)).toEqual([
      'fixture-id-001',
      'local-fixture-epub-001',
    ])
    expect(materialsForMode(materials, 'audiovisual').map((material) => material.id)).toEqual([
      'fixture-id-006',
    ])
  })

  it('模式标签覆盖全部两种模式', () => {
    expect(LIBRARY_MODE_LABELS.books).toBe('书目')
    expect(LIBRARY_MODE_LABELS.audiovisual).toBe('视听')
  })
})
