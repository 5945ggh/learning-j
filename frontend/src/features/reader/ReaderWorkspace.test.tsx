/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RepositoryProvider, createFixtureRepositories } from '@/app/repository-context'
import { fixtureCompositionIds } from '@/lib/fixture-composition'
import { fixtureDecision, fixtureEvidenceSummary } from '@/lib/reader-fixtures'
import { DecisionConflictError } from '@/lib/lexemes'
import type { EvidenceSummary, LexemeDecisionRequest, LexemeDecisionResult } from '@/lib/lexemes'
import type { Material } from '@/lib/materials'
import type { ReaderRepository } from '@/lib/reader-repository'
import type { StudySessionRecord } from '@/lib/study-repository'
import { ReaderWorkspace } from './ReaderWorkspace'
import type { MaterialSessionState } from './useMaterialReaderController'

const JUN_LEXEME = 'lx_da636c71bab3557686de138257d58e6dec4abbbfc2eaabfac6c70ca7eb5d5150'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.innerWidth = 1024
})

/** 记录 reader 边界上的每个请求，用于验证「只读浏览 + 显式写入」。 */
type ReaderCall =
  | { kind: 'tokens'; detail: string }
  | { kind: 'lookup'; detail: string }
  | { kind: 'dictionaries' }
  | { kind: 'summary'; detail: string }
  | { kind: 'decision'; request: LexemeDecisionRequest }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/**
 * reader 边界包装：记录调用，并在需要竞态控制时用 overrides 延迟/替换某个
 * 方法。所有未替换的方法仍委托给真实 fixture adapter。
 */
function wrappingReader(
  base: ReaderRepository,
  overrides: Partial<ReaderRepository> = {},
  calls: ReaderCall[] = [],
): ReaderRepository {
  const fallback = {
    getSentenceTokens: (id: string, options?: Parameters<ReaderRepository['getSentenceTokens']>[1]) => base.getSentenceTokens(id, options),
    listDictionaries: (options?: Parameters<ReaderRepository['listDictionaries']>[0]) => base.listDictionaries(options),
    lookupDictionary: (expression: string, options?: Parameters<ReaderRepository['lookupDictionary']>[1]) => base.lookupDictionary(expression, options),
    searchDictionary: (query: string, options?: Parameters<ReaderRepository['searchDictionary']>[1]) => base.searchDictionary(query, options),
    getEvidenceSummary: (lexemeId: string, options?: Parameters<ReaderRepository['getEvidenceSummary']>[1]) => base.getEvidenceSummary(lexemeId, options),
    recordLexemeDecision: (request: LexemeDecisionRequest) => base.recordLexemeDecision(request),
    listAnnotations: (materialId: string, options?: Parameters<ReaderRepository['listAnnotations']>[1]) => base.listAnnotations(materialId, options),
  }
  return {
    source: base.source,
    unstable: base.unstable,
    getSentenceTokens: (id, options) => { calls.push({ kind: 'tokens', detail: id }); return (overrides.getSentenceTokens ?? fallback.getSentenceTokens)(id, options) },
    listDictionaries: (options) => { calls.push({ kind: 'dictionaries' }); return (overrides.listDictionaries ?? fallback.listDictionaries)(options) },
    lookupDictionary: (expression, options) => { calls.push({ kind: 'lookup', detail: expression }); return (overrides.lookupDictionary ?? fallback.lookupDictionary)(expression, options) },
    searchDictionary: (query, options) => (overrides.searchDictionary ?? fallback.searchDictionary)(query, options),
    getEvidenceSummary: (lexemeId, options) => { calls.push({ kind: 'summary', detail: lexemeId }); return (overrides.getEvidenceSummary ?? fallback.getEvidenceSummary)(lexemeId, options) },
    recordLexemeDecision: (request) => { calls.push({ kind: 'decision', request }); return (overrides.recordLexemeDecision ?? fallback.recordLexemeDecision)(request) },
    listAnnotations: (materialId, options) => (overrides.listAnnotations ?? fallback.listAnnotations)(materialId, options),
  }
}

