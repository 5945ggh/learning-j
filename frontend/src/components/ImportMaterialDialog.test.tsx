/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { ImportMaterialDialog, type ImportMaterialDialogProps } from './ImportMaterialDialog'
import { MATERIAL_IMPORT_TYPE_DETAIL } from '@/lib/materials'
import { fixtureTextMaterial } from '@/lib/material-fixtures'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function txtFile(name = 'sample.txt'): File {
  return new File(['ファイルの中身'], name, { type: 'text/plain' })
}

/**
 * jsdom 与真实浏览器的差异：userEvent 默认按 input 的 accept 属性过滤上传文件
 * （setup 级配置 applyAccept，默认 true），过滤后选择没有变化时连 change 事件
 * 都不会派发；真实浏览器里 accept 只是文件选择器的过滤提示，用户仍可选
 * 「所有文件」绕过它，前端扩展名校验正是为这种输入兜底。因此拒绝路径必须用
 * applyAccept: false 模拟「绕过 accept 的文件选择」。
 */
function setupUserBypassingAccept(): UserEvent {
  return userEvent.setup({ applyAccept: false })
}

/** 与 screen 相同的装配方式：触发按钮打开对话框，用于焦点恢复与 Escape 契约。 */
function DialogHarness({
  onClose: onCloseProp,
  ...props
}: Omit<ImportMaterialDialogProps, 'onClose'> & { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>打开导入</button>
      {open ? (
        <ImportMaterialDialog
          {...props}
          onClose={() => {
            onCloseProp?.()
            setOpen(false)
          }}
        />
      ) : null}
    </>
  )
}

function renderDialog(overrides: Partial<ImportMaterialDialogProps> = {}) {
  const onImport = vi.fn().mockResolvedValue(fixtureTextMaterial)
  const onImported = vi.fn()
  const onClose = vi.fn()
  render(
    <ImportMaterialDialog
      onImport={overrides.onImport ?? onImport}
      onImported={overrides.onImported ?? onImported}
      onClose={overrides.onClose ?? onClose}
    />,
  )
  return { onImport, onImported, onClose }
}

describe('ImportMaterialDialog', () => {
  it('未选择文件时导入按钮禁用', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: '导入' })).toBeDisabled()
  })

  it('拒绝不受支持的扩展名，文案与后端 415 detail 一致，且不触发导入', async () => {
    const user = setupUserBypassingAccept()
    const { onImport } = renderDialog()
    const fileInput = screen.getByLabelText('文件')

    await user.upload(fileInput, txtFile('notes.doc'))
    expect(screen.getByRole('alert')).toHaveTextContent(MATERIAL_IMPORT_TYPE_DETAIL)
    expect(screen.getByRole('button', { name: '导入' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '导入' }))
    expect(onImport).not.toHaveBeenCalled()
  })

  it('拒绝后重新选择受支持文件会清空错误', async () => {
    const user = setupUserBypassingAccept()
    renderDialog()
    const fileInput = screen.getByLabelText('文件')

    await user.upload(fileInput, txtFile('notes.doc'))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.upload(fileInput, txtFile())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入' })).toBeEnabled()
  })

  it('选择受支持文件时默认标题取文件名去扩展名', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.upload(screen.getByLabelText('文件'), txtFile('私の笔记.srt'))
    expect(screen.getByLabelText('标题（可选）')).toHaveValue('私の笔记')
  })

  it('手动编辑过标题后更换文件不再覆盖', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.upload(screen.getByLabelText('文件'), txtFile('first.txt'))
    await user.clear(screen.getByLabelText('标题（可选）'))
    await user.type(screen.getByLabelText('标题（可选）'), '我的标题')
    await user.upload(screen.getByLabelText('文件'), txtFile('second.txt'))
    expect(screen.getByLabelText('标题（可选）')).toHaveValue('我的标题')
  })

  it('成功路径把草稿交给 onImport 并通知 onImported', async () => {
    const user = userEvent.setup()
    const { onImport, onImported } = renderDialog()
    const file = txtFile()

    await user.upload(screen.getByLabelText('文件'), file)
    await user.click(screen.getByRole('button', { name: '导入' }))

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(fixtureTextMaterial))
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(onImport.mock.calls[0]?.[0]).toMatchObject({ file, title: 'sample' })
  })

  it('失败展示后端 detail 并恢复可提交状态', async () => {
    const user = userEvent.setup()
    const failingImport = vi.fn().mockRejectedValue(new Error('字幕解析失败：无法读取文件内容'))
    renderDialog({ onImport: failingImport })

    await user.upload(screen.getByLabelText('文件'), txtFile('broken.srt'))
    await user.click(screen.getByRole('button', { name: '导入' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('字幕解析失败：无法读取文件内容')
    expect(screen.getByRole('button', { name: '导入' })).toBeEnabled()
  })

  it('提交中保持诚实的禁用/进行中状态，且 Escape 不触发关闭', async () => {
    const user = userEvent.setup()
    let releaseImport: (material: typeof fixtureTextMaterial) => void = () => {}
    const deferredImport = vi.fn().mockImplementation(
      () => new Promise<typeof fixtureTextMaterial>((resolve) => { releaseImport = resolve }),
    )
    const { onImported, onClose } = renderDialog({ onImport: deferredImport })

    await user.upload(screen.getByLabelText('文件'), txtFile())
    await user.click(screen.getByRole('button', { name: '导入' }))

    const submitting = await screen.findByRole('button', { name: '导入中…' })
    expect(submitting).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')

    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    releaseImport(fixtureTextMaterial)
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(fixtureTextMaterial))
    expect(screen.getByRole('button', { name: '导入' })).toBeEnabled()
  })

  it('Escape 关闭对话框并把焦点还给触发按钮（DESIGN.md 无障碍）', async () => {
    const user = userEvent.setup()
    const onImport = vi.fn().mockResolvedValue(fixtureTextMaterial)
    const onImported = vi.fn()
    const onClose = vi.fn()
    render(<DialogHarness onImport={onImport} onImported={onImported} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: '打开导入' }))
    expect(screen.getByRole('dialog')).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '打开导入' })).toHaveFocus()
  })

  it('取消按钮触发 onClose', async () => {
    const user = userEvent.setup()
    const { onClose } = renderDialog()

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
