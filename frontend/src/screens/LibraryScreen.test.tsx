/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { LibraryScreen } from './LibraryScreen'
import { RepositoryProvider, createDefaultRepositories, createFixtureRepositories } from '@/app/repository-context'
import { fixtureCompositionIds } from '@/lib/fixture-composition'
import { fixtureEpubMaterial, fixtureSubtitleMaterial, fixtureTextMaterial } from '@/lib/material-fixtures'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const importedMaterial = {
  ...fixtureTextMaterial,
  id: 'fixture-id-010',
  title: 'second-sample',
  locator: 'second-sample.txt',
  current_sidecar_id: null,
  sentence_count: 0,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function requestedUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([input]) => (typeof input === 'string' ? input : '/materials'))
}

function renderLibrary() {
  return render(
    <RepositoryProvider repositories={createDefaultRepositories()}>
      <MemoryRouter initialEntries={['/library']}>
        <LibraryScreen />
      </MemoryRouter>
    </RepositoryProvider>,
  )
}

function LocationText() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

describe('LibraryScreen import entry', () => {
  it('opens the Reader directly from the primary book card action', async () => {
    const user = userEvent.setup()
    const repositories = createFixtureRepositories()

    render(
      <RepositoryProvider repositories={repositories}>
        <MemoryRouter initialEntries={['/library']}>
          <Routes>
            <Route path="/library" element={<><LibraryScreen /><LocationText /></>} />
            <Route path="/reader/:materialId" element={<LocationText />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    )
    await user.click(await screen.findByRole('button', { name: `打开《${fixtureTextMaterial.title}》` }))
    expect(screen.getByTestId('location')).toHaveTextContent(`/reader/${fixtureCompositionIds.textMaterial}`)
  })

  it('opens the material Study session from the card footer entry', async () => {
    const user = userEvent.setup()
    render(
      <RepositoryProvider repositories={createFixtureRepositories()}>
        <MemoryRouter initialEntries={['/library']}>
          <Routes>
            <Route path="/library" element={<><LibraryScreen /><LocationText /></>} />
            <Route path="/study/:sessionId" element={<LocationText />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>,
    )
    await user.click(await screen.findByRole('button', { name: /打开 Study/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/study/')
  })

  it('marks the session projection unavailable instead of reporting zero sessions', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === '/materials') return Promise.resolve(jsonResponse([fixtureTextMaterial]))
      return Promise.reject(new Error(`unexpected API request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const repositories = createDefaultRepositories()
    const unavailable = {
      ...repositories,
      study: { ...repositories.study, listActiveSessions: () => Promise.reject(new Error('StudySession API unavailable')) },
    }

    render(
      <RepositoryProvider repositories={unavailable}>
        <MemoryRouter initialEntries={['/library']}>
          <LibraryScreen />
        </MemoryRouter>
      </RepositoryProvider>,
    )

    expect(await screen.findByText('会话状态不可用')).toBeInTheDocument()
    expect(screen.queryByText('暂无活动会话')).not.toBeInTheDocument()
    expect(screen.queryByText(/解析队列/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /打开 Study/ })).not.toBeInTheDocument()
  })

  it('passes the managed EPUB cover endpoint to the material card', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === '/materials') return Promise.resolve(jsonResponse([fixtureEpubMaterial]))
      return Promise.reject(new Error(`unexpected API request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderLibrary()

    expect(await screen.findByRole('presentation')).toHaveAttribute(
      'src',
      '/materials/fixture-ui-epub-material/publication/cover',
    )
  })

  it('打开导入对话框，成功后关闭并刷新素材列表', async () => {
    const user = userEvent.setup()
    let materialCalls = 0
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== '/materials') return Promise.reject(new Error(`unexpected API request: ${url}`))
      materialCalls += 1
      if (materialCalls === 1) return Promise.resolve(jsonResponse([fixtureTextMaterial]))
      if (materialCalls === 2) return Promise.resolve(jsonResponse(importedMaterial, 201))
      return Promise.resolve(jsonResponse([fixtureTextMaterial, importedMaterial]))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderLibrary()
    expect(await screen.findByRole('button', { name: '打开《fixture-sample》' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '导入素材' }))
    const dialog = screen.getByRole('dialog', { name: '导入素材' })
    expect(dialog).toBeInTheDocument()

    await user.upload(screen.getByLabelText('文件'), new File(['内容'], 'second-sample.txt', { type: 'text/plain' }))
    expect(screen.getByLabelText('标题（可选）')).toHaveValue('second-sample')
    await user.click(screen.getByRole('button', { name: '导入' }))

    expect(await screen.findByRole('button', { name: '打开《second-sample》' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual(['/materials', '/materials', '/materials'])
  })

  it('导入失败时对话框保留并展示后端 detail', async () => {
    const user = userEvent.setup()
    const failureDetail = '字幕解析失败：无法读取文件内容'
    let materialCalls = 0
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== '/materials') return Promise.reject(new Error(`unexpected API request: ${url}`))
      materialCalls += 1
      if (materialCalls === 1) return Promise.resolve(jsonResponse([fixtureTextMaterial]))
      return Promise.resolve(jsonResponse({ detail: failureDetail }, 422))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderLibrary()
    expect(await screen.findByRole('button', { name: '打开《fixture-sample》' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '导入素材' }))
    await user.upload(screen.getByLabelText('文件'), new File(['内容'], 'broken.srt', { type: 'application/x-subrip' }))
    await user.click(screen.getByRole('button', { name: '导入' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(failureDetail)
    expect(screen.getByRole('dialog', { name: '导入素材' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入' })).toBeEnabled()
    // 失败后留在对话框语境：只有初次列表 GET 与导入 POST，没有列表刷新。
    expect(requestedUrls(fetchMock)).toEqual(['/materials', '/materials'])
  })
})

describe('LibraryScreen material states', () => {
  it('素材读取尚未返回时呈现 role=status 的加载状态', () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)

    renderLibrary()

    expect(screen.getByRole('status')).toHaveTextContent('正在加载素材…')
  })

  it('素材加载失败时给出 role=alert 与重试，重试会重新拉取素材', async () => {
    const user = userEvent.setup()
    let materialCalls = 0
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== '/materials') return Promise.reject(new Error(`unexpected API request: ${url}`))
      materialCalls += 1
      if (materialCalls === 1) return Promise.reject(new Error('素材加载失败（500）'))
      return Promise.resolve(jsonResponse([fixtureTextMaterial]))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderLibrary()
    expect(await screen.findByRole('alert')).toHaveTextContent('素材加载失败（500）')
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByRole('button', { name: '打开《fixture-sample》' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(materialCalls).toBe(2)
  })

  it('空素材库与当前模式无素材分别给出对应空状态文案', async () => {
    const emptyLibrary = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== '/materials') return Promise.reject(new Error(`unexpected API request: ${url}`))
      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', emptyLibrary)

    const first = renderLibrary()
    expect(await screen.findByText('还没有素材。导入 txt、srt、vtt 或 EPUB 后会显示在这里。')).toBeInTheDocument()
    first.unmount()

    const subtitleOnly = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== '/materials') return Promise.reject(new Error(`unexpected API request: ${url}`))
      return Promise.resolve(jsonResponse([fixtureSubtitleMaterial]))
    })
    vi.stubGlobal('fetch', subtitleOnly)

    renderLibrary()
    expect(await screen.findByText('书目里还没有文本或 EPUB 素材。')).toBeInTheDocument()
  })

  it('模式计数与切换后可见卡片数量一致', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== '/materials') return Promise.reject(new Error(`unexpected API request: ${url}`))
      return Promise.resolve(jsonResponse([fixtureTextMaterial, fixtureSubtitleMaterial, fixtureEpubMaterial]))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderLibrary()
    const books = await screen.findByRole('button', { name: '书目（2）' })
    expect(books).toHaveAttribute('aria-pressed', 'true')
    const audiovisual = screen.getByRole('button', { name: '视听（1）' })
    expect(audiovisual).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByRole('button', { name: /^打开《/ })).toHaveLength(2)

    await user.click(audiovisual)

    expect(screen.getByRole('button', { name: '视听（1）' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('button', { name: /^打开《/ })).toHaveLength(1)
  })
})
