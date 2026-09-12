/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SentenceContext } from './SentenceContext'
import { fixtureSubtitleSentences, fixtureTextSentences } from '@/lib/material-fixtures'
import type { Sentence } from '@/lib/materials'

afterEach(() => cleanup())

const baseSentence = fixtureTextSentences[0]
if (!baseSentence) throw new Error('fixture 必须包含首句')

describe('SentenceContext', () => {
  it('展示选中句子的原文、序号与来源定位', () => {
    render(<SentenceContext sentence={baseSentence} />)
    expect(screen.getByRole('heading', { name: '𠮟られた。' })).toBeInTheDocument()
    expect(screen.getByText('第 1 句')).toBeInTheDocument()
    expect(screen.getByText('来源定位：偏移 0–5')).toBeInTheDocument()
  })

  it('字幕句的时间戳并入来源定位，不重复展示', () => {
    render(<SentenceContext sentence={fixtureSubtitleSentences[0]!} />)
    expect(screen.getByText('来源定位：cue 0 · 00:01.000–00:04.200')).toBeInTheDocument()
  })

  it('非字幕句携带可选时间戳时单独展示', () => {
    const timed: Sentence = {
      ...baseSentence,
      time_start: 1000,
      time_end: 4200,
    }
    render(<SentenceContext sentence={timed} />)
    expect(screen.getByText('来源定位：偏移 0–5')).toBeInTheDocument()
    expect(screen.getByText('时间戳：00:01.000–00:04.200')).toBeInTheDocument()
  })

  it('带译文时作为参考展示', () => {
    const translated: Sentence = {
      ...baseSentence,
      translation: '（本地 fixture）被训斥了。',
    }
    render(<SentenceContext sentence={translated} />)
    expect(screen.getByText('译文：（本地 fixture）被训斥了。')).toBeInTheDocument()
  })
})
