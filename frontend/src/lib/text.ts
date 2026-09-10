/**
 * 句子文本与 code point 偏移工具。
 *
 * 项目硬约束：字符偏移一律使用 Unicode code point（不是 UTF-16 code unit）。
 * `String.prototype.slice/substring/substr` 都按 UTF-16 unit 切分，会把 BMP 外
 * 字符（如「𠮟」「𩸽」）切成孤立代理对。句子文本的切片必须走
 * `sliceByCodePoint()`；ESLint 规则 `learningj/no-bare-string-slice` 会对字符串
 * 上的裸 slice 族方法报错（数组切片不受影响）。
 *
 * 与后端的契约：Sentence 偏移（sidecar、Span 等）同为 code point 下标，
 * 前后端可直接换算，无需 UTF-16 修正。
 */

declare const sentenceTextBrand: unique symbol

/** 句子文本的标记类型：只表达「该字符串遵守 code point 偏移契约」，不改变运行时行为。 */
export type SentenceText = string & { readonly [sentenceTextBrand]: 'SentenceText' }

/** 将字符串标记为句子文本。句子文本必须来自后端或 sidecar，不得在前端拼接改写偏移语义。 */
export function asSentenceText(value: string): SentenceText {
  return value as SentenceText
}

/** 文本的 code point 数量（BMP 外字符计 1）。 */
export function codePointLength(text: string): number {
  return Array.from(text).length
}

/** 把下标按 String.prototype.slice 的语义（负值从末尾倒数、越界收敛）折算到 [0, length]。 */
function resolveIndex(index: number, length: number): number {
  const normalized = Math.trunc(index)
  if (normalized < 0) return Math.max(length + normalized, 0)
  return Math.min(normalized, length)
}

/**
 * 按 code point 切片，参数语义与 `String.prototype.slice` 对齐：
 * `start` / `end` 为 code point 下标，负值从末尾倒数，越界收敛，
 * `start >= end` 时返回空串，省略 `end` 则切到末尾。
 */
export function sliceByCodePoint(text: string, start: number, end?: number): string {
  const codePoints = Array.from(text)
  const begin = resolveIndex(start, codePoints.length)
  const stop = end === undefined ? codePoints.length : resolveIndex(end, codePoints.length)
  if (begin >= stop) return ''
  return codePoints.slice(begin, stop).join('')
}
