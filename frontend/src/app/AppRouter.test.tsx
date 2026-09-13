/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRouter } from './AppRouter'
import { RepositoryProvider, createDefaultRepositories, createFixtureRepositories } from './repository-context'
import { fixtureEpubMaterial, fixtureSubtitleMaterial, fixtureTextMaterial } from '@/lib/material-fixtures'
import { fixtureSentenceTokens, fixtureSubtitleSentenceTokens } from '@/lib/reader-fixtures'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function renderRoute(path: string) {
  return render(
    <RepositoryProvider repositories={createFixtureRepositories()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRouter />
      </MemoryRouter>
    </RepositoryProvider>,
  )
}

function renderDefaultRoute(path: string) {
  return render(
    <RepositoryProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRouter />
      </MemoryRouter>
    </RepositoryProvider>,
  )
}

describe('formal route and shell composition', () => {
  it('keeps the default adapter boundary API-backed for P1/P2 and fixture-only for P3+', () => {
    const repositories = createDefaultRepositories()
    expect(repositories.materials.source).toBe('api')
    expect(repositories.reader.source).toBe('api')
    expect(repositories.study.source).toBe('fixture')
    expect(repositories.knowledge.source).toBe('fixture')
    expect(repositories.review.source).toBe('fixture')
  })

  it('keeps the five top-level entry labels and settings link in AppShell', () => {
    renderRoute('/')
    expect(screen.getByRole('heading', { name: '主页' })).toBeInTheDocument()
    expect(screen.getAllByText('素材库').length).toBeGreaterThan(0)
    expect(screen.getAllByText('知识库').length).toBeGreaterThan(0)
    expect(screen.getAllByText('解析队列').length).toBeGreaterThan(0)
    expect(screen.getAllByText('学习中心').length).toBeGreaterThan(0)
    expect(screen.getAllByTitle('设置').length).toBeGreaterThan(0)
  })

  it('uses repository-backed fixture states for queue and full-screen Study', async () => {
    renderRoute('/queue')
    expect(await screen.findByRole('heading', { name: '解析队列' })).toBeInTheDocument()
    expect(screen.getAllByText(/准备中/).length).toBeGreaterThan(0)
  })

  it('renders the API-shaped material card grid and its Study entry', async () => {
    renderRoute('/library')
    expect(await screen.findByRole('button', { name: '打开《fixture-sample》' })).toBeInTheDocument()
    expect(screen.getByText('打开 Study')).toBeInTheDocument()
  })

  it('opens a Study route without AppShell and keeps source context visible', async () => {
    renderRoute('/study/fixture-study-preparation?from=library&material=fixture-id-001&sentence=fixture-id-004&return=%2Flibrary')
    expect(await screen.findByRole('heading', { name: /学习会话 fixture-study-preparation/ })).toBeInTheDocument()
    expect(screen.getByText('回到阅读器语境')).toBeInTheDocument()
    expect(screen.getAllByText('次は君の番です！').length).toBeGreaterThan(0)
  })

  it('resolves P3+ fixture provenance on default routes without requesting raw fixture IDs from Material API', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('real material API is unavailable in this route test')))
    vi.stubGlobal('fetch', fetchMock)

    renderDefaultRoute('/queue')
    expect(await screen.findByRole('heading', { name: '解析队列' })).toBeInTheDocument()
    expect(screen.getAllByText('次は君の番です！').length).toBeGreaterThan(0)
    cleanup()

    renderDefaultRoute('/study/fixture-study-discussion')
    expect(await screen.findByText('次は君の番です！')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    cleanup()
    renderDefaultRoute('/knowledge')
    expect(await screen.findByRole('heading', { name: '知识库' })).toBeInTheDocument()
    // Highlighted spans intentionally split the source sentence around the
    // selected occurrence; assert the composed source/brief surface instead
    // of relying on one contiguous text node.
    expect(screen.getByText(/直接称呼/)).toBeInTheDocument()

    cleanup()
    renderDefaultRoute('/center')
    expect(await screen.findByRole('heading', { name: '学习中心' })).toBeInTheDocument()
    expect(screen.getAllByText('等待新卡配额').length).toBeGreaterThan(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps Study reachable from an API-backed library when the API exposes the generated material fixture', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === '/materials') {
        return Promise.resolve(new Response(JSON.stringify([
          fixtureTextMaterial,
          fixtureSubtitleMaterial,
          fixtureEpubMaterial,
        ]), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      return Promise.reject(new Error(`unexpected API request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderDefaultRoute('/library')
    expect(await screen.findByText('打开 Study')).toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([input]) => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url))
      .toEqual(['/materials'])
  })

  it('keeps the Reader API boundary intact after composed material navigation', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === '/materials') {
        return Promise.resolve(new Response(JSON.stringify([fixtureTextMaterial, fixtureSubtitleMaterial, fixtureEpubMaterial]), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/sentences/fixture-id-004/tokens') {
        return Promise.resolve(new Response(JSON.stringify({
          ...fixtureSentenceTokens,
          sentence_id: 'fixture-id-004',
          material_id: 'fixture-id-001',
          sidecar_generation_id: 'fixture-id-002',
        }), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/sentences/fixture-id-008/tokens') {
        return Promise.resolve(new Response(JSON.stringify({
          ...fixtureSubtitleSentenceTokens,
          sentence_id: 'fixture-id-008',
          material_id: 'fixture-id-006',
          sidecar_generation_id: 'fixture-id-007',
        }), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      return Promise.reject(new Error(`unexpected API request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderDefaultRoute('/reader/fixture-ui-text-material?s=fixture-ui-text-sentence')
    expect((await screen.findAllByText('次は君の番です！')).length).toBeGreaterThan(0)
    expect(await screen.findByRole('button', { name: /君，读音 キミ/ })).toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([input]) => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url))
      .toContain('/sentences/fixture-id-004/tokens')

    cleanup()
    renderDefaultRoute('/reader/fixture-ui-subtitle-material?s=fixture-ui-subtitle-sentence')
    expect((await screen.findAllByText('また寄ってしまった。')).length).toBeGreaterThan(0)
    expect(await screen.findByRole('button', { name: /また，读音 マタ/ })).toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([input]) => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url))
      .toContain('/sentences/fixture-id-008/tokens')
  })
})
