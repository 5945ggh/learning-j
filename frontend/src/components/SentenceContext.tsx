import { parseEpubSpineIndex, type Sentence } from '@/lib/materials'

type SentenceContextProps = {
  sentence: Sentence
}

/**
 * Displays the selected source sentence without implying AI or learning
 * activity. Later reader/study shells can compose this component with their
 * own domain surfaces through props.
 */
export function SentenceContext({ sentence }: SentenceContextProps) {
  const spineIndex = parseEpubSpineIndex(sentence.anchor_type, sentence.anchor_payload)
  const location = sentence.anchor_type === 'epub'
    ? spineIndex === null ? '定位不可用' : `spine ${spineIndex}`
    : sentence.time_start !== null && sentence.time_end !== null
      ? '音视频时间轴'
      : '文本定位'

  return (
    <article className="rounded-md border border-border bg-card p-5 shadow-sm" aria-labelledby="selected-sentence-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-lexical">当前句子</p>
          <h2 id="selected-sentence-heading" className="mt-2 font-serif-jp text-xl leading-8">{sentence.text}</h2>
        </div>
        <span className="rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground">第 {sentence.index + 1} 句</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-4 text-sm text-muted-foreground">
        <span>来源定位：{location}</span>
        {sentence.translation ? <span>译文：{sentence.translation}</span> : null}
      </div>
    </article>
  )
}
