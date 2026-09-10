import type { Material, Sentence } from '@/lib/materials'

type SentenceListProps = {
  material: Material | null
  sentences: Sentence[]
  selectedId?: string | null
  onSelect?: (sentence: Sentence) => void
}

function formatTime(milliseconds: number | null): string | null {
  if (milliseconds === null) return null
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const millis = milliseconds % 1000
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

export function SentenceList({ material, sentences, selectedId, onSelect }: SentenceListProps) {
  if (!material) return <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">选择一个素材开始浏览。</div>
  if (sentences.length === 0) return <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">这个素材还没有可显示的句子。</div>
  return (
    <ol className="space-y-3" aria-label={`${material.title} 的句子`}>
      {sentences.map((sentence) => {
        const start = formatTime(sentence.time_start)
        const end = formatTime(sentence.time_end)
        return (
          <li key={sentence.id} className={`rounded-md border bg-card p-4 transition-colors ${selectedId === sentence.id ? 'border-study ring-1 ring-study/20' : 'border-border'}`}>
            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>#{sentence.index + 1}</span>
              {start && end ? <span>{start}–{end}</span> : <span>{sentence.anchor_type === 'epub' ? `spine ${sentence.anchor_payload.spine_index ?? 0}` : '文本定位'}</span>}
            </div>
            <p className="font-serif-jp text-lg leading-8">{sentence.text}</p>
            {sentence.translation ? <p className="mt-2 border-l-2 border-lexical pl-3 text-sm text-muted-foreground">{sentence.translation}</p> : null}
            {onSelect ? <button type="button" onClick={() => onSelect(sentence)} aria-pressed={selectedId === sentence.id} className="mt-3 text-sm font-medium text-study underline-offset-4 hover:underline">选择句子</button> : null}
          </li>
        )
      })}
    </ol>
  )
}
