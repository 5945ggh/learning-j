import { cn } from '@/lib/utils'
import { Badge, type BadgeTone } from './ui/badge'
import type { SessionPhase, SessionRecord } from './models'

const PHASE_LABEL: Record<SessionPhase, string> = {
  preparation: '准备中',
  discussion: '可讨论',
  extraction: '提取中',
  confirmation: '待确认',
}

const PHASE_TONE: Record<SessionPhase, BadgeTone> = {
  preparation: 'warning',
  discussion: 'study',
  extraction: 'lexical',
  confirmation: 'syntax',
}

const STATUS_LABEL: Record<SessionRecord['status'], string> = {
  active: '进行中',
  completed: '已完成',
  parked: '已搁置',
}

export type SessionListProps = {
  sessions: readonly SessionRecord[]
  emptyNote?: string
  dense?: boolean
  selectedId?: string | null
  onSelect?: (session: SessionRecord) => void
  className?: string
}

export function SessionPhaseBadge({ phase }: { phase: SessionPhase }) {
  return <Badge tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Badge>
}

export type SessionRowProps = {
  session: SessionRecord
  dense?: boolean
  selected?: boolean
  onSelect?: (session: SessionRecord) => void
}

export function SessionRow({ session, dense = false, selected = false, onSelect }: SessionRowProps) {
  const body = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <SessionPhaseBadge phase={session.phase} />
        {session.mode === 'automatic' ? <Badge tone="plain">自动生成并提取</Badge> : null}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{STATUS_LABEL[session.status]}</span>
      </div>
      <p className={cn('mt-1.5 text-foreground', dense ? 'line-clamp-1 text-xs' : 'line-clamp-2 text-sm leading-relaxed')}>
        {session.source_text || '（缺少来源句子）'}
      </p>
      {session.material_title ? <p className="mt-1 truncate text-xs text-muted-foreground">{session.material_title}</p> : null}
    </>
  )

  return onSelect ? (
    <button type="button" aria-pressed={selected} onClick={() => onSelect(session)} className={cn('group w-full rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', dense && 'px-2 py-2', selected && 'bg-muted')}>
      {body}
    </button>
  ) : (
    <div className={cn('rounded-md px-3 py-2.5', dense && 'px-2 py-2')}>{body}</div>
  )
}

/** Session list shared by material detail, queue and learning history views. */
export function SessionList({ sessions, emptyNote = '还没有学习会话。', dense = false, selectedId = null, onSelect, className }: SessionListProps) {
  if (sessions.length === 0) return <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">{emptyNote}</div>
  return (
    <div className={cn('flex flex-col gap-0.5', className)} role="list" aria-label="学习会话列表">
      {sessions.map((session) => (
        <div key={session.id} role="listitem">
          <SessionRow session={session} dense={dense} selected={selectedId === session.id} onSelect={onSelect} />
        </div>
      ))}
    </div>
  )
}

