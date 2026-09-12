/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContentIndexPanel } from './ContentIndexPanel'
import { fixtureLexemeCounts, fixtureSidecar } from '@/lib/material-fixtures'

afterEach(() => cleanup())

describe('ContentIndexPanel states', () => {
  it('素材没有 sidecar 时展示缺席状态', () => {
    render(<ContentIndexPanel status="absent" sidecar={null} counts={null} error={null} onRetry={() => {}} />)
    expect(screen.getByRole('region', { name: '内容索引' })).toHaveTextContent('尚未生成内容索引')
  })

  it('加载中显示紧凑状态', () => {
    render(<ContentIndexPanel status="loading" sidecar={null} counts={null} error={null} onRetry={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('正在加载内容索引…')
  })

  it('错误状态可局部重试', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<ContentIndexPanel status="error" sidecar={null} counts={null} error="词频加载失败（500）" onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('词频加载失败（500）')
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('就绪状态展示代次、三个版本戳与单代次词频汇总', () => {
    render(<ContentIndexPanel status="ready" sidecar={fixtureSidecar} counts={fixtureLexemeCounts} error={null} onRetry={() => {}} />)
    const region = screen.getByRole('region', { name: '内容索引' })
    expect(region).toHaveTextContent('fixture-id-002')
    expect(region).toHaveTextContent('分句器 learningj-segmenter-v1 · 分词器 0.6.11 · 分析词典 20260723')
    expect(region).toHaveTextContent('条目 15 条 · token 总计 16')
    expect(region).not.toHaveTextContent('不一致')
  })

  it('词频代次与 sidecar 代次不一致时显式呈现契约违例', () => {
    const mismatchedCounts = { ...fixtureLexemeCounts, sidecar_generation_id: 'fixture-id-999' }
    render(<ContentIndexPanel status="ready" sidecar={fixtureSidecar} counts={mismatchedCounts} error={null} onRetry={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('fixture-id-999')
    expect(screen.getByRole('status')).toHaveTextContent('fixture-id-002')
  })

  it('sidecar 就绪而词频缺失时说明未加载，不虚构统计', () => {
    render(<ContentIndexPanel status="ready" sidecar={fixtureSidecar} counts={null} error={null} onRetry={() => {}} />)
    expect(screen.getByText('材料词频未加载。')).toBeInTheDocument()
  })
})
