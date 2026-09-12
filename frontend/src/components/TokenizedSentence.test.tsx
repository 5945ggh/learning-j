/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TokenizedSentence, tokenKey } from './TokenizedSentence'
import { fixtureSentenceTokens } from '@/lib/reader-fixtures'
import { fixtureTextSentences } from '@/lib/material-fixtures'

afterEach(() => cleanup())

const sentence = fixtureTextSentences[1]! // 次は君の番です！

describe('TokenizedSentence（算法解析视图）', () => {
  it('渲染 token 按钮并携带读音/词性的屏幕阅读器标签', () => {
    render(
      <TokenizedSentence
        sentence={sentence}
        tokens={fixtureSentenceTokens.tokens}
        loading={false}
        error={null}
        selectedKey={null}
        onTokenSelect={() => {}}
        onRetry={() => {}}
      />,
    )
    const jun = screen.getByRole('button', { name: /君，读音 キミ，词性 代名詞/ })
    expect(jun).toHaveTextContent('君')
    expect(jun).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /は，读音 ハ/ })).toBeInTheDocument()
    // 表层来自后端 code point 切片，全角符号原样渲染。
    expect(screen.getByRole('button', { name: /！，读音 !/ })).toHaveTextContent('！')
  })

  it('单次点击触发 onTokenSelect 并传出触发元素（不产生任何写入）', async () => {
    const user = userEvent.setup()
    const onTokenSelect = vi.fn()
    render(
      <TokenizedSentence
        sentence={sentence}
        tokens={fixtureSentenceTokens.tokens}
        loading={false}
        error={null}
        selectedKey={null}
        onTokenSelect={onTokenSelect}
        onRetry={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: /君，读音/ }))
    expect(onTokenSelect).toHaveBeenCalledTimes(1)
    const [token, trigger] = onTokenSelect.mock.calls[0] as unknown as [unknown, HTMLElement]
    expect((token as { surface: string }).surface).toBe('君')
    expect(trigger).toBeInstanceOf(HTMLButtonElement)
  })

  it('聚焦时 Enter 与 Space 都触发选中（键盘可达，不要求修饰键）', async () => {
    const user = userEvent.setup()
    const onTokenSelect = vi.fn()
    render(
      <TokenizedSentence
        sentence={sentence}
        tokens={fixtureSentenceTokens.tokens}
        loading={false}
        error={null}
        selectedKey={null}
        onTokenSelect={onTokenSelect}
        onRetry={() => {}}
      />,
    )
    const jun = screen.getByRole('button', { name: /君，读音/ })
    jun.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onTokenSelect).toHaveBeenCalledTimes(2)
  })

  it('选中的 token 呈现按压态与视觉区分（不只有颜色）', () => {
    const selected = fixtureSentenceTokens.tokens[2]!
    render(
      <TokenizedSentence
        sentence={sentence}
        tokens={fixtureSentenceTokens.tokens}
        loading={false}
        error={null}
        selectedKey={tokenKey(selected)}
        onTokenSelect={() => {}}
        onRetry={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /君，读音/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('加载与错误状态可重试，不使句子文本消失', () => {
    const { rerender } = render(
      <TokenizedSentence
        sentence={sentence}
        tokens={[]}
        loading
        error={null}
        selectedKey={null}
        onTokenSelect={() => {}}
        onRetry={() => {}}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('正在加载 token 表…')
    expect(screen.getByText(`句子：${sentence.text}`)).toBeInTheDocument()
    rerender(
      <TokenizedSentence
        sentence={sentence}
        tokens={[]}
        loading={false}
        error="token 表加载失败（500）"
        selectedKey={null}
        onTokenSelect={() => {}}
        onRetry={() => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('token 表加载失败（500）')
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(screen.getByText(`句子：${sentence.text}`)).toBeInTheDocument()
  })
})
