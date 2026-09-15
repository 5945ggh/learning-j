import type { MaterialLexemeCounts, Sidecar } from '@/lib/materials'

export type ContentIndexStatus = 'loading' | 'error' | 'ready' | 'absent'

type ContentIndexPanelProps = {
  status: ContentIndexStatus
  sidecar: Sidecar | null
  counts: MaterialLexemeCounts | null
  error: string | null
  onRetry: () => void
}

/**
 * 内容索引面板：展示选中素材的不可变 sidecar 代次、三个版本戳与单代次
 * 稀疏材料词频汇总（plan §1.5、data-model §8.3/§11）。词频是算法统计
 * 元数据，不是已知／未知判断，也不包含任何学习记录。
 */
export function ContentIndexPanel({ status, sidecar, counts, error, onRetry }: ContentIndexPanelProps) {
  return (
    <section className="rounded-[var(--radius-grouped)] border border-divider bg-opaque-surface p-5" aria-labelledby="content-index-heading">
      <h2 id="content-index-heading" className="text-sm font-semibold uppercase tracking-wider text-secondary-text">内容索引</h2>
      {status === 'absent' ? (
        <p className="mt-3 text-sm text-muted-foreground">尚未生成内容索引；素材导入流程完成后，分句与材料词频会显示在这里。</p>
      ) : status === 'loading' ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">正在加载内容索引…</p>
      ) : status === 'error' ? (
        <div role="alert" className="mt-3 text-sm">
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3">{error ?? '内容索引加载失败'}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            重试
          </button>
        </div>
      ) : sidecar ? (
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">sidecar 代次</dt>
            <dd className="font-mono text-xs" title={sidecar.sidecar_generation_id}>{sidecar.sidecar_generation_id}</dd>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">版本</dt>
            <dd>
              分句器 {sidecar.segmenter_version} · 分词器 {sidecar.tokenizer_version} · 分析词典 {sidecar.analyzer_dict_version}
            </dd>
          </div>
          {counts ? (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">材料词频</dt>
                <dd>条目 {counts.counts.length} 条 · token 总计 {counts.counts.reduce((total, entry) => total + entry.token_count, 0)}</dd>
              </div>
              {counts.sidecar_generation_id !== sidecar.sidecar_generation_id ? (
                <p role="status" className="rounded-md border border-syntax/50 bg-syntax/10 p-3 text-xs">
                  词频代次（{counts.sidecar_generation_id}）与 sidecar 代次（{sidecar.sidecar_generation_id}）不一致；契约要求同一响应只携带一个代次。请重试或报告后端问题。
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">材料词频未加载。</p>
          )}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">尚未生成内容索引；素材导入流程完成后，分句与材料词频会显示在这里。</p>
      )}
    </section>
  )
}