async function setup(options: {
  width?: number
  materialId?: string
  materialOverride?: (material: Material) => Material
  readerFactory?: (base: ReaderRepository, calls: ReaderCall[]) => ReaderRepository
  sessions?: StudySessionRecord[]
  sessionsState?: MaterialSessionState
} = {}) {
  window.innerWidth = options.width ?? 1024
  const repositories = createFixtureRepositories()
  const resolved = await repositories.materials.getMaterial(options.materialId ?? fixtureCompositionIds.textMaterial)
  if (!resolved) throw new Error('fixture text material missing')
  const material = options.materialOverride ? options.materialOverride(resolved) : resolved
  const calls: ReaderCall[] = []
  const reader = options.readerFactory ? options.readerFactory(repositories.reader, calls) : repositories.reader
  const view = render(
    <RepositoryProvider repositories={repositories}>
      <MemoryRouter>
        <ReaderWorkspace
          material={material}
          sessions={options.sessions ?? []}
          sessionsState={options.sessionsState ?? 'ready'}
          materialRepository={repositories.materials}
          readerRepository={reader}
        />
      </MemoryRouter>
    </RepositoryProvider>,
  )
  return { ...view, repositories, material, calls }
}

async function selectTokenSentence(user: ReturnType<typeof userEvent.setup>) {
  await user.click((await screen.findAllByRole('button', { name: '选择句子' }))[1]!)
  return screen.findByRole('button', { name: /君，读音 キミ/ })
}

