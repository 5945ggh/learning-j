import { parseEpubSpineIndex, type Sentence } from '@/lib/materials'
import { formatTimeRange } from '@/lib/time'

/**
 * 句子定位锚点解析（data-model §8.2「锚点取值（MVP 三种）」）。
 *
 * anchor_payload 是开放 JSON（OpenAPI `SentenceOut.anchor_payload`
 * additionalProperties: true），前端只按 anchor_type 读取三种已知形状并
 * 显式校验；任何缺失或非法取值都呈现为「定位不可用」，绝不虚构位置
 * （例如把缺失的 spine_index 当成 0）。解析只依赖句子自身的
 * anchor_type / anchor_payload / 时间戳字段，不接收 Material——这是
 * §8.2「素材 = 有序 Sentence 序列 + 可选时间戳 + 可选 locator」在前端的
 * 可验证形式。
 */

export type SentenceLocation =
  | { kind: 'subtitle'; cueIndex: number }
  | { kind: 'plain_text'; charStart: number; charEnd: number }
  | { kind: 'epub'; spineIndex: number; charStart: number | null; charEnd: number | null }
  | { kind: 'unavailable' }

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/** 校验一对 code point 半开偏移；start > end 视为非法而不是空区间。 */
function charOffsetPair(
  payload: Record<string, unknown>,
): { charStart: number; charEnd: number } | null {
  const { char_start: charStart, char_end: charEnd } = payload
  if (!isNonNegativeInteger(charStart) || !isNonNegativeInteger(charEnd)) return null
  if (charStart > charEnd) return null
  return { charStart, charEnd }
}

export function parseSentenceAnchor(sentence: Sentence): SentenceLocation {
  const payload = sentence.anchor_payload
  switch (sentence.anchor_type) {
    case 'subtitle': {
      const { cue_index: cueIndex } = payload
      return isNonNegativeInteger(cueIndex)
        ? { kind: 'subtitle', cueIndex }
        : { kind: 'unavailable' }
    }
    case 'plain_text': {
      const offsets = charOffsetPair(payload)
      return offsets ? { kind: 'plain_text', ...offsets } : { kind: 'unavailable' }
    }
    case 'epub': {
      const spineIndex = parseEpubSpineIndex(sentence.anchor_type, payload)
      if (spineIndex === null) return { kind: 'unavailable' }
      // spine 合法而偏移缺失/非法时只展示 spine，不补造偏移。
      const offsets = charOffsetPair(payload)
      return {
        kind: 'epub',
        spineIndex,
        charStart: offsets?.charStart ?? null,
        charEnd: offsets?.charEnd ?? null,
      }
    }
    default:
      return { kind: 'unavailable' }
  }
}

/** 人类可读的定位描述；时间戳来自句子列（与锚点载荷相互独立）。 */
export function formatSentenceLocation(sentence: Sentence): string {
  const location = parseSentenceAnchor(sentence)
  switch (location.kind) {
    case 'subtitle': {
      const range = formatTimeRange(sentence.time_start, sentence.time_end)
      return range ? `cue ${location.cueIndex} · ${range}` : `cue ${location.cueIndex}`
    }
    case 'plain_text':
      return `偏移 ${location.charStart}–${location.charEnd}`
    case 'epub': {
      if (location.charStart === null || location.charEnd === null) {
        return `spine ${location.spineIndex}`
      }
      return `spine ${location.spineIndex} · 偏移 ${location.charStart}–${location.charEnd}`
    }
    default:
      return '定位不可用'
  }
}
