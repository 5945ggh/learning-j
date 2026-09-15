/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ReaderShell } from './ReaderShell'
import type { ReaderPanelSlot, ReaderTool } from './ReaderShell'

afterEach(() => {
  cleanup()
  window.innerWidth = 1024
})

/** One stable slot presented; used to check the responsive presentation only. */
function OneSlotHarness() {
  return (
    <ReaderShell
      materialTitle="fixture-sample"
      materialMeta="文本"
      expandedPanels={['dictionary']}
      activePanel="dictionary"
      onPanelToggle={() => {}}
      transientTool={null}
      onToolChange={() => {}}
      panelContent={{ dictionary: <div>panel body</div> }}
      onBack={() => {}}
      onHome={() => {}}
    >
      <p>reader body</p>
    </ReaderShell>
  )
}

function renderAt(width: number) {
  window.innerWidth = width
  render(<OneSlotHarness />)
}

describe('ReaderShell responsive panel ownership', () => {
  it('docks exactly one complementary panel at desktop width', () => {
    renderAt(1200)
    expect(screen.getAllByRole('complementary', { name: '查词' })).toHaveLength(1)
    expect(screen.getByRole('complementary', { name: '查词' })).toHaveTextContent('panel body')
    // 抽屉形态提供显式关闭控件（DESIGN.md 无障碍：抽屉用显式关闭）。
    expect(screen.getByRole('button', { name: '关闭面板' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '查词' })).not.toBeInTheDocument()
  })

  it('presents exactly one dialog panel at compact width without duplicating it', () => {
    renderAt(1024)
    expect(screen.getAllByRole('dialog', { name: '查词' })).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: '查词' })).toHaveTextContent('panel body')
    expect(screen.queryByRole('complementary', { name: '查词' })).not.toBeInTheDocument()
    expect(screen.getAllByText('panel body')).toHaveLength(1)
  })

  it('presents exactly one modal dialog panel at narrow width without duplicating it', () => {
    renderAt(600)
    expect(screen.getAllByRole('dialog', { name: '查词' })).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: '查词' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getAllByText('panel body')).toHaveLength(1)
  })

  it('renders no slot surface when nothing is expanded', () => {
    window.innerWidth = 1024
    render(
      <ReaderShell
        materialTitle="reader"
        materialMeta="文本"
        expandedPanels={[]}
        activePanel={null}
        onPanelToggle={() => {}}
        transientTool={null}
        onToolChange={() => {}}
        onBack={() => {}}
        onHome={() => {}}
      >
        <p>reader body</p>
      </ReaderShell>,
    )
    expect(screen.queryByRole('complementary', { name: '查词' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '查词' })).not.toBeInTheDocument()
  })
})

function NewShellHarness() {
  const [expanded, setExpanded] = useState<ReaderPanelSlot[]>([])
  const [active, setActive] = useState<ReaderPanelSlot | null>(null)
  const [tool, setTool] = useState<ReaderTool | null>(null)
  return (
    <ReaderShell
      materialTitle="reader"
      materialMeta="文本"
      expandedPanels={expanded}
      activePanel={active}
      onPanelToggle={(slot) => {
        setExpanded((current) => current.includes(slot) ? current.filter((item) => item !== slot) : [...current, slot])
        setActive((current) => current === slot ? null : slot)
      }}
      transientTool={tool}
      onToolChange={setTool}
      toolContent={<p>tool body</p>}
      panelContent={{ dictionary: <p>dictionary body</p>, 'sentence-actions': <p>sentence body</p>, 'material-sessions': <p>sessions body</p> }}
      onBack={() => {}}
      onHome={() => {}}
    >
      <p>reader body</p>
    </ReaderShell>
  )
}

describe('ReaderShell RF-02 stable slots and transient tools', () => {
  it('keeps stable slots independent and does not use tools as slots', async () => {
    const user = userEvent.setup()
    window.innerWidth = 1200
    render(<NewShellHarness />)
    await user.click(screen.getByRole('button', { name: '查词' }))
    await user.click(screen.getByRole('button', { name: '句子操作' }))
    expect(screen.getByRole('complementary', { name: '查词' })).toHaveTextContent('dictionary body')
    expect(screen.getByRole('complementary', { name: '句子操作' })).toHaveTextContent('sentence body')
    await user.click(screen.getByRole('button', { name: '查词' }))
    expect(screen.queryByRole('complementary', { name: '查词' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '目录' }))
    expect(screen.getByRole('dialog', { name: '目录' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '句子操作' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '目录' })).not.toBeInTheDocument()
  })

  it('uses a single narrow presentation while retaining the stable set', async () => {
    const user = userEvent.setup()
    window.innerWidth = 390
    render(<NewShellHarness />)
    await user.click(screen.getByRole('button', { name: '查词' }))
    expect(screen.getByRole('dialog', { name: '查词' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '句子操作' }))
    expect(screen.queryByRole('dialog', { name: '查词' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '句子操作' })).toBeInTheDocument()
  })

  it('does not clear a stable slot when a compact reader tool opens', async () => {
    const user = userEvent.setup()
    window.innerWidth = 1024
    render(<NewShellHarness />)
    await user.click(screen.getByRole('button', { name: '查词' }))
    await user.click(screen.getByRole('button', { name: '目录' }))
    expect(screen.getByRole('dialog', { name: '目录' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查词' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('treats the narrow sheet as a modal surface and restores focus to its trigger', async () => {
    const user = userEvent.setup()
    window.innerWidth = 390
    render(<NewShellHarness />)
    const trigger = screen.getByRole('button', { name: '查词' })
    await user.click(trigger)
    const sheet = screen.getByRole('dialog', { name: '查词' })
    expect(sheet).toHaveAttribute('aria-modal', 'true')
    // 模态焦点陷阱：Tab 从背景进入 sheet，而不是落到阅读器其余控件。
    await user.tab()
    expect(sheet).toContainElement(document.activeElement as HTMLElement)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '查词' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes the compact dictionary popover on an outside pointer down', async () => {
    const user = userEvent.setup()
    window.innerWidth = 1024
    render(<NewShellHarness />)
    await user.click(screen.getByRole('button', { name: '查词' }))
    const popover = screen.getByRole('dialog', { name: '查词' })
    // 紧凑布局的查词 popover 是非模态：无 aria-modal、点击外部关闭。
    expect(popover).toHaveAttribute('aria-modal', 'false')
    await user.click(popover)
    expect(screen.getByRole('dialog', { name: '查词' })).toBeInTheDocument()
    await user.click(document.body)
    expect(screen.queryByRole('dialog', { name: '查词' })).not.toBeInTheDocument()
  })

  it('keeps the narrow modal sheet open when its backdrop is pressed', async () => {
    const user = userEvent.setup()
    window.innerWidth = 390
    render(<NewShellHarness />)
    await user.click(screen.getByRole('button', { name: '查词' }))
    const backdrop = document.querySelector('[data-reader-stable-overlay]')
    expect(backdrop).toBeInTheDocument()
    // 模态：垫层阻断交互，点击不关闭；退出走 Escape／显式关闭。
    backdrop!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(screen.getByRole('dialog', { name: '查词' })).toBeInTheDocument()
  })
})
