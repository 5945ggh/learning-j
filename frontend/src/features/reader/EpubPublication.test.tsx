/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EpubPublication, useEpubPublicationController } from './EpubPublication'

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

/**
 * The production reader supplies the single chapter controller from
 * ReaderScreen/EpubReaderWorkspace; the test harness does the same so chapter
 * state and chapter availability have one owner.
 */
function Harness({ materialId }: { materialId: string }) {
  const controller = useEpubPublicationController(materialId)
  return (
    <div>
      <p data-testid="chapter-label">{controller.chapter?.label ?? ''}</p>
      <button type="button" disabled={!controller.canPrevious} onClick={controller.goPrevious}>上一章</button>
      <button type="button" disabled={!controller.canNext} onClick={controller.goNext}>下一章</button>
      <EpubPublication materialId={materialId} controller={controller} />
    </div>
  )
}

describe('EpubPublication', () => {
  it('loads the publication manifest and renders a same-origin, no-script chapter iframe', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(publication), { status: 200 }))
    vi.stubGlobal('fetch', request)
    render(<Harness materialId="material-1" />)

    const frame = await screen.findByTitle('受控测试书：第一章')
    expect(frame).toHaveAttribute('src', '/materials/material-1/publication/spine/0')
    expect(frame).toHaveAttribute('sandbox', 'allow-same-origin')
    expect(frame).not.toHaveAttribute('sandbox', expect.stringContaining('allow-scripts'))
    expect(screen.getByRole('button', { name: '上一章' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一章' })).toBeEnabled()
  })

  it('switches chapters through the controller without changing the controlled endpoint shape', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(publication), { status: 200 })))
    render(<Harness materialId="material-1" />)

    await screen.findByTitle('受控测试书：第一章')
    await user.click(screen.getByRole('button', { name: '下一章' }))
    expect(screen.getByTitle('受控测试书：第二章')).toHaveAttribute(
      'src',
      '/materials/material-1/publication/spine/1',
    )
    expect(screen.getByTestId('chapter-label')).toHaveTextContent('第二章')
  })

  it('shows a retryable error and does not pretend an unavailable publication is readable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'publication 不存在' }), { status: 404 })))
    render(<Harness materialId="missing" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('publication 不存在')
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })
})
