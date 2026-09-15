import type { AlgorithmToken } from '@/lib/tokens'
import type { Sentence } from '@/lib/materials'

type TokenizedSentenceProps = {
  sentence: Sentence
  tokens: AlgorithmToken[]
  /** 是否正在加载 token 表。 */
  loading: boolean
  /** token 表加载失败信息。 */
  error: string | null
  /** 当前选中 token 的 lexeme_id + char_start 组合键。 */
  selectedKey: string | null
  onTokenSelect: (token: AlgorithmToken, trigger: HTMLElement) => void
  onRetry: () => void
}

/** token 键：同一 lexeme 的不同出现位置是独立的点击目标。 */
export function tokenKey(token: AlgorithmToken): string {
  return `${token.lexeme_id}:${token.char_start}`
}

/**
 * 算法解析视图：把选中句子的 token 渲染为可点击按钮（DESIGN.md 查词流程
 * 第 1 条）。单次点击或聚焦时 Enter/Space 选中一个 token 并打开查词；
 * 渲染是纯展示，选中 token 不创建任何收藏、KnowledgePoint 或 KE。
 */
export function TokenizedSentence({ sentence, tokens, loading, error, selectedKey, onTokenSelect, onRetry }: TokenizedSentenceProps) {
  return (
    <section className="rounded-[var(--radius-grouped)] border border-divider bg-opaque-surface p-5" aria-labelledby="algorithm-tokens-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="algorithm-tokens-heading" className="text-sm font-semibold uppercase tracking-wider text-secondary-text">
          算法解析
        </h2>
        <p className="text-xs text-muted-foreground">点击或按 Enter 选中词元，打开词典面板；这只是确定性分析，不是学习记录。</p>
      </div>
      {loading ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">正在加载 token 表…</p>
      ) : error ? (
        <div role="alert" className="mt-4 text-sm">
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            重试
          </button>
        </div>
      ) : tokens.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">这个句子还没有可交互的 token。</p>
      ) : (
        <p className="mt-4 font-serif-jp text-lg leading-9">
          {tokens.map((token) => {
            const key = tokenKey(token)
            const selected = selectedKey === key
            // token 表层来自后端 code point 切片（含 BMP 外字符），原样渲染。
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                aria-label={`${token.surface}，读音 ${token.reading_form || '无'}，词性 ${token.pos}。选中打开词典面板`}
                onClick={(event) => onTokenSelect(token, event.currentTarget)}
                className={`mx-0.5 rounded-sm px-1 py-0.5 align-baseline text-inherit transition-colors hover:bg-lexical/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'bg-lexical/20 underline decoration-lexical decoration-2 underline-offset-4' : ''}`}
              >
                {token.surface}
              </button>
            )
          })}
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">句子：{sentence.text}</p>
    </section>
  )
}
