/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LookupPanel } from './LookupPanel'
import {
  fixtureEvidenceSummary,
  fixtureLookupResult,
  fixtureSearchResult,
  fixtureSentenceTokens,
} from '@/lib/reader-fixtures'

afterEach(() => cleanup())

const token = fixtureSentenceTokens.tokens[2]! // 君

const baseProps = {
  status: 'ready' as const,
  error: null,
  ftsUnavailable: false,
  token,
  versionStamps: {
    sidecar_generation_id: 'fixture-id-005',
    segmenter_version: 'learningj-segmenter-v1',
    tokenizer_version: '0.6.11',
    analyzer_dict_version: '20260723',
  },
  entries: fixtureLookupResult.entries,
  searchQuery: null,
  searchPending: false,
  decisionScope: null,
  decisionSummaryLoaded: true,
  decisionError: null,
  pendingDecision: null,
  onDecide: () => {},
  onDismissDecisionError: () => {},
  onSearch: () => {},
  onRetry: () => {},
}

describe('LookupPanel（查词面板状态）', () => {
  it('加载中显示紧凑状态', () => {
    render(<LookupPanel {...baseProps} status="loading" />)
    expect(screen.getByText('正在查词…')).toBeInTheDocument()
  })

  it('无词典时提示需要导入，算法解析仍可用', () => {
    render(<LookupPanel {...baseProps} status="no_dictionary" entries={[]} />)
    expect(screen.getByText(/还没有可用的词典/)).toBeInTheDocument()
    expect(screen.getByText(/Yomitan/)).toBeInTheDocument()
  })

  it('有词典但无结果时说明无匹配并保留搜索出口', () => {
    render(<LookupPanel {...baseProps} status="no_result" entries={[]} />)
    expect(screen.getByText(/词典中没有匹配的词条/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '搜索' })).toBeInTheDocument()
  })

  it('就绪状态展示读音、释义与词典来源/版本 provenance', () => {
    render(<LookupPanel {...baseProps} />)
    expect(screen.getAllByText('来源').length).toBeGreaterThan(0)
    expect(screen.getAllByText('fixture-辞書 · 版本 2026-09-12').length).toBeGreaterThan(0)
    expect(screen.getAllByText('释义').length).toBeGreaterThan(0)
    expect(screen.getByText('you')).toBeInTheDocument()
    expect(screen.getByText('第二人称代词')).toBeInTheDocument()
    expect(screen.getByText('代名詞')).toBeInTheDocument()
  })

  it('算法解析版本戳与代次可见（分析器来源真实展示）', () => {
    render(<LookupPanel {...baseProps} />)
    expect(screen.getByTitle('fixture-id-005')).toBeInTheDocument()
    expect(screen.getByText('分句器 learningj-segmenter-v1 · 分词器 0.6.11 · 分析词典 20260723')).toBeInTheDocument()
  })

  it('普通错误保留面板并给出局部重试', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<LookupPanel {...baseProps} status="error" error="查词加载失败（500）" onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('查词加载失败（500）')
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('FTS 503 使用专用文案（索引不可用 ≠ 无结果）', () => {
    render(<LookupPanel {...baseProps} status="error" ftsUnavailable error={null} />)
    expect(screen.getByRole('alert')).toHaveTextContent('词典搜索暂不可用（503）')
    expect(screen.getByRole('alert')).toHaveTextContent('索引缺失或损坏')
  })

  it('搜索框提交触发 onSearch', async () => {
    const user = userEvent.setup()
    const onSearch = vi.fn()
    render(<LookupPanel {...baseProps} onSearch={onSearch} />)
    await user.type(screen.getByLabelText('在整个词典中搜索'), '頑')
    await user.click(screen.getByRole('button', { name: '搜索' }))
    expect(onSearch).toHaveBeenCalledWith('頑')
  })

  it('搜索来源的结果标注查询词', () => {
    render(<LookupPanel {...baseProps} searchQuery="頑" entries={fixtureSearchResult.entries} />)
    expect(screen.getByText(/搜索「頑」的结果/)).toBeInTheDocument()
    expect(screen.getByText('頑張る')).toBeInTheDocument()
  })
})

describe('LookupPanel（Lexeme 显式裁定 UI）', () => {
  it('展示当前判断与 Lexeme 级作用域说明；未裁定时三个控件均可用', async () => {
    const user = userEvent.setup()
    const onDecide = vi.fn()
    render(<LookupPanel {...baseProps} decisionScope={null} onDecide={onDecide} />)
    expect(screen.getByText('针对整个词元（Lexeme 级），适用于它的所有词形；本次遇到的词形不会单独记录。')).toBeInTheDocument()
    expect(screen.getByText('当前判断：')).toHaveTextContent('未裁定')
    await user.click(screen.getByRole('button', { name: '这个我认识' }))
    expect(onDecide).toHaveBeenCalledWith('known')
    await user.click(screen.getByRole('button', { name: '目前不认识' }))
    expect(onDecide).toHaveBeenCalledWith('unknown')
    await user.click(screen.getByRole('button', { name: '清除我的判断' }))
    expect(onDecide).toHaveBeenCalledWith('clear')
  })

  it('已有判断时标记当前项（aria-pressed），提交中禁用全部控件', () => {
    const onDecide = vi.fn()
    const { rerender } = render(
      <LookupPanel {...baseProps} decisionScope={fixtureEvidenceSummary.scopes[0]!} onDecide={onDecide} />,
    )
    expect(screen.getByRole('button', { name: '这个我认识' })).toHaveAttribute('aria-pressed', 'true')
    rerender(<LookupPanel {...baseProps} decisionScope={fixtureEvidenceSummary.scopes[0]!} pendingDecision="known" />)
    for (const name of [/^这个我认识/, /^目前不认识/, /^清除我的判断/]) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })

  it('裁定错误（如 409 冲突）在控件区内显式展示并可消除', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(
      <LookupPanel
        {...baseProps}
        decisionScope={fixtureEvidenceSummary.scopes[0]!}
        decisionError="作用域 'lexeme:' 的裁定序号已变更（expected=0, current=2）；请刷新后重试。 判断状态已自动刷新，请重试。"
        onDismissDecisionError={onDismiss}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('裁定序号已变更')
    await user.click(screen.getByRole('button', { name: '知道了' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('AI 学习入口保持禁用并解释不可用原因（不伪装会话创建）', () => {
    render(<LookupPanel {...baseProps} />)
    const start = screen.getByRole('button', { name: '开始 AI 学习' })
    expect(start).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText(/AI 学习会话尚未开放/)).toBeInTheDocument()
  })
})
