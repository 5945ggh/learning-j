import { useState } from 'react'
import type { AlgorithmToken } from '@/lib/tokens'
import type { DictionaryEntry } from '@/lib/dictionary'
import type { EvidenceSummaryScope, LexemeDecisionValue } from '@/lib/lexemes'
import { DecisionControls } from './DecisionControls'

export type LookupPanelStatus = 'loading' | 'no_dictionary' | 'no_result' | 'ready' | 'error'

export type LookupVersionStamps = {
  sidecar_generation_id: string
  segmenter_version: string
  tokenizer_version: string
  analyzer_dict_version: string
}

type LookupPanelProps = {
  status: LookupPanelStatus
  /** 错误详情（status === 'error' 时展示）。 */
  error: string | null
  /** true 表示 FTS 派生索引不可用（后端 503），使用专用文案。 */
  ftsUnavailable: boolean
  token: AlgorithmToken | null
  versionStamps: LookupVersionStamps | null
  entries: DictionaryEntry[]
  /** 查词来自搜索框时显示的查询词；null 表示来自 token 点击。 */
  searchQuery: string | null
  searchPending: boolean
  decisionScope: EvidenceSummaryScope | null
  /** 按词摘要是否已加载（区分裁定区「加载中」与「未裁定」）。 */
  decisionSummaryLoaded: boolean
  decisionError: string | null
  pendingDecision: LexemeDecisionValue | null
  onDecide: (decision: LexemeDecisionValue) => void
  onDismissDecisionError: () => void
  onSearch: (query: string) => void
  onRetry: () => void
}

/**
 * 词典查词面板内容（DESIGN.md 查词状态/交互状态）：关闭由外层 surface
 * 控制，本组件负责「已选 token；加载中；一个或多个词典来源；无结果；
 * 需要导入；错误」六种状态。来源、读音与释义都有显式标签；词典来源与
 * 分析器版本按真实响应展示，不虚构算法已验证的断言。
 */
export function LookupPanel({
  status,
  error,
  ftsUnavailable,
  token,
  versionStamps,
  entries,
  searchQuery,
  searchPending,
  decisionScope,
  decisionSummaryLoaded,
  decisionError,
  pendingDecision,
  onDecide,
  onDismissDecisionError,
  onSearch,
  onRetry,
}: LookupPanelProps) {
  const [queryInput, setQueryInput] = useState('')

  const submitSearch = () => {
    const query = queryInput.trim()
    if (query) onSearch(query)
  }

  return (
    <div aria-labelledby="lookup-panel-heading">
      <h2 id="lookup-panel-heading" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">查词</h2>

      {token ? (
        <div className="mt-3">
          <p className="font-serif-jp text-2xl leading-9">{token.surface}</p>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <div className="flex gap-1">
              <dt className="text-muted-foreground">读音</dt>
              <dd>
                {token.reading_form || '无'}
                <span className="ml-1 text-xs text-muted-foreground">（来源：{token.reading_source}）</span>
              </dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-muted-foreground">词性</dt>
              <dd>{token.pos}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          submitSearch()
        }}
      >
        <label htmlFor="lookup-search-input" className="sr-only">在整个词典中搜索</label>
        <input
          id="lookup-search-input"
          type="search"
          value={queryInput}
          onChange={(event) => setQueryInput(event.target.value)}
          placeholder="在整个词典中搜索"
          className="min-h-[40px] w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          disabled={searchPending}
          className="min-h-[40px] shrink-0 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {searchPending ? '搜索中…' : '搜索'}
        </button>
      </form>

      <div className="mt-4">
        {status === 'loading' ? (
          <p role="status" className="text-sm text-muted-foreground">正在查词…</p>
        ) : status === 'no_dictionary' ? (
          <div role="status" className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p>还没有可用的词典。查词需要先导入 Yomitan ZIP 词典；没有词典时算法解析仍可正常使用。</p>
          </div>
        ) : status === 'no_result' ? (
          <p role="status" className="text-sm text-muted-foreground">
            {searchQuery ? `词典中没有与「${searchQuery}」匹配的词条。` : '词典中没有匹配的词条。可以更换词元，或用上面的搜索框重新搜索。'}
          </p>
        ) : status === 'error' ? (
          <div role="alert" className="text-sm">
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
              {ftsUnavailable
                ? (error ?? '词典搜索暂不可用（503）：搜索索引缺失或损坏，请稍后重试。')
                : (error ?? '查词失败，请稍后重试。')}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              重试
            </button>
          </div>
        ) : (
          <>
            {searchQuery ? <p className="mb-3 text-xs text-muted-foreground">搜索「{searchQuery}」的结果：</p> : null}
            {entries.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">词典中没有匹配的词条。</p>
            ) : (
              <ul className="space-y-3">
                {entries.map((entry) => (
                  <li key={`${entry.source_id}:${entry.source_local_id}`} className="rounded-md border border-border p-3">
                    <p className="font-serif-jp text-lg">
                      {entry.expression}
                      {entry.reading ? <span className="ml-2 text-sm text-muted-foreground">{entry.reading}</span> : null}
                    </p>
                    <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <div className="flex gap-1">
                        <dt>来源</dt>
                        <dd>{entry.display_name} · 版本 {entry.source_version}</dd>
                      </div>
                      {entry.tags.length > 0 ? (
                        <div className="flex gap-1">
                          <dt>标签</dt>
                          <dd>{entry.tags.join('、')}</dd>
                        </div>
                      ) : null}
                    </dl>
                    <div className="mt-2">
                      <p className="text-xs font-medium text-muted-foreground">释义</p>
                      <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
                        {entry.definitions.map((definition) => (
                          <li key={definition.ordinal}>{definition.plain_text}</li>
                        ))}
                      </ol>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {versionStamps ? (
        <dl className="mt-5 border-t border-border pt-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <dt>算法来源</dt>
            <dd className="font-mono" title={versionStamps.sidecar_generation_id}>{versionStamps.sidecar_generation_id}</dd>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <dt className="sr-only">版本</dt>
            <dd>分句器 {versionStamps.segmenter_version} · 分词器 {versionStamps.tokenizer_version} · 分析词典 {versionStamps.analyzer_dict_version}</dd>
          </div>
        </dl>
      ) : null}

      <DecisionControls
        scope={decisionScope}
        summaryLoaded={decisionSummaryLoaded}
        pendingDecision={pendingDecision}
        error={decisionError}
        onDecide={onDecide}
        onDismissError={onDismissDecisionError}
      />

      <div className="mt-5 border-t border-border pt-4">
        <button
          type="button"
          aria-disabled="true"
          title="AI 学习会话尚未开放；当前阶段仅提供词典查词与显式 Lexeme 判断"
          className="cursor-not-allowed rounded-md border border-study/40 px-3 py-1.5 text-sm font-medium text-study opacity-60"
        >
          开始 AI 学习
        </button>
        <p className="mt-1 text-xs text-muted-foreground">AI 学习会话尚未开放；查词与判断不会创建学习会话或复习计划。</p>
      </div>
    </div>
  )
}
