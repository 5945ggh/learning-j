import { useState, type FormEvent } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import type { AnalysisMessageRecord } from './models'

export type AgentConversationStatus = 'preparation' | 'discussion' | 'streaming' | 'paused' | 'error' | 'unavailable'

export type AgentConversationProps = {
  status: AgentConversationStatus
  messages: readonly AnalysisMessageRecord[]
  draft: string
  onDraftChange?: (draft: string) => void
  onSubmit?: (question: string) => void
  onRetry?: () => void
  onContinue?: () => void
  error?: string | null
  className?: string
}

const STATUS_COPY: Record<AgentConversationStatus, string> = {
  preparation: '准备中',
  discussion: '可讨论',
  streaming: '正在生成',
  paused: '已暂停',
  error: '运行失败',
  unavailable: '待实现',
}

/**
 * Agent conversation projection. It renders server/provider state supplied by
 * the owner; no timer, provider call, route transition, or hidden state lives
 * in this component.
 */
export function AgentConversation({
  status,
  messages,
  draft,
  onDraftChange,
  onSubmit,
  onRetry,
  onContinue,
  error = null,
  className,
}: AgentConversationProps) {
  const [localDraft, setLocalDraft] = useState(draft)
  const controlled = onDraftChange !== undefined
  const value = controlled ? draft : localDraft
  const canSend = Boolean(onSubmit) && status === 'discussion' && value.trim().length > 0

  const changeDraft = (next: string) => {
    if (controlled) onDraftChange(next)
    else setLocalDraft(next)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const question = value.trim()
    if (!question || !onSubmit || status !== 'discussion') return
    onSubmit(question)
    if (!controlled) setLocalDraft('')
  }

  return (
    <section className={cn('flex min-h-0 flex-col rounded-md border border-border bg-card shadow-sm', className)} aria-labelledby="agent-conversation-heading">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agent 对话</p>
          <h2 id="agent-conversation-heading" className="mt-1 text-sm font-semibold">{STATUS_COPY[status]}</h2>
        </div>
        {status === 'streaming' ? <span role="status" className="text-xs text-muted-foreground">等待服务端结果…</span> : null}
      </header>

      {status === 'preparation' ? <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">会话正在准备；首稿提交后才能发送讨论。</p> : null}
      {status === 'paused' ? (
        <div className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
          <p>会话已暂停；继续后沿用当前文档版本。</p>
          {onContinue ? <Button variant="study" size="sm" className="mt-2" onClick={onContinue}>继续会话</Button> : null}
        </div>
      ) : null}
      {status === 'error' ? (
        <div role="alert" className="border-b border-border bg-destructive/5 px-4 py-3 text-sm">
          <p>{error ?? 'Agent 运行失败'}</p>
          {onRetry ? <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>重试</Button> : null}
        </div>
      ) : null}
      {status === 'unavailable' ? <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">Agent 对话尚未接入；这里是 Study 的诚实骨架。</p> : null}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 ? <p className="text-sm text-muted-foreground">还没有对话消息。</p> : null}
        {messages.map((message) => (
          <article key={message.id} className={cn('rounded-md border px-3 py-2.5 text-sm', message.role === 'user' ? 'border-study/30 bg-study/5' : 'border-border bg-muted/40')}>
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
              <span>{message.role === 'user' ? '我' : 'Agent'}</span>
              {(message.pending_note ?? message.pendingNote) ? <span role="status">{message.pending_note ?? message.pendingNote}</span> : null}
            </div>
            <p className="mt-1.5 whitespace-pre-wrap leading-6">{message.content}</p>
            {(message.edited_sections ?? message.editedSections)?.length ? <p className="mt-2 border-t border-border pt-2 text-xs text-study">已更新：{(message.edited_sections ?? message.editedSections)?.join('、')}</p> : null}
          </article>
        ))}
      </div>

      <form onSubmit={submit} className="border-t border-border p-3">
        <label htmlFor="agent-question" className="sr-only">向 Agent 提问</label>
        <textarea
          id="agent-question"
          value={value}
          onChange={(event) => changeDraft(event.target.value)}
          disabled={!onDraftChange && !onSubmit || status !== 'discussion'}
          placeholder={status === 'discussion' ? '输入问题…' : '讨论将在首稿提交后开放'}
          rows={3}
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-end">
          <Button variant="study" size="sm" type="submit" disabled={!canSend}>{status === 'streaming' ? '发送中…' : '发送'}</Button>
        </div>
      </form>
    </section>
  )
}
