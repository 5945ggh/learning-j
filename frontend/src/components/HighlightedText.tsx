import type { ReactNode } from 'react'
import { sliceByCodePoint } from '@/lib/text'
import { cn } from '@/lib/utils'
import type { TextSpan } from './models'

export type HighlightPart = { text: string; marked: boolean }

function spanRange(span: TextSpan): { start: number; end: number } | null {
  const start = 'char_start' in span ? span.char_start : span.start
  const end = 'char_end' in span ? span.char_end : span.end
  return Number.isInteger(start) && Number.isInteger(end) ? { start, end } : null
}

/**
 * Split sentence text by Unicode code-point Spans.
 *
 * Persisted offsets are `[char_start, char_end)` code-point offsets. Invalid
 * or empty ranges are ignored so a malformed fixture cannot manufacture text;
 * the original text is otherwise preserved exactly.
 */
export function splitBySpans(text: string, spans: readonly TextSpan[]): HighlightPart[] {
  const length = Array.from(text).length
  if (length === 0) return [{ text: '', marked: false }]

  const marks = new Array<boolean>(length).fill(false)
  for (const span of spans) {
    const range = spanRange(span)
    if (!range) continue
    const start = Math.max(0, Math.min(length, range.start))
    const end = Math.max(0, Math.min(length, range.end))
    if (start >= end) continue
    for (let index = start; index < end; index += 1) marks[index] = true
  }

  const parts: HighlightPart[] = []
  let start = 0
  let marked = marks[0] ?? false
  for (let index = 1; index <= length; index += 1) {
    const nextMarked = marks[index] ?? false
    if (index === length || nextMarked !== marked) {
      parts.push({ text: sliceByCodePoint(text, start, index), marked })
      start = index
      marked = nextMarked
    }
  }
  return parts
}

export type HighlightedTextProps = {
  text: string
  spans: readonly TextSpan[]
  className?: string
  markClassName?: string
  renderMark?: (text: string, index: number) => ReactNode
}

export function HighlightedText({ text, spans, className, markClassName, renderMark }: HighlightedTextProps) {
  const parts = splitBySpans(text, spans)
  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.marked ? (
          <mark key={`${index}-${part.text}`} className={cn('rounded-sm bg-lexical/15 px-0.5 text-foreground underline decoration-lexical/60 decoration-2 underline-offset-2', markClassName)}>
            {renderMark ? renderMark(part.text, index) : part.text}
          </mark>
        ) : (
          <span key={`${index}-${part.text}`}>{part.text}</span>
        ),
      )}
    </span>
  )
}
