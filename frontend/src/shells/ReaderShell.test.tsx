/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ReaderShell } from './ReaderShell'

afterEach(() => {
  cleanup()
  window.innerWidth = 1024
})

function renderAt(width: number) {
  window.innerWidth = width
  return render(
    <ReaderShell
      materialTitle="fixture-sample"
      materialMeta="text · API"
      panel="outline"
      onPanelChange={() => {}}
      onBack={() => {}}
      onHome={() => {}}
      sidebar={<div>panel body</div>}
    >
      <p>reader body</p>
    </ReaderShell>,
  )
}

describe('ReaderShell responsive panel ownership', () => {
  it('docks one complementary panel at desktop width', () => {
    renderAt(1200)
    expect(screen.getByRole('complementary', { name: '目录' })).toHaveTextContent('panel body')
  })

  it('uses one right drawer at compact width', () => {
    renderAt(1024)
    expect(screen.getByRole('complementary', { name: '目录' })).toHaveTextContent('panel body')
  })

  it('uses one bottom sheet at narrow width', () => {
    renderAt(600)
    expect(screen.getByRole('complementary', { name: '目录' })).toHaveTextContent('panel body')
  })

  it('leaves lookup ownership to the material workspace', () => {
    renderAt(1024)
    expect(screen.queryByRole('button', { name: '查词' })).not.toBeInTheDocument()
  })
})
