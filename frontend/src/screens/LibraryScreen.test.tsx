/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { LibraryScreen } from './LibraryScreen'
import { RepositoryProvider, createDefaultRepositories } from '@/app/repository-context'
import { fixtureEpubMaterial, fixtureTextMaterial } from '@/lib/material-fixtures'

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

describe('LibraryScreen import entry', () => {
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
