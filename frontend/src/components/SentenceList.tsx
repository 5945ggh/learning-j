import { formatSentenceLocation } from '@/lib/anchors'
import { formatTimeRange } from '@/lib/time'
import type { Material, Sentence } from '@/lib/materials'

type SentenceListProps = {
  material: Material | null
  sentences: Sentence[]
  selectedId?: string | null
  onSelect?: (sentence: Sentence) => void
}

/**
 * 句子列表：定位展示按句子自身的 anchor_type 适配（data-model §8.2），
 * 选择句子只是浏览定位，不是学习或阅读活动记录。
 */
export function SentenceList({ material, sentences, selectedId, onSelect }: SentenceListProps) {
  if (!material) {
    return (
      <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
        选择一个素材开始浏览。
      </div>
    )
  }
  if (sentences.length === 0) {
    return (
      <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
        这个素材还没有可显示的句子。
      </div>
    )
  }
  return (
    <ol className="space-y-3" aria-label={`${material.title} 的句子`}>
      {sentences.map((sentence) => {
        const location = formatSentenceLocation(sentence)
        // 字幕句的时间戳已并入定位描述；其余锚点的可选时间戳单独展示。
        const timeRange = sentence.anchor_type === 'subtitle'
          ? null
          : formatTimeRange(sentence.time_start, sentence.time_end)
        return (
          <li key={sentence.id} className={`rounded-[var(--radius-action)] border bg-opaque-surface p-4 transition-colors ${selectedId === sentence.id ? 'border-study ring-1 ring-study/20' : 'border-divider'}`}>
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary-text">
              <span>#{sentence.index + 1}</span>
              <span>{location}</span>
              {timeRange ? <span>{timeRange}</span> : null}
            </div>
            <p className="font-serif-jp text-lg leading-8">{sentence.text}</p>
              {sentence.translation ? <p className="mt-2 border-l-2 border-algorithm pl-3 text-sm text-secondary-text">{sentence.translation}</p> : null}
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(sentence)}
                aria-pressed={selectedId === sentence.id}
                className="mt-3 text-sm font-medium text-study underline-offset-4 hover:underline"
              >
                选择句子
              </button>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
