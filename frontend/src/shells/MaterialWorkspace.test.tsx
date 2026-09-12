/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaterialWorkspace } from './MaterialWorkspace'
import {
  fixtureEpubMaterial,
  fixtureEpubSentences,
  fixtureLexemeCounts,
  fixtureSidecar,
  fixtureSubtitleMaterial,
  fixtureSubtitleSentences,
  fixtureTextMaterial,
  fixtureTextSentences,
} from '@/lib/material-fixtures'

const subtitleSidecar = {
  material_id: 'fixture-id-006',
  sidecar_generation_id: 'fixture-id-007',
  content_hash: 'd4e8866e776f2c1011d7df72b7710f378af6b7f8cbcd5739f329bac56a819abb',
  segmenter_version: 'learningj-segmenter-v1',
  tokenizer_version: '0.6.11',
  analyzer_dict_version: '20260723',
  payload: { sentences: [] },
}

const subtitleCounts = {
  material_id: 'fixture-id-006',
  sidecar_generation_id: 'fixture-id-007',
  counts: [{ lexeme_id: 'lx_9ca0779be06cdd19bcb8577014b30bdcf35ed0aae61773d3f3e62641deaf0bac', token_count: 2 }],
}

type StubOptions = {
  failMaterials?: boolean
}

function stubMaterialApi({ failMaterials = false }: StubOptions = {}) {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === '/materials') {
      if (failMaterials) {
        return Promise.resolve(new Response(JSON.stringify({ detail: 'down' }), { status: 500 }))
      }
      return Promise.resolve(new Response(JSON.stringify([fixtureTextMaterial, fixtureSubtitleMaterial, fixtureEpubMaterial])))
    }
    const bodies: Record<string, unknown> = {
      '/materials/fixture-id-001/sentences': fixtureTextSentences,
      '/materials/fixture-id-006/sentences': fixtureSubtitleSentences,
      '/materials/local-fixture-epub-001/sentences': fixtureEpubSentences,
      '/materials/fixture-id-001/sidecar': fixtureSidecar,
      '/materials/fixture-id-006/sidecar': subtitleSidecar,
      '/materials/fixture-id-001/lexeme-counts': fixtureLexemeCounts,
      '/materials/fixture-id-006/lexeme-counts': subtitleCounts,
    }
    const body = bodies[url]
    if (body === undefined) throw new Error(`unexpected frontend request: ${url}`)
    return Promise.resolve(new Response(JSON.stringify(body)))
  }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MaterialWorkspace（素材浏览 shell）', () => {
  it('自动选中首个素材并装载句子与内容索引', async () => {
    stubMaterialApi()
    render(<MaterialWorkspace />)

    expect(await screen.findByText('𠮟られた。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '书目（2）' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('偏移 0–5')).toBeInTheDocument()
    const index = screen.getByRole('region', { name: '内容索引' })
    expect(index).toHaveTextContent('fixture-id-002')
    expect(index).toHaveTextContent('条目 15 条 · token 总计 16')
  })

  it('素材加载失败时给出错误与重试，重试成功后恢复浏览', async () => {
    const user = userEvent.setup()
    stubMaterialApi({ failMaterials: true })
    render(<MaterialWorkspace />)

    expect(await screen.findByRole('alert')).toHaveTextContent('素材加载失败（500）')
    stubMaterialApi()
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('𠮟られた。')).toBeInTheDocument()
  })

  it('切换到视听并选择素材后，句子与内容索引随之更新', async () => {
    const user = userEvent.setup()
    stubMaterialApi()
    render(<MaterialWorkspace />)

    await screen.findByText('𠮟られた。')
    await user.click(screen.getByRole('button', { name: '视听（1）' }))
    await user.click(screen.getByRole('button', { name: /fixture-sample/ }))

    expect(await screen.findByText('また寄ってしまった。')).toBeInTheDocument()
    expect(screen.getByText('cue 0 · 00:01.000–00:04.200')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '内容索引' })).toHaveTextContent('fixture-id-007')
  })

  it('选中句子展示来源语境，不触发任何学习或播放语义', async () => {
    const user = userEvent.setup()
    stubMaterialApi()
    render(<MaterialWorkspace />)

    await screen.findByText('𠮟られた。')
    await user.click(screen.getAllByRole('button', { name: '选择句子' })[0]!)
    expect(await screen.findByRole('heading', { name: '𠮟られた。' })).toBeInTheDocument()
    expect(screen.getByText('来源定位：偏移 0–5')).toBeInTheDocument()
    expect(screen.queryByText(/开始 AI 学习|加入 AI 学习|查词/)).not.toBeInTheDocument()
  })

  it('没有 sidecar 的素材展示内容索引缺席状态', async () => {
    const user = userEvent.setup()
    stubMaterialApi()
    render(<MaterialWorkspace />)

    await screen.findByText('𠮟られた。')
    // EPUB 素材（local-fixture-epub-001）的 current_sidecar_id 为 null。
    await user.click(screen.getByRole('button', { name: /ローカル fixture 作品/ }))

    expect(await screen.findByText(/尚未生成内容索引/)).toBeInTheDocument()
  })
})