describe('ReaderWorkspace RF-02 boundary', () => {
  it('keeps existing non-EPUB token lookup inside the shared dictionary slot', async () => {
    const user = userEvent.setup()
    await setup({ width: 1200 })

    const token = await selectTokenSentence(user)
    await user.click(token)
    expect(await screen.findByRole('complementary', { name: '查词' })).toHaveTextContent('you')
    expect(screen.getByRole('complementary', { name: '查词' })).toHaveTextContent('fixture-辞書')
  })

  it('keeps the previous lookup result when the dictionary slot is collapsed and re-expanded', async () => {
    const user = userEvent.setup()
    await setup({ width: 1200 })

    await user.click((await screen.findAllByRole('button', { name: '选择句子' }))[1]!)
    await user.click(await screen.findByRole('button', { name: /君，读音 キミ/ }))
    expect(await screen.findByRole('complementary', { name: '查词' })).toHaveTextContent('you')

    // 收起槽位：只隐藏查词界面，不清空已取回的查询结果。
    await user.click(screen.getByRole('button', { name: '查词' }))
    expect(screen.queryByRole('complementary', { name: '查词' })).not.toBeInTheDocument()

    // 重新展开：仍显示上一次的查询结果，而不是占位文案。
    await user.click(screen.getByRole('button', { name: '查词' }))
    const reopened = screen.getByRole('complementary', { name: '查词' })
    expect(reopened).toHaveTextContent('you')
    expect(reopened).not.toHaveTextContent('选择正文中的 token 后')
  })

  it('returns focus to the triggering token on Escape and does not steal focus when re-expanded', async () => {
    const user = userEvent.setup()
    await setup({ width: 1200 })

    await user.click((await screen.findAllByRole('button', { name: '选择句子' }))[1]!)
    const token = await screen.findByRole('button', { name: /君，读音 キミ/ })
    await user.click(token)
    expect(await screen.findByRole('complementary', { name: '查词' })).toHaveTextContent('you')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary', { name: '查词' })).not.toBeInTheDocument()
    expect(token).toHaveFocus()

    // 由 rail 重新展开：焦点留在 rail 按钮，不被面板抢走。
    const railButton = screen.getByRole('button', { name: '查词' })
    await user.click(railButton)
    expect(screen.getByRole('complementary', { name: '查词' })).toHaveTextContent('you')
    expect(railButton).toHaveFocus()
  })

  it('shows a truthful material session state and keeps the content surface mounted', async () => {
    await setup()
    expect(await screen.findByRole('button', { name: '材料会话' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '材料会话' })).toBeInTheDocument()
  })

  // CR 修复轮：rail 收起后再点同一个 token 重新打开，Escape 仍须把焦点还给该
  // token。记账语义是「最近一次打开该 surface 的元素」，不是「最近一次元素引用
  // 发生变化」——同一个 token 的 DOM 引用不变，旧实现会把 rail 按钮留在账上。
  it('returns focus to the token when the same token is reopened after a rail collapse', async () => {
    const user = userEvent.setup()
    await setup({ width: 1200 })

    const token = await selectTokenSentence(user)
    await user.click(token)
    expect(await screen.findByRole('complementary', { name: '查词' })).toHaveTextContent('you')

    // 用 rail 收起：此刻记账指向 rail 按钮。
    await user.click(screen.getByRole('button', { name: '查词' }))
    expect(screen.queryByRole('complementary', { name: '查词' })).not.toBeInTheDocument()

    // 再点同一个 token（元素引用不变）重新打开。
    await user.click(token)
    expect(await screen.findByRole('complementary', { name: '查词' })).toHaveTextContent('you')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary', { name: '查词' })).not.toBeInTheDocument()
    expect(token).toHaveFocus()
  })

  it('allows replacing a lookup token directly from the compact reader surface', async () => {
    const user = userEvent.setup()
    await setup({ width: 1024 })
    await user.click((await screen.findAllByRole('button', { name: '选择句子' }))[1]!)
    await user.click(await screen.findByRole('button', { name: /君，读音 キミ/ }))
    expect(await screen.findByRole('dialog', { name: '查词' })).toHaveTextContent('君')
    await user.click(screen.getByRole('button', { name: /次，读音 ツギ/ }))
    expect(screen.getByRole('dialog', { name: '查词' })).toHaveTextContent('次')
  })

  // 迁自 MaterialWorkspace.test.tsx：无 Sidecar 时正文可读、语言工具不可用，
  // 且不伪造 token（RF-02「Sidecar 与 reader-ready 状态」）。
  it('keeps text readable without a Sidecar while language tools stay unavailable and no tokens are faked', async () => {
    const user = userEvent.setup()
    await setup({ width: 1200, materialOverride: (material) => ({ ...material, current_sidecar_id: null }) })

    expect(await screen.findByText('𠮟られた。')).toBeInTheDocument()
    await user.click((await screen.findAllByRole('button', { name: '选择句子' }))[1]!)
    expect(await screen.findByText('这个句子还没有可交互的 token。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /君，读音/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '查词' }))
    expect(screen.getByRole('complementary', { name: '查词' })).toHaveTextContent('尚未发布内容索引')
    expect(screen.getByText(/正文可读，语言工具尚不可用/)).toBeInTheDocument()
  })

  // 迁自 MaterialWorkspace.test.tsx：切 token 在原面板内更新同一查词界面，
  // 并区分「无结果」与「无词典」。
  it('updates the same dictionary panel in place for the next token and reports no match', async () => {
    const user = userEvent.setup()
    await setup({ width: 1200 })

    await user.click((await screen.findAllByRole('button', { name: '选择句子' }))[1]!)
    await user.click(await screen.findByRole('button', { name: /君，读音 キミ/ }))
    const panel = await screen.findByRole('complementary', { name: '查词' })
    expect(panel).toHaveTextContent('you')

    await user.click(screen.getByRole('button', { name: /次，读音 ツギ/ }))
    expect(await screen.findByText(/词典中没有匹配的词条/)).toBeInTheDocument()
    const samePanel = screen.getByRole('complementary', { name: '查词' })
    expect(samePanel).toHaveTextContent('次')
    expect(samePanel).not.toHaveTextContent('you')
  })

  it('reports the import-dictionary state when no dictionary is available', async () => {
    const user = userEvent.setup()
    await setup({
      width: 1200,
      readerFactory: (base, calls) => wrappingReader(base, { listDictionaries: () => Promise.resolve([]) }, calls),
    })

    await user.click((await screen.findAllByRole('button', { name: '选择句子' }))[1]!)
    await user.click(await screen.findByRole('button', { name: /次，读音 ツギ/ }))
    expect(await screen.findByText(/还没有可用的词典/)).toBeInTheDocument()
  })

  // 迁自 MaterialWorkspace.test.tsx：查词/浏览是只读路径；只有显式点击才提交
  // 裁定，且请求携带 canonical 版本令牌与材料作用域。
  it('submits an explicit Lexeme decision with the version token and material scope, and never writes while browsing', async () => {
    const user = userEvent.setup()
    const harness = await setup({ width: 1200, readerFactory: (base, calls) => wrappingReader(base, {}, calls) })

    await user.click((await screen.findAllByRole('button', { name: '选择句子' }))[1]!)
    await user.click(await screen.findByRole('button', { name: /君，读音 キミ/ }))
    expect(await screen.findByText('这个我认识（当前判断）')).toBeInTheDocument()
    expect(harness.calls.filter((call) => call.kind === 'decision')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /^这个我认识/ }))
    await waitFor(() => expect(harness.calls.filter((call) => call.kind === 'decision')).toHaveLength(1))
    const submitted = harness.calls.find((call): call is Extract<ReaderCall, { kind: 'decision' }> => call.kind === 'decision')
    expect(submitted?.request).toMatchObject({
      lexemeId: JUN_LEXEME,
      decision: 'known',
      inputSurface: '君',
      expectedDecisionSeq: 1,
      materialId: fixtureCompositionIds.textMaterial,
    })
    expect(typeof submitted?.request.operationKey).toBe('string')
  })

  // 迁自 MaterialWorkspace.test.tsx：未裁定词元（摘要空 scopes）首次裁定以
  // expected_decision_seq=0 提交。
  it('submits an undecided lexeme with expected_decision_seq 0', async () => {
    const user = userEvent.setup()
    const harness = await setup({ width: 1200, readerFactory: (base, calls) => wrappingReader(base, {}, calls) })

    await user.click((await screen.findAllByRole('button', { name: '选择句子' }))[1]!)
    await user.click(await screen.findByRole('button', { name: /次，读音 ツギ/ }))
    expect(await screen.findByText('未裁定')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '这个我认识' }))
    await waitFor(() => expect(harness.calls.filter((call) => call.kind === 'decision')).toHaveLength(1))
    const submitted = harness.calls.find((call): call is Extract<ReaderCall, { kind: 'decision' }> => call.kind === 'decision')
    expect(submitted?.request.expectedDecisionSeq).toBe(0)
    expect(submitted?.request.decision).toBe('known')
  })

  // 迁自 MaterialWorkspace.test.tsx：409 冲突展示显式错误并自动刷新判断状态。
  it('surfaces a 409 conflict explicitly and refreshes the decision state', async () => {
    const user = userEvent.setup()
    await setup({
      width: 1200,
      readerFactory: (base, calls) => wrappingReader(base, {
        recordLexemeDecision: () => Promise.reject(new DecisionConflictError("作用域 'lexeme:' 的裁定序号已变更（expected=1, current=2）；请刷新后重试", 409)),
      }, calls),
    })

    await user.click((await screen.findAllByRole('button', { name: '选择句子' }))[1]!)
    await user.click(await screen.findByRole('button', { name: /君，读音 キミ/ }))
    await screen.findByText('这个我认识（当前判断）')
    await user.click(screen.getByRole('button', { name: /^这个我认识/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('裁定序号已变更')
    expect(screen.getByRole('alert')).toHaveTextContent('判断状态已自动刷新')
  })

  // 迁自 MaterialWorkspace.test.tsx：裁定完成晚于切换 token 时不写回新语境。
  it('drops a stale decision result when the token changes while submitting', async () => {
    const user = userEvent.setup()
    const decision = deferred<LexemeDecisionResult>()
    const harness = await setup({
      width: 1200,
      readerFactory: (base, calls) => wrappingReader(base, {
        getEvidenceSummary: (lexemeId) => Promise.resolve({ lexeme_id: lexemeId, projection_revision: 0, scopes: [] }),
        recordLexemeDecision: () => decision.promise,
      }, calls),
    })

    await user.click((await screen.findAllByRole('button', { name: '选择句子' }))[1]!)
    await user.click(await screen.findByRole('button', { name: /君，读音 キミ/ }))
    expect(await screen.findByText('未裁定')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '这个我认识' }))
    await waitFor(() => expect(harness.calls.filter((call) => call.kind === 'decision')).toHaveLength(1))

    // POST 挂起期间切换 token：旧裁定响应不允许写回新语境。
    await user.click(screen.getByRole('button', { name: /次，读音 ツギ/ }))
    expect(await screen.findByText(/词典中没有匹配的词条/)).toBeInTheDocument()
    await act(async () => { decision.resolve(fixtureDecision); await Promise.resolve() })

    expect(screen.queryByText('这个我认识（当前判断）')).not.toBeInTheDocument()
    expect(screen.getByText('未裁定')).toBeInTheDocument()
    expect(harness.calls.filter((call) => call.kind === 'decision')).toHaveLength(1)
  })

  // 迁自 MaterialWorkspace.test.tsx：关闭后重开同一 token 时丢弃迟到的旧裁定。
  it('drops a late decision result when the same token is closed and reopened', async () => {
    const user = userEvent.setup()
    const decision = deferred<LexemeDecisionResult>()
    await setup({
      width: 1200,
      readerFactory: (base, calls) => wrappingReader(base, {
        getEvidenceSummary: (lexemeId) => Promise.resolve({ lexeme_id: lexemeId, projection_revision: 0, scopes: [] }),
        recordLexemeDecision: () => decision.promise,
      }, calls),
    })

    const token = await selectTokenSentence(user)
    await user.click(token)
    expect(await screen.findByText('未裁定')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '这个我认识' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary', { name: '查词' })).not.toBeInTheDocument()

    // 重开同一 token；旧 POST 仍挂起，新面板保持当前摘要。
    await user.click(token)
    expect(await screen.findByText('you')).toBeInTheDocument()
    await act(async () => { decision.resolve(fixtureDecision); await Promise.resolve() })

    expect(screen.queryByText('这个我认识（当前判断）')).not.toBeInTheDocument()
    expect(screen.getByText('未裁定')).toBeInTheDocument()
  })

  // 迁自 MaterialWorkspace.test.tsx：摘要刷新迟到且重开同一 token 时不写回旧裁定。
  it('drops a late summary refresh when the same token is reopened', async () => {
    const user = userEvent.setup()
    const staleSummary = deferred<EvidenceSummary>()
    let summaryCalls = 0
    await setup({
      width: 1200,
      readerFactory: (base, calls) => wrappingReader(base, {
        getEvidenceSummary: (lexemeId) => {
          summaryCalls += 1
          if (summaryCalls === 2) return staleSummary.promise
          return Promise.resolve({ lexeme_id: lexemeId, projection_revision: 0, scopes: [] })
        },
        recordLexemeDecision: () => Promise.resolve(fixtureDecision),
      }, calls),
    })

    const token = await selectTokenSentence(user)
    await user.click(token)
    expect(await screen.findByText('未裁定')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '这个我认识' }))
    await waitFor(() => expect(summaryCalls).toBe(2))

    await user.keyboard('{Escape}')
    await user.click(token)
    expect(await screen.findByText('you')).toBeInTheDocument()
    expect(screen.getByText('未裁定')).toBeInTheDocument()

    // 旧摘要 GET 此时才返回；不能覆盖重开同一 token 的新摘要。
    await act(async () => { staleSummary.resolve(fixtureEvidenceSummary); await Promise.resolve() })
    expect(screen.queryByText('这个我认识（当前判断）')).not.toBeInTheDocument()
    expect(screen.getByText('未裁定')).toBeInTheDocument()
  })

  // 迁自 MaterialWorkspace.test.tsx：切换句子关闭查词语境并清空旧词元状态。
  it('clears the previous lookup scope when the selected sentence changes', async () => {
    const user = userEvent.setup()
    const harness = await setup({ width: 1200, readerFactory: (base, calls) => wrappingReader(base, {}, calls) })

    await user.click((await screen.findAllByRole('button', { name: '选择句子' }))[1]!)
    await user.click(await screen.findByRole('button', { name: /君，读音 キミ/ }))
    expect(await screen.findByRole('complementary', { name: '查词' })).toHaveTextContent('you')

    await user.click(screen.getAllByRole('button', { name: '选择句子' })[2]!)
    const panel = screen.getByRole('complementary', { name: '查词' })
    expect(panel).not.toHaveTextContent('you')
    expect(panel).toHaveTextContent('选择正文中的 token 后')
    expect(harness.calls.filter((call) => call.kind === 'decision')).toHaveLength(0)
  })

  // 迁自 MaterialWorkspace.test.tsx：切换素材清理旧材料的查词作用域与槽位状态
  // （路由切换在同一 workspace 实例下等价于 material prop 变更）。
  it('clears the previous material lookup scope when the route material changes', async () => {
    const user = userEvent.setup()
    const repositories = createFixtureRepositories()
    const textMaterial = await repositories.materials.getMaterial(fixtureCompositionIds.textMaterial)
    const subtitleMaterial = await repositories.materials.getMaterial(fixtureCompositionIds.subtitleMaterial)
    if (!textMaterial || !subtitleMaterial) throw new Error('fixture materials missing')

    const ui = (material: Material) => (
      <RepositoryProvider repositories={repositories}>
        <MemoryRouter>
          <ReaderWorkspace material={material} sessions={[]} sessionsState="ready" materialRepository={repositories.materials} readerRepository={repositories.reader} />
        </MemoryRouter>
      </RepositoryProvider>
    )
    window.innerWidth = 1200
    const view = render(ui(textMaterial))

    await user.click((await screen.findAllByRole('button', { name: '选择句子' }))[1]!)
    await user.click(await screen.findByRole('button', { name: /君，读音 キミ/ }))
    expect(await screen.findByRole('complementary', { name: '查词' })).toHaveTextContent('you')

    view.rerender(ui(subtitleMaterial))
    expect(await screen.findByText('また寄ってしまった。')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: '查词' })).not.toBeInTheDocument()
    expect(screen.queryByText('you')).not.toBeInTheDocument()
  })
})
