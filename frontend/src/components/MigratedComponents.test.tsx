/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnalysisDocument } from './AnalysisDocument'
import { AgentConversation } from './AgentConversation'
import { ChapterList } from './ChapterList'
import { ConfirmationPanel } from './ConfirmationPanel'
import { HighlightedText, splitBySpans } from './HighlightedText'
import { KnowledgeAggregate } from './KnowledgeAggregate'
import { MaterialCard } from './MaterialCard'
import { ReviewCard } from './ReviewCard'
import { SessionList } from './SessionList'
import { fixtureTextMaterial } from '@/lib/material-fixtures'

afterEach(() => cleanup())

const sections = [{ id: 'section-1', revision: 1, heading: '句子结构', body_md: '前半句说明对象。\n\n后半句补充语境。' }]
const session = { id: 'session-1', phase: 'discussion' as const, status: 'active' as const, mode: 'interactive' as const, material_title: 'fixture', source_text: '𠮟られた。' }

describe('migrated shell-independent components', () => {
  it('uses code-point offsets when splitting spans', () => {
    expect(splitBySpans('𠮟られた。', [{ char_start: 0, char_end: 1 }])).toEqual([
      { text: '𠮟', marked: true },
      { text: 'られた。', marked: false },
    ])
    render(<HighlightedText text="𠮟られた。" spans={[{ char_start: 0, char_end: 1 }]} />)
    expect(screen.getByText('𠮟').tagName).toBe('MARK')
  })

  it('renders only imported chapters as actionable rows', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ChapterList kind="text" chapters={[{ id: 'c1', index: 1, progress: 0.34, imported: true }, { id: 'c2', index: 2, progress: 0, imported: false }]} onSelect={onSelect} />)
    expect(screen.getByText('第一章')).toBeInTheDocument()
    expect(screen.getByText('第二章')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /第一章/ }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }))
    expect(screen.queryByRole('button', { name: /第二章/ })).not.toBeInTheDocument()
  })

  it('keeps sessions callback-driven and distinguishes parked/completed state', () => {
    render(<SessionList sessions={[session, { ...session, id: 'session-2', status: 'parked', phase: 'preparation' }]} onSelect={() => {}} />)
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText('已搁置')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '学习会话列表' })).toBeInTheDocument()
  })

  it('shows explicit document draft and committed revision states', () => {
    const { rerender } = render(<AnalysisDocument status="draft" draft="正在准备…" />)
    expect(screen.getByText('正在准备…')).toBeInTheDocument()
    rerender(<AnalysisDocument status="ready" revision={{ revision: 1, sections }} />)
    expect(screen.getByText('版本 v1')).toBeInTheDocument()
    expect(screen.getByText(/前半句说明对象/)).toBeInTheDocument()
  })

  it('does not send Agent questions before discussion', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const { rerender } = render(<AgentConversation status="preparation" messages={[]} draft="" onSubmit={onSubmit} onDraftChange={() => {}} />)
    expect(screen.getByText('准备中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    rerender(<AgentConversation status="discussion" messages={[]} draft="问题" onSubmit={onSubmit} onDraftChange={() => {}} />)
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(onSubmit).toHaveBeenCalledWith('问题')
  })

  it('keeps extraction and confirmation visibly unavailable', () => {
    render(<ConfirmationPanel status="ready" candidateCount={2} />)
    expect(screen.getByRole('heading', { name: '提取与确认' })).toBeInTheDocument()
    expect(screen.getByText(/待实现/)).toBeInTheDocument()
    expect(screen.getByText(/收到 2 项候选/)).toBeInTheDocument()
  })

  it('emits material intents without routing or reducer state', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const onQueue = vi.fn()
    render(<MaterialCard material={fixtureTextMaterial} onOpen={onOpen} onOpenQueue={onQueue} metadata={{ active_session_count: 2 }} />)
    await user.click(screen.getByRole('button', { name: '打开《fixture-sample》' }))
    await user.click(screen.getByRole('button', { name: '解析队列 2' }))
    expect(onOpen).toHaveBeenCalledWith(fixtureTextMaterial)
    expect(onQueue).toHaveBeenCalledWith(fixtureTextMaterial)
  })

  it('keeps knowledge grouping display-only and emits occurrence identity', async () => {
    const user = userEvent.setup()
    const onRetentionChange = vi.fn()
    const onReturnToSource = vi.fn()
    const aggregate = {
      id: 'kp-1', form: '君', reading: 'きみ', kind_label: '代名词', default_retention: 'srs' as const, default_retention_set_by: 'default' as const,
      occurrences: [{ id: 'occ-1', sentence_id: 's1', material_id: 'm1', sentence_text: '次は君。', spans: [{ char_start: 2, char_end: 3 }], brief: '称呼', retention: 'inherit' as const, effective_retention: 'srs' as const, review_status: 'queued' as const, salience: 'primary' as const }],
    }
    render(<KnowledgeAggregate aggregate={aggregate} onRetentionChange={onRetentionChange} onReturnToSource={onReturnToSource} />)
    expect(screen.getByText('等待新卡配额')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '安排复习' }))
    await user.click(screen.getByRole('button', { name: '回到来源' }))
    expect(onRetentionChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'occ-1' }), 'srs')
    expect(onReturnToSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'occ-1' }))
  })

  it('renders review status without inventing an FSRS timer', () => {
    render(<ReviewCard card={{ id: 'r1', form: '君', sentence_text: '次は君。', spans: [{ char_start: 2, char_end: 3 }], status: 'active', brief: '称呼' }} />)
    expect(screen.getByText('已加入复习')).toBeInTheDocument()
    expect(screen.getByText(/评分待接入/)).toBeInTheDocument()
    expect(screen.queryByText(/倒计时|剩余/)).not.toBeInTheDocument()
  })
})

