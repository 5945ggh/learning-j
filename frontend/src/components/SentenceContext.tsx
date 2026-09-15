import { formatSentenceLocation } from '@/lib/anchors'
import { formatTimeRange } from '@/lib/time'
import type { Sentence } from '@/lib/materials'

type SentenceContextProps = {
  sentence: Sentence
}

/**
 * 选中句子的来源语境展示：定位描述按 anchor_type 适配
 * （data-model §8.2）。仅呈现浏览定位，不包含 AI、查词或阅读活动语义；
 * 后续阅读/学习 shell 通过 props 组合自己的领域界面（ADR-023）。
 */
export function SentenceContext({ sentence }: SentenceContextProps) {
  const location = formatSentenceLocation(sentence)
  const timeRange = sentence.anchor_type === 'subtitle'
    ? null
    : formatTimeRange(sentence.time_start, sentence.time_end)

  return (
    <article className="rounded-[var(--radius-grouped)] border border-divider bg-opaque-surface p-5" aria-labelledby="selected-sentence-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-divider pb-4">
        <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-algorithm">当前句子</p>
          <h2 id="selected-sentence-heading" className="mt-2 font-serif-jp text-xl leading-8">{sentence.text}</h2>
        </div>
        <span className="rounded-[var(--radius-control)] bg-grouped-surface px-2 py-1 text-xs text-secondary-text">第 {sentence.index + 1} 句</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-4 text-sm text-secondary-text">
        <span>来源定位：{location}</span>
        {timeRange ? <span>时间戳：{timeRange}</span> : null}
        {sentence.translation ? <span>译文：{sentence.translation}</span> : null}
      </div>
    </article>
  )
}
