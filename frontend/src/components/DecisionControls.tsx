import type { LexemeDecisionValue, EvidenceSummaryScope } from '@/lib/lexemes'

type DecisionControlsProps = {
  /** 作用域摘要（Lexeme 级 `lexeme:` 作用域）；摘要已加载但无该行时为 null（=未裁定）。 */
  scope: EvidenceSummaryScope | null
  /** 按词摘要是否已加载完成（区分「加载中」与「已加载但未裁定」）。 */
  summaryLoaded: boolean
  /** 提交中的裁定（禁用所有按钮）；null 表示空闲。 */
  pendingDecision: LexemeDecisionValue | null
  /** 提交错误信息（含 409 冲突）。 */
  error: string | null
  onDecide: (decision: LexemeDecisionValue) => void
  onDismissError: () => void
}

const DECISION_LABELS: Record<LexemeDecisionValue, string> = {
  known: '这个我认识',
  unknown: '目前不认识',
  clear: '清除我的判断',
}

export function decisionLabel(decision: LexemeDecisionValue): string {
  return DECISION_LABELS[decision]
}

/**
 * Lexeme 裁定控件（DESIGN.md 查词流程末段）。「认识／不认识／清除」是
 * Lexeme 域中的显式用户操作：界面明确标注操作针对整个词元（Lexeme 级）
 * 而非本次遇到的词形；控件只在用户点击时提交裁定，查词与浏览不写入。
 * 这些操作都不会创建 KP 或 ReviewItem。
 */
export function DecisionControls({ scope, summaryLoaded, pendingDecision, error, onDecide, onDismissError }: DecisionControlsProps) {
  const current = scope?.current_decision ?? null
  const decisionLabelFor = (decision: LexemeDecisionValue) => (current === decision ? `${DECISION_LABELS[decision]}（当前判断）` : DECISION_LABELS[decision])

  return (
    <section className="mt-5 border-t border-border pt-4" aria-labelledby="decision-controls-heading">
      <h3 id="decision-controls-heading" className="text-sm font-semibold text-muted-foreground">我的判断</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        针对整个词元（Lexeme 级），适用于它的所有词形；本次遇到的词形不会单独记录。
      </p>
      {summaryLoaded ? (
        <p className="mt-2 text-sm">
          当前判断：
          {current ? (
            <span className="ml-1 rounded-sm bg-lexical/15 px-1.5 py-0.5 font-medium text-lexical">{decisionLabelFor(current)}</span>
          ) : (
            <span className="ml-1 text-muted-foreground">未裁定</span>
          )}
        </p>
      ) : (
        <p role="status" className="mt-2 text-sm text-muted-foreground">正在加载判断状态…</p>
      )}
      {error ? (
        <div role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p>{error}</p>
          <button
            type="button"
            onClick={onDismissError}
            className="mt-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            知道了
          </button>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {(Object.keys(DECISION_LABELS) as LexemeDecisionValue[]).map((decision) => {
          const submitting = pendingDecision !== null
          return (
            <button
              key={decision}
              type="button"
              aria-pressed={current === decision}
              disabled={submitting}
              onClick={() => onDecide(decision)}
              className="min-h-[40px] rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingDecision === decision ? `${DECISION_LABELS[decision]}…` : DECISION_LABELS[decision]}
            </button>
          )
        })}
      </div>
    </section>
  )
}
