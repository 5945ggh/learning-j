/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EpubPublication } from './EpubPublication'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const publication = {
  material_id: 'material-1',
  title: '受控测试书',
  publication_version: 'publication-v1',
  projection_version: 'learningj-epub-publication-v4',
  spine: [{ index: 0, label: '第一章' }, { index: 1, label: '第二章' }],
}

describe('EpubPublication', () => {
  it('loads the publication manifest and renders a same-origin, no-script chapter iframe', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(publication), { status: 200 }))
    vi.stubGlobal('fetch', request)
    render(<EpubPublication materialId="material-1" />)

    expect(await screen.findByRole('heading', { name: '受控测试书' })).toBeInTheDocument()
    const frame = screen.getByTitle('受控测试书：第一章')
    expect(frame).toHaveAttribute('src', '/materials/material-1/publication/spine/0')
    expect(frame).toHaveAttribute('sandbox', 'allow-same-origin')
    expect(frame).not.toHaveAttribute('sandbox', expect.stringContaining('allow-scripts'))
    expect(screen.getByRole('button', { name: '上一章' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一章' })).toBeEnabled()
  })

  it('switches chapters without changing the controlled endpoint shape', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(publication), { status: 200 })))
    render(<EpubPublication materialId="material-1" />)

    await screen.findByTitle('受控测试书：第一章')
    await user.click(screen.getByRole('button', { name: '下一章' }))
    expect(screen.getByTitle('受控测试书：第二章')).toHaveAttribute(
      'src',
      '/materials/material-1/publication/spine/1',
    )
    expect(screen.getByText('第二章 · 2 / 2')).toBeInTheDocument()
  })

  it('shows a retryable error and does not pretend an unavailable publication is readable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'publication 不存在' }), { status: 404 })))
    render(<EpubPublication materialId="missing" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('publication 不存在')
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })
})
