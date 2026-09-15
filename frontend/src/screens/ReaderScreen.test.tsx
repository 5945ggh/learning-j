/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { ReaderScreen } from './ReaderScreen'
import { RepositoryProvider, createFixtureRepositories } from '@/app/repository-context'
import { fixtureEpubMaterial } from '@/lib/material-fixtures'

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
})
