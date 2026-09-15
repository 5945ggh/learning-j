/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { ReaderScreen } from './ReaderScreen'
import { RepositoryProvider, createFixtureRepositories } from '@/app/repository-context'
import { fixtureEpubMaterial } from '@/lib/material-fixtures'
import { fixtureCompositionIds } from '@/lib/fixture-composition'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

const publication = {
  material_id: fixtureEpubMaterial.id,
  title: fixtureEpubMaterial.title,
  publication_version: 'publication-v1',
  projection_version: 'learningj-epub-publication-v4',
  spine: [{ index: 0, label: '第一章' }],
}

function MoveToEpub() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => { void navigate(`/reader/${fixtureEpubMaterial.id}`) }}>切换 EPUB</button>
}

describe('ReaderScreen material changes', () => {
  it('clears a previous material error and kind before loading the next route material', async () => {
    const user = userEvent.setup()
    const fixtures = createFixtureRepositories()
    const materials = {
      ...fixtures.materials,
      getMaterial: vi.fn((id: string) => Promise.resolve(id === 'missing' ? null : fixtureEpubMaterial)),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(publication), { status: 200 })))
    window.history.replaceState(null, '', '/reader/missing')

    render(
      <RepositoryProvider repositories={{ ...fixtures, materials }}>
        <BrowserRouter>
          <MoveToEpub />
          <Routes><Route path="/reader/:materialId" element={<ReaderScreen />} /></Routes>
        </BrowserRouter>
      </RepositoryProvider>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('找不到这部材料')
    await user.click(screen.getByRole('button', { name: '切换 EPUB' }))
    expect(await screen.findByTitle(`${fixtureEpubMaterial.title}：第一章`)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps EPUB chapter chrome in ReaderShell without duplicating publication chrome', async () => {
    const repositories = createFixtureRepositories()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      material_id: fixtureCompositionIds.epubMaterial,
      title: fixtureEpubMaterial.title,
      publication_version: 'publication-v1',
      projection_version: 'learningj-epub-publication-v4',
      spine: [{ index: 0, label: '第一章' }, { index: 1, label: '第二章' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    window.history.replaceState(null, '', `/reader/${fixtureCompositionIds.epubMaterial}`)

    render(
      <RepositoryProvider repositories={repositories}>
        <BrowserRouter>
          <Routes><Route path="/reader/:materialId" element={<ReaderScreen />} /></Routes>
        </BrowserRouter>
      </RepositoryProvider>,
    )

    const frame = await screen.findByTitle(`${fixtureEpubMaterial.title}：第一章`)
    expect(frame).toBeInTheDocument()
    expect(screen.getByRole('banner', { name: '阅读工具栏' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一章' })).toBeEnabled()
    expect(screen.queryByRole('heading', { name: fixtureEpubMaterial.title })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: '材料会话' }))
    expect(screen.getByTitle(`${fixtureEpubMaterial.title}：第一章`)).toBe(frame)
  })

  it('resolves the route material and its active sessions exactly once for non-EPUB materials', async () => {
    const fixtures = createFixtureRepositories()
    const getMaterial = vi.spyOn(fixtures.materials, 'getMaterial')
    const listMaterials = vi.spyOn(fixtures.materials, 'listMaterials')
    const listSentences = vi.spyOn(fixtures.materials, 'listSentences')
    const listActiveSessions = vi.spyOn(fixtures.study, 'listActiveSessions')
    window.history.replaceState(null, '', `/reader/${fixtureCompositionIds.textMaterial}`)

    render(
      <RepositoryProvider repositories={fixtures}>
        <BrowserRouter>
          <Routes><Route path="/reader/:materialId" element={<ReaderScreen />} /></Routes>
        </BrowserRouter>
      </RepositoryProvider>,
    )

    // Sentences arriving proves the route material was adopted without re-listing.
    await screen.findAllByRole('button', { name: '选择句子' })
    expect(getMaterial).toHaveBeenCalledTimes(1)
    expect(listMaterials).toHaveBeenCalledTimes(0)
    expect(listActiveSessions).toHaveBeenCalledTimes(1)
    expect(listSentences).toHaveBeenCalledTimes(1)
  })
})
