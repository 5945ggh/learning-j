/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LookupSurface } from './LookupSurface'

afterEach(() => cleanup())

function makeTrigger(): HTMLButtonElement {
  const button = document.createElement('button')
  button.textContent = '触发 token'
  document.body.appendChild(button)
  return button
}

function renderSurface(overrides: Partial<Parameters<typeof LookupSurface>[0]> = {}) {
  const trigger = overrides.trigger ?? makeTrigger()
  const props = {
    variant: 'popover' as const,
    open: true,
    onClose: vi.fn(),
    trigger,
    children: <p>面板内容</p>,
    ...overrides,
  }
  render(<LookupSurface {...props} />)
  return props
}

describe('LookupSurface（查词面板形态外壳）', () => {
  it('drawer 使用 complementary 语义并带显式关闭按钮', async () => {
    const user = userEvent.setup()
    const props = renderSurface({ variant: 'drawer' })
    const surface = screen.getByRole('complementary', { name: '查词' })
    expect(surface).toHaveAttribute('data-lookup-variant', 'drawer')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭查词' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('popover 使用 dialog 语义（非模态）并渲染内容', () => {
    renderSurface({ variant: 'popover' })
    const surface = screen.getByRole('dialog', { name: '查词' })
    expect(surface).toHaveAttribute('aria-modal', 'false')
    expect(surface).toHaveAttribute('data-lookup-variant', 'popover')
    expect(screen.getByText('面板内容')).toBeInTheDocument()
  })

  it('sheet 使用模态 dialog 语义并带显式关闭按钮', async () => {
    const user = userEvent.setup()
    const props = renderSurface({ variant: 'sheet' })
    expect(screen.getByRole('dialog', { name: '查词' })).toHaveAttribute('aria-modal', 'true')
    await user.click(screen.getByRole('button', { name: '关闭查词' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('sheet 是真实模态：背景垫层阻断交互、Tab/Shift+Tab 焦点在面板内循环', async () => {
    const user = userEvent.setup()
    const trigger = makeTrigger()
    const props = renderSurface({ trigger, variant: 'sheet', children: <button type="button">面板内按钮</button> })
    const backdrop = document.querySelector('[data-lookup-backdrop="sheet"]')
    expect(backdrop).toBeInTheDocument()
    const surface = screen.getByRole('dialog', { name: '查词' })
    expect(surface).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: '关闭查词' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: '面板内按钮' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: '关闭查词' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: '面板内按钮' })).toHaveFocus()
    // 点击垫层不关闭：退出走 Escape/显式关闭（DESIGN.md：抽屉/底部面板）。
    backdrop!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('popover 非模态：没有背景垫层', () => {
    renderSurface({ variant: 'popover' })
    expect(document.querySelector('[data-lookup-backdrop]')).toBeNull()
  })

  it('打开时面板接收焦点，Escape 关闭后焦点恢复到触发 token', async () => {
    const user = userEvent.setup()
    const trigger = makeTrigger()
    const props = renderSurface({ trigger })
    const surface = screen.getByRole('dialog', { name: '查词' })
    expect(surface).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(props.onClose).toHaveBeenCalledTimes(1)
    // 关闭后（保持挂载、open=false）焦点回到触发 token。
    render(<LookupSurface variant="popover" open={false} onClose={props.onClose} trigger={trigger}>{null}</LookupSurface>)
    expect(trigger).toHaveFocus()
  })

  it('点击外部关闭 popover，但不关闭抽屉/底部面板', () => {
    const popoverProps = renderSurface({ variant: 'popover' })
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(popoverProps.onClose).toHaveBeenCalledTimes(1)
    cleanup()

    for (const variant of ['drawer', 'sheet'] as const) {
      const props = renderSurface({ variant })
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      expect(props.onClose).not.toHaveBeenCalled()
      cleanup()
    }
  })

  it('点击面板内部或触发 token 不关闭 popover', () => {
    const trigger = makeTrigger()
    const props = renderSurface({ trigger })
    screen.getByRole('dialog', { name: '查词' }).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(props.onClose).not.toHaveBeenCalled()
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('open=false 时不渲染任何形态与垫层', () => {
    const trigger = makeTrigger()
    render(<LookupSurface variant="sheet" open={false} onClose={() => {}} trigger={trigger}>{null}</LookupSurface>)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.querySelector('[data-lookup-backdrop]')).toBeNull()
  })
})
