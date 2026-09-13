/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'

afterEach(() => {
  cleanup()
  window.innerWidth = 1024
})

describe('AppShell narrow navigation', () => {
  it('keeps settings as an accessible bottom navigation entry below 760px', () => {
    window.innerWidth = 600
    render(
      <MemoryRouter>
        <AppShell><p>page content</p></AppShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('banner', { name: '主导航' })).toBeInTheDocument()
    const settingsNavigation = screen.getByRole('navigation', { name: '设置导航' })
    expect(within(settingsNavigation).getByRole('link', { name: '设置' })).toHaveAttribute('href', '/settings')
  })
})
