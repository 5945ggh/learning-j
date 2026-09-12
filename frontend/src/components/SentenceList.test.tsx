/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SentenceList } from './SentenceList'
import {
  fixtureEpubMaterial,
  fixtureEpubSentences,
  fixtureSubtitleMaterial,
  fixtureSubtitleSentences,
  fixtureTextMaterial,
  fixtureTextSentences,
  unavailableAnchorSentence,
} from '@/lib/material-fixtures'

afterEach(() => cleanup())

describe('SentenceList states', () => {
  it('未选素材与空句列表是两个不同的空状态', () => {
    const { rerender } = render(<SentenceList material={null} sentences={[]} />)
    expect(screen.getByText('选择一个素材开始浏览。')).toBeInTheDocument()

    rerender(<SentenceList material={fixtureTextMaterial} sentences={[]} />)
    expect(screen.getByText('这个素材还没有可显示的句子。')).toBeInTheDocument()
  })

  it('plain_text 句展示 code point 偏移与原文', () => {
    render(<SentenceList material={fixtureTextMaterial} sentences={fixtureTextSentences} />)
    const list = screen.getByRole('list', { name: 'fixture-sample 的句子' })
    expect(list).toHaveTextContent('𠮟られた。')
    expect(list).toHaveTextContent('偏移 0–5')
    expect(list).toHaveTextContent('偏移 15–22')
    expect(list).not.toHaveTextContent('定位不可用')
  })

  it('subtitle 句展示 cue 与时间戳', () => {
    render(<SentenceList material={fixtureSubtitleMaterial} sentences={fixtureSubtitleSentences} />)
    const list = screen.getByRole('list', { name: 'fixture-sample 的句子' })
    expect(list).toHaveTextContent('cue 0 · 00:01.000–00:04.200')
    expect(list).toHaveTextContent('cue 1 · 00:04.400–00:08.000')
  })

  it('epub 句展示 spine 与偏移；非法锚点呈现定位不可用', () => {
    render(
      <SentenceList material={fixtureEpubMaterial} sentences={[...fixtureEpubSentences, unavailableAnchorSentence]} />,
    )
    const list = screen.getByRole('list', { name: 'ローカル fixture 作品 的句子' })
    expect(list).toHaveTextContent('spine 2 · 偏移 0–13')
    expect(list).toHaveTextContent('spine 4 · 偏移 8–16')
    expect(list).toHaveTextContent('定位不可用')
  })

  it('选择句子只是浏览定位回调，不携带任何学习语义', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<SentenceList material={fixtureTextMaterial} sentences={fixtureTextSentences} onSelect={onSelect} />)
    await user.click(screen.getAllByRole('button', { name: '选择句子' })[0]!)
    expect(onSelect).toHaveBeenCalledWith(fixtureTextSentences[0])
  })
})
