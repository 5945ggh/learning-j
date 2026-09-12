import { describe, expect, it } from 'vitest'
import { formatSentenceLocation, parseSentenceAnchor, type SentenceLocation } from './anchors'
import type { Sentence } from './materials'

function sentence(overrides: Partial<Sentence>): Sentence {
  return {
    id: 'sentence-1',
    material_id: 'material-1',
    index: 0,
    text: 'テスト。',
    time_start: null,
    time_end: null,
    translation: null,
    anchor_type: 'plain_text',
    anchor_payload: {},
    ...overrides,
  }
}

describe('parseSentenceAnchor: subtitle', () => {
  it('接受合法 cue_index', () => {
    const input = sentence({ anchor_type: 'subtitle', anchor_payload: { cue_index: 3 } })
    expect(parseSentenceAnchor(input)).toEqual({ kind: 'subtitle', cueIndex: 3 })
  })

  it.each([
    ['missing', {}],
    ['negative', { cue_index: -1 }],
    ['fractional', { cue_index: 1.5 }],
    ['string', { cue_index: '0' }],
  ])('cue_index %s 呈现为定位不可用而不是虚构位置', (_label, payload) => {
    const input = sentence({ anchor_type: 'subtitle', anchor_payload: payload })
    expect(parseSentenceAnchor(input)).toEqual({ kind: 'unavailable' })
  })
})

describe('parseSentenceAnchor: plain_text', () => {
  it('接受合法的 code point 半开偏移', () => {
    const input = sentence({ anchor_payload: { char_start: 0, char_end: 5 } })
    expect(parseSentenceAnchor(input)).toEqual({ kind: 'plain_text', charStart: 0, charEnd: 5 })
  })

  it.each([
    ['missing', {}],
    ['negative', { char_start: -2, char_end: 5 }],
    ['inverted', { char_start: 7, char_end: 5 }],
    ['fractional', { char_start: 0.5, char_end: 5 }],
    ['string', { char_start: '0', char_end: 5 }],
  ])('偏移 %s 呈现为定位不可用', (_label, payload) => {
    const input = sentence({ anchor_payload: payload })
    expect(parseSentenceAnchor(input)).toEqual({ kind: 'unavailable' })
  })
})

describe('parseSentenceAnchor: epub', () => {
  it('接受 spine_index 与偏移', () => {
    const input = sentence({ anchor_type: 'epub', anchor_payload: { spine_index: 2, char_start: 8, char_end: 16 } })
    expect(parseSentenceAnchor(input)).toEqual({
      kind: 'epub',
      spineIndex: 2,
      charStart: 8,
      charEnd: 16,
    })
  })

  it('spine_index 为合法的 0 时正常定位', () => {
    const input = sentence({ anchor_type: 'epub', anchor_payload: { spine_index: 0, char_start: 0, char_end: 3 } })
    expect(parseSentenceAnchor(input)).toEqual({
      kind: 'epub',
      spineIndex: 0,
      charStart: 0,
      charEnd: 3,
    })
  })

  it('spine_index 非法时呈现定位不可用，不虚构 spine 0', () => {
    for (const payload of [
      {},
      { spine_index: -1, char_start: 0, char_end: 3 },
      { spine_index: 1.5, char_start: 0, char_end: 3 },
      { spine_index: '2', char_start: 0, char_end: 3 },
    ]) {
      const input = sentence({ anchor_type: 'epub', anchor_payload: payload })
      expect(parseSentenceAnchor(input)).toEqual({ kind: 'unavailable' })
    }
  })

  it('spine 合法而偏移非法时只展示 spine，偏移为 null', () => {
    const input = sentence({ anchor_type: 'epub', anchor_payload: { spine_index: 4, char_start: 'x', char_end: 9 } })
    expect(parseSentenceAnchor(input)).toEqual({
      kind: 'epub',
      spineIndex: 4,
      charStart: null,
      charEnd: null,
    })
  })
})

describe('素材类型无关的统一定位抽象（data-model §8.2）', () => {
  it('定位只由句子的锚点字段决定，与素材类型无关', () => {
    // 同一 anchor_type / anchor_payload / 时间戳放在不同 kind 的素材下，
    // 解析与展示结果必须逐字一致。
    const shared = {
      anchor_type: 'subtitle' as const,
      anchor_payload: { cue_index: 1 },
      time_start: 4400,
      time_end: 8000,
    }
    const fromVideo = sentence({ ...shared, material_id: 'video-material' })
    const fromAudio = sentence({ ...shared, material_id: 'audio-material' })
    expect(formatSentenceLocation(fromVideo)).toBe(formatSentenceLocation(fromAudio))
    expect(formatSentenceLocation(fromVideo)).toBe('cue 1 · 00:04.400–00:08.000')
  })

  it('开放 payload 上的额外键不破坏定位解析', () => {
    const input = sentence({ anchor_payload: { char_start: 0, char_end: 5, label: 'source' } })
    expect(parseSentenceAnchor(input)).toEqual({ kind: 'plain_text', charStart: 0, charEnd: 5 })
  })
})

describe('formatSentenceLocation', () => {
  it('subtitle 句把时间戳并入定位描述', () => {
    const input = sentence({
      anchor_type: 'subtitle',
      anchor_payload: { cue_index: 0 },
      time_start: 1000,
      time_end: 4200,
    })
    expect(formatSentenceLocation(input)).toBe('cue 0 · 00:01.000–00:04.200')
  })

  it('subtitle 句缺时间戳时只展示 cue', () => {
    const input = sentence({ anchor_type: 'subtitle', anchor_payload: { cue_index: 2 } })
    expect(formatSentenceLocation(input)).toBe('cue 2')
  })

  it('plain_text 句展示 code point 偏移', () => {
    const input = sentence({ anchor_payload: { char_start: 5, char_end: 13 } })
    expect(formatSentenceLocation(input)).toBe('偏移 5–13')
  })

  it('epub 句展示 spine 与偏移；偏移缺失时只展示 spine', () => {
    const withOffsets = sentence({ anchor_type: 'epub', anchor_payload: { spine_index: 2, char_start: 0, char_end: 13 } })
    const spineOnly = sentence({ anchor_type: 'epub', anchor_payload: { spine_index: 3 } })
    expect(formatSentenceLocation(withOffsets)).toBe('spine 2 · 偏移 0–13')
    expect(formatSentenceLocation(spineOnly)).toBe('spine 3')
  })

  it('定位不可用时有显式文案', () => {
    const input = sentence({ anchor_type: 'plain_text', anchor_payload: { char_start: 9, char_end: 1 } })
    const location: SentenceLocation = parseSentenceAnchor(input)
    expect(location).toEqual({ kind: 'unavailable' })
    expect(formatSentenceLocation(input)).toBe('定位不可用')
  })
})
