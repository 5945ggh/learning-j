/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaterialLibrary } from './MaterialLibrary'
import { fixtureEpubMaterial, fixtureSubtitleMaterial, fixtureTextMaterial } from '@/lib/material-fixtures'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MaterialLibrary states', () => {
  it('加载中显示紧凑加载状态', () => {
    render(<MaterialLibrary status="loading" materials={[]} error={null} mode="books" onModeChange={() => {}} selectedId={null} onSelect={() => {}} onRetry={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('正在加载素材…')
  })

  it('错误状态保留重试入口并触发回调', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<MaterialLibrary status="error" materials={[]} error="素材加载失败（500）" mode="books" onModeChange={() => {}} selectedId={null} onSelect={() => {}} onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('素材加载失败（500）')
    expect(screen.getByRole('alert')).toHaveTextContent('素材浏览不依赖 BYOK')
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('整体为空时展示导入引导空状态', () => {
    render(<MaterialLibrary status="ready" materials={[]} error={null} mode="books" onModeChange={() => {}} selectedId={null} onSelect={() => {}} onRetry={() => {}} />)
    expect(screen.getByText('还没有素材。导入 txt、srt、vtt 或 EPUB 后会显示在这里。')).toBeInTheDocument()
  })

  it('书目/视听模式各自过滤素材并显示数量', () => {
    const onSelect = vi.fn()
    const materials = [fixtureTextMaterial, fixtureSubtitleMaterial, fixtureEpubMaterial]
    render(<MaterialLibrary status="ready" materials={materials} error={null} mode="books" onModeChange={() => {}} selectedId={null} onSelect={onSelect} onRetry={() => {}} />)

    expect(screen.getByRole('button', { name: '书目（2）' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '视听（1）' })).toHaveAttribute('aria-pressed', 'false')
    const list = screen.getByRole('list', { name: '素材列表' })
    expect(list).toHaveTextContent('文本 · 3 句 · 已建内容索引')
    expect(list).toHaveTextContent('EPUB · 2 句 · 未建内容索引')
    expect(list).not.toHaveTextContent('视频 · 2 句 · 已建内容索引')
  })

  it('当前模式没有素材时展示模式专属空状态', () => {
    render(<MaterialLibrary status="ready" materials={[fixtureSubtitleMaterial]} error={null} mode="books" onModeChange={() => {}} selectedId={null} onSelect={() => {}} onRetry={() => {}} />)
    expect(screen.getByText('书目里还没有文本或 EPUB 素材。')).toBeInTheDocument()
  })

  it('切换模式与选择素材通过回调上抛', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    const onSelect = vi.fn()
    render(
      <MaterialLibrary
        status="ready"
        materials={[fixtureTextMaterial, fixtureSubtitleMaterial]}
        error={null}
        mode="books"
        onModeChange={onModeChange}
        selectedId={null}
        onSelect={onSelect}
        onRetry={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: '视听（1）' }))
    expect(onModeChange).toHaveBeenCalledWith('audiovisual')
    await user.click(screen.getByRole('button', { name: /fixture-sample/ }))
    expect(onSelect).toHaveBeenCalledWith(fixtureTextMaterial)
  })
})
