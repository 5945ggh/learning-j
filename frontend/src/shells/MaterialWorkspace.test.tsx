/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaterialWorkspace } from './MaterialWorkspace'
import {
  fixtureEpubMaterial,
  fixtureEpubSentences,
  fixtureLexemeCounts,
  fixtureSidecar,
  fixtureSubtitleMaterial,
  fixtureSubtitleSentences,
  fixtureTextMaterial,
  fixtureTextSentences,
} from '@/lib/material-fixtures'
import {
  fixtureDecision,
  fixtureDictionaries,
  fixtureEvidenceSummary,
  fixtureEvidenceSummaryUndecided,
  fixtureLookupResult,
  fixtureSentenceTokens,
} from '@/lib/reader-fixtures'

const subtitleSidecar = {
  material_id: 'fixture-id-006',
  sidecar_generation_id: 'fixture-id-007',
  content_hash: 'd4e8866e776f2c1011d7df72b7710f378af6b7f8cbcd5739f329bac56a819abb',
  segmenter_version: 'learningj-segmenter-v1',
  tokenizer_version: '0.6.11',
  analyzer_dict_version: '20260723',
  payload: { sentences: [] },
}

const subtitleCounts = {
  material_id: 'fixture-id-006',
  sidecar_generation_id: 'fixture-id-007',
  counts: [{ lexeme_id: 'lx_9ca0779be06cdd19bcb8577014b30bdcf35ed0aae61773d3f3e62641deaf0bac', token_count: 2 }],
}

const JUN_LEXEME = 'lx_da636c71bab3557686de138257d58e6dec4abbbfc2eaabfac6c70ca7eb5d5150'

/** fetch 首参统一成 URL 字符串（Request/URL 不走默认 toString）。 */
function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/** P2 阅读器/查词请求面允许访问的端点前缀（防旧 AI 端点与隐式写入）。 */
const ALLOWED_URL_PREFIXES = [
  '/materials',
  '/sentences/',
  '/dictionaries',
  '/lexemes/',
] as const

type StubOptions = {
  failMaterials?: boolean
  noDictionaries?: boolean
  failSearch?: boolean
}

function stubMaterialApi({ failMaterials = false, noDictionaries = false }: StubOptions = {}) {
  const calls: { method: string; url: string; init?: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ method: init?.method ?? 'GET', url, init })
    const response = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
    if (url === '/materials') {
      if (failMaterials) {
        return Promise.resolve(new Response(JSON.stringify({ detail: 'down' }), { status: 500 }))
      }
      return Promise.resolve(new Response(JSON.stringify([fixtureTextMaterial, fixtureSubtitleMaterial, fixtureEpubMaterial])))
    }
    const bodies: Record<string, unknown> = {
      '/materials/fixture-id-001/sentences': fixtureTextSentences,
      '/materials/fixture-id-006/sentences': fixtureSubtitleSentences,
      '/materials/local-fixture-epub-001/sentences': fixtureEpubSentences,
      '/materials/fixture-id-001/sidecar': fixtureSidecar,
      '/materials/fixture-id-006/sidecar': subtitleSidecar,
      '/materials/fixture-id-001/lexeme-counts': fixtureLexemeCounts,
      '/materials/fixture-id-006/lexeme-counts': subtitleCounts,
    }
    if (bodies[url] !== undefined) return response(bodies[url])
    const tokensMatch = url.match(/^\/sentences\/([^/?]+)\/tokens$/)
    if (tokensMatch) {
      return response({ ...fixtureSentenceTokens, sentence_id: tokensMatch[1] })
    }
    if (url === '/dictionaries') return response(noDictionaries ? [] : fixtureDictionaries)
    if (url.startsWith('/dictionaries/lookup')) {
      const expression = new URLSearchParams(url.split('?')[1] ?? '').get('expression') ?? ''
      return response(expression === '君' ? fixtureLookupResult : { expression, reading: null, entries: [] })
    }
    if (url.startsWith('/dictionaries/search')) {
      return response({ query: '', entries: [] })
    }
    const summaryMatch = url.match(/^\/lexemes\/([^/?]+)\/evidence-summary$/)
    if (summaryMatch) {
      return response(summaryMatch[1] === JUN_LEXEME ? fixtureEvidenceSummary : fixtureEvidenceSummaryUndecided)
    }
    if (url.startsWith('/lexemes/') && url.endsWith('/decisions')) {
      return response(fixtureDecision, 201)
    }
    throw new Error(`unexpected frontend request: ${url}`)
  }))
  return calls
}

function decisionCalls(calls: ReturnType<typeof stubMaterialApi>) {
  return calls.filter((call) => call.method === 'POST' && call.url.endsWith('/decisions'))
}

async function openLookupForJun(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('𠮟られた。')
  await user.click(screen.getAllByRole('button', { name: '选择句子' })[1]!)
  await screen.findByRole('button', { name: /君，读音 キミ/ })
  await user.click(screen.getByRole('button', { name: /君，读音 キミ/ }))
  // 查词面板（popover 形态，jsdom 视口 1024px）加载词典结果。
  await screen.findByText('you')
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MaterialWorkspace（素材浏览 shell）', () => {
  it('自动选中首个素材并装载句子与内容索引', async () => {
    stubMaterialApi()
    render(<MaterialWorkspace />)

    expect(await screen.findByText('𠮟られた。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '书目（2）' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('偏移 0–5')).toBeInTheDocument()
    const index = screen.getByRole('region', { name: '内容索引' })
    expect(index).toHaveTextContent('fixture-id-002')
    expect(index).toHaveTextContent('条目 15 条 · token 总计 16')
  })

  it('素材加载失败时给出错误与重试，重试成功后恢复浏览', async () => {
    const user = userEvent.setup()
    stubMaterialApi({ failMaterials: true })
    render(<MaterialWorkspace />)

    expect(await screen.findByRole('alert')).toHaveTextContent('素材加载失败（500）')
    stubMaterialApi()
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('𠮟られた。')).toBeInTheDocument()
  })

  it('切换到视听并选择素材后，句子与内容索引随之更新', async () => {
    const user = userEvent.setup()
    stubMaterialApi()
    render(<MaterialWorkspace />)

    await screen.findByText('𠮟られた。')
    await user.click(screen.getByRole('button', { name: '视听（1）' }))
    await user.click(screen.getByRole('button', { name: /fixture-sample/ }))

    expect(await screen.findByText('また寄ってしまった。')).toBeInTheDocument()
    expect(screen.getByText('cue 0 · 00:01.000–00:04.200')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '内容索引' })).toHaveTextContent('fixture-id-007')
  })

  it('选中句子展示来源语境，不触发任何学习或播放语义', async () => {
    const user = userEvent.setup()
    stubMaterialApi()
    render(<MaterialWorkspace />)

    await screen.findByText('𠮟られた。')
    await user.click(screen.getAllByRole('button', { name: '选择句子' })[0]!)
    expect(await screen.findByRole('heading', { name: '𠮟られた。' })).toBeInTheDocument()
    expect(screen.getByText('来源定位：偏移 0–5')).toBeInTheDocument()
    expect(screen.queryByText(/开始 AI 学习|加入 AI 学习|查词/)).not.toBeInTheDocument()
  })

  it('没有 sidecar 的素材展示内容索引缺席状态', async () => {
    const user = userEvent.setup()
    stubMaterialApi()
    render(<MaterialWorkspace />)

    await screen.findByText('𠮟られた。')
    // EPUB 素材（local-fixture-epub-001）的 current_sidecar_id 为 null。
    await user.click(screen.getByRole('button', { name: /ローカル fixture 作品/ }))

    expect(await screen.findByText(/尚未生成内容索引/)).toBeInTheDocument()
  })
})

describe('MaterialWorkspace（P2 算法阅读器与查词装配）', () => {
  it('选中句子后装载 token 表并渲染可点击 token', async () => {
    const user = userEvent.setup()
    stubMaterialApi()
    render(<MaterialWorkspace />)

    await screen.findByText('𠮟られた。')
    await user.click(screen.getAllByRole('button', { name: '选择句子' })[1]!)
    expect(await screen.findByRole('button', { name: /次，读音 ツギ/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /！，读音 !/ })).toBeInTheDocument()
  })

  it('token 点击打开查词面板：词条、来源/版本 provenance 与当前判断可见', async () => {
    const user = userEvent.setup()
    const calls = stubMaterialApi()
    render(<MaterialWorkspace />)

    await openLookupForJun(user)
    const dialog = screen.getByRole('dialog', { name: '查词' })
    expect(dialog).toHaveAttribute('aria-modal', 'false')
    expect(dialog).toHaveTextContent('you')
    expect(dialog).toHaveTextContent('fixture-辞書 · 版本 2026-09-12')
    expect(dialog).toHaveTextContent('fixture-id-005')
    expect(dialog).toHaveTextContent('这个我认识（当前判断）')
    // 查词是只读路径：打开面板只有 GET（tokens/lookup/summary/dictionaries），无任何 POST。
    expect(decisionCalls(calls)).toHaveLength(0)
    // lookup 走规范化形候选。
    expect(calls.some((call) => call.url.includes('/dictionaries/lookup?') && decodeURIComponent(call.url).includes('expression=君'))).toBe(true)
  })

  it('token 键盘 Enter 同样打开查词面板', async () => {
    const user = userEvent.setup()
    stubMaterialApi()
    render(<MaterialWorkspace />)

    await screen.findByText('𠮟られた。')
    await user.click(screen.getAllByRole('button', { name: '选择句子' })[1]!)
    const jun = await screen.findByRole('button', { name: /君，读音 キミ/ })
    jun.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: '查词' })).toBeInTheDocument()
  })

  it('Escape 关闭查词面板并把焦点恢复到触发 token', async () => {
    const user = userEvent.setup()
    stubMaterialApi()
    render(<MaterialWorkspace />)

    await openLookupForJun(user)
    const dialog = screen.getByRole('dialog', { name: '查词' })
    await user.keyboard('{Escape}')
    expect(dialog).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /君，读音 キミ/ })).toHaveFocus()
  })

  it('选择另一个 token 在原面板内更新查词内容', async () => {
    const user = userEvent.setup()
    stubMaterialApi()
    render(<MaterialWorkspace />)

    await openLookupForJun(user)
    await user.click(screen.getByRole('button', { name: /次，读音 ツギ/ }))
    // 次 无词典命中且有已导入词典 → 无结果（而不是无词典）。
    expect(await screen.findByText(/词典中没有匹配的词条/)).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '查词' })).toBeInTheDocument()
  })

  it('无词典时展示需要导入状态；有词典但无结果时展示无结果状态', async () => {
    const user = userEvent.setup()
    stubMaterialApi({ noDictionaries: true })
    render(<MaterialWorkspace />)

    await screen.findByText('𠮟られた。')
    await user.click(screen.getAllByRole('button', { name: '选择句子' })[1]!)
    const tsugi = await screen.findByRole('button', { name: /次，读音 ツギ/ })
    await user.click(tsugi)
    expect(await screen.findByText(/还没有可用的词典/)).toBeInTheDocument()
  })

  it('显式点击「这个我认识」才提交裁定，请求携带 expected_decision_seq 版本令牌', async () => {
    const user = userEvent.setup()
    const calls = stubMaterialApi()
    render(<MaterialWorkspace />)

    await openLookupForJun(user)
    expect(decisionCalls(calls)).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: '这个我认识' }))
    const submitted = decisionCalls(calls)
    const first = submitted.at(0)
    if (!first) throw new Error('裁定请求未发出')
    expect(first.url).toBe(`/lexemes/${JUN_LEXEME}/decisions`)
    const body = JSON.parse(first.init?.body as string) as Record<string, unknown>
    expect(body).toMatchObject({
      decision: 'known',
      input_surface: '君',
      expected_decision_seq: 1,
      // Scope the explicit decision to the selected P1 material, not the
      // opaque material_id echoed by a separately generated reader fixture.
      material_id: 'fixture-id-001',
    })
    expect(typeof body.operation_key).toBe('string')
  })

  it('裁定 409 冲突时展示显式错误并自动刷新判断状态', async () => {
    const user = userEvent.setup()
    const calls = stubMaterialApi()
    render(<MaterialWorkspace />)

    await openLookupForJun(user)
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ method: init?.method ?? 'GET', url, init })
      if (init?.method === 'POST' && url.endsWith('/decisions')) {
        return Promise.resolve(new Response(JSON.stringify({
          detail: "作用域 'lexeme:' 的裁定序号已变更（expected=1, current=2）；请刷新后重试",
        }), { status: 409, headers: { 'content-type': 'application/json' } }))
      }
      return Promise.resolve(new Response(JSON.stringify(fixtureEvidenceSummary), { headers: { 'content-type': 'application/json' } }))
    }))
    await user.click(screen.getByRole('button', { name: '这个我认识' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('裁定序号已变更')
    expect(screen.getByRole('alert')).toHaveTextContent('判断状态已自动刷新')
  })

  it('请求面全程只落在允许的端点前缀，无旧 AI 端点与隐式 KE 写入', async () => {
    const user = userEvent.setup()
    const calls = stubMaterialApi()
    render(<MaterialWorkspace />)

    await openLookupForJun(user)
    await user.click(screen.getByRole('button', { name: '目前不认识' }))
    const submitted = decisionCalls(calls)
    expect(submitted).toHaveLength(1)
    expect((JSON.parse(submitted.at(0)?.init?.body as string) as Record<string, unknown>).decision).toBe('unknown')
    for (const call of calls) {
      expect(ALLOWED_URL_PREFIXES.some((prefix) => call.url.startsWith(prefix))).toBe(true)
      expect(call.url).not.toMatch(/\/analysis|\/questions|\/extract|\/retention|\/knowledge-points|\/study|\/review/)
    }
  })

  it('切换句子或素材时关闭查词面板并清空旧词元状态', async () => {
    const user = userEvent.setup()
    const calls = stubMaterialApi()
    render(<MaterialWorkspace />)

    await openLookupForJun(user)
    expect(screen.getByRole('dialog', { name: '查词' })).toBeInTheDocument()
    // 切换到第三句：面板关闭，旧词条与判断状态一并清空，无任何裁定写入。
    await user.click(screen.getAllByRole('button', { name: '选择句子' })[2]!)
    expect(await screen.findByRole('button', { name: /君，读音 キミ/ })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '查词' })).not.toBeInTheDocument()
    expect(screen.queryByText('you')).not.toBeInTheDocument()
    expect(screen.queryByText(/当前判断/)).not.toBeInTheDocument()
    expect(decisionCalls(calls)).toHaveLength(0)
    // 切换素材：同样保持关闭。
    await user.click(screen.getByRole('button', { name: '视听（1）' }))
    await user.click(screen.getByRole('button', { name: /fixture-sample/ }))
    expect(await screen.findByText('また寄ってしまった。')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '查词' })).not.toBeInTheDocument()
  })

  it('未裁定词元（摘要空 scopes）首次裁定以 expected_decision_seq=0 提交', async () => {
    const user = userEvent.setup()
    const calls = stubMaterialApi()
    render(<MaterialWorkspace />)

    await screen.findByText('𠮟られた。')
    await user.click(screen.getAllByRole('button', { name: '选择句子' })[1]!)
    const tsugi = await screen.findByRole('button', { name: /次，读音 ツギ/ })
    await user.click(tsugi)
    expect(await screen.findByText('未裁定')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '这个我认识' }))
    const submitted = decisionCalls(calls)
    expect(submitted).toHaveLength(1)
    const body = JSON.parse(submitted.at(0)?.init?.body as string) as Record<string, unknown>
    expect(body.expected_decision_seq).toBe(0)
    expect(body.decision).toBe('known')
  })

  it('裁定完成晚于切换 token 时不把旧词元状态写回新面板', async () => {
    const user = userEvent.setup()
    const calls = stubMaterialApi()
    render(<MaterialWorkspace />)

    await openLookupForJun(user)
    let resolvePost: ((response: Response) => void) | null = null
    const response = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = urlOf(input)
      calls.push({ method: init?.method ?? 'GET', url, init })
      if (init?.method === 'POST' && url.endsWith('/decisions')) {
        return new Promise((resolve) => {
          resolvePost = resolve
        })
      }
      if (url.startsWith('/sentences/') && url.endsWith('/tokens')) return response(fixtureSentenceTokens)
      if (url === '/dictionaries') return response(fixtureDictionaries)
      if (url.startsWith('/dictionaries/lookup')) return response({ expression: '君', reading: null, entries: [] })
      if (url.endsWith('/evidence-summary')) {
        const lexemeId = url.match(/^\/lexemes\/([^/?]+)\/evidence-summary$/)?.[1]
        return response(lexemeId === JUN_LEXEME ? fixtureEvidenceSummary : fixtureEvidenceSummaryUndecided)
      }
      throw new Error(`unexpected frontend request: ${url}`)
    }))
    await user.click(screen.getByRole('button', { name: '这个我认识' }))
    // POST 挂起期间切换 token：旧裁定响应不允许写回新语境。
    await user.click(screen.getByRole('button', { name: /次，读音 ツギ/ }))
    expect(await screen.findByText(/词典中没有匹配的词条/)).toBeInTheDocument()
    resolvePost!(new Response(JSON.stringify(fixtureDecision), { status: 201, headers: { 'content-type': 'application/json' } }))
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByText('这个我认识（当前判断）')).not.toBeInTheDocument()
    expect(screen.getByText('未裁定')).toBeInTheDocument()
    // 旧请求被丢弃后不产生额外裁定提交。
    expect(decisionCalls(calls)).toHaveLength(1)
  })

  it('关闭后重开同一 token 时也丢弃迟到的旧裁定响应', async () => {
    const user = userEvent.setup()
    const calls = stubMaterialApi()
    render(<MaterialWorkspace />)

    await openLookupForJun(user)
    let resolvePost: ((response: Response) => void) | null = null
    const response = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = urlOf(input)
      calls.push({ method: init?.method ?? 'GET', url, init })
      if (init?.method === 'POST' && url.endsWith('/decisions')) {
        return new Promise((resolve) => {
          resolvePost = resolve
        })
      }
      if (url.startsWith('/dictionaries/lookup')) return response(fixtureLookupResult)
      if (url.endsWith('/evidence-summary')) {
        return response({ ...fixtureEvidenceSummaryUndecided, lexeme_id: JUN_LEXEME })
      }
      throw new Error(`unexpected frontend request: ${url}`)
    }))

    await user.click(screen.getByRole('button', { name: '这个我认识' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '查词' })).not.toBeInTheDocument()

    // 重开同一 token；旧 POST 仍挂起，新的面板应保持当前摘要。
    await user.click(screen.getByRole('button', { name: /君，读音 キミ/ }))
    expect(await screen.findByText('you')).toBeInTheDocument()
    resolvePost!(new Response(JSON.stringify(fixtureDecision), { status: 201, headers: { 'content-type': 'application/json' } }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByText('这个我认识（当前判断）')).not.toBeInTheDocument()
    expect(screen.getByText('未裁定')).toBeInTheDocument()
  })

  it('摘要刷新迟到且重新打开同一 token 时也不写回旧裁定', async () => {
    const user = userEvent.setup()
    const calls = stubMaterialApi()
    render(<MaterialWorkspace />)

    await openLookupForJun(user)
    let resolveSummary: ((response: Response) => void) | null = null
    let summaryCalls = 0
    const response = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = urlOf(input)
      calls.push({ method: init?.method ?? 'GET', url, init })
      if (init?.method === 'POST' && url.endsWith('/decisions')) return response(fixtureDecision, 201)
      if (url.startsWith('/dictionaries/lookup')) return response(fixtureLookupResult)
      if (url.endsWith('/evidence-summary')) {
        summaryCalls += 1
        if (summaryCalls === 1) {
          return new Promise((resolve) => {
            resolveSummary = resolve
          })
        }
        return response({ ...fixtureEvidenceSummaryUndecided, lexeme_id: JUN_LEXEME })
      }
      throw new Error(`unexpected frontend request: ${url}`)
    }))

    await user.click(screen.getByRole('button', { name: '这个我认识' }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(summaryCalls).toBe(1)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /君，读音 キミ/ }))
    expect(await screen.findByText('you')).toBeInTheDocument()
    expect(screen.getByText('未裁定')).toBeInTheDocument()

    // 旧摘要 GET 此时才返回；不能覆盖重开的同一 token 的新摘要。
    resolveSummary!(new Response(JSON.stringify(fixtureEvidenceSummary), { status: 200, headers: { 'content-type': 'application/json' } }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByText('这个我认识（当前判断）')).not.toBeInTheDocument()
    expect(screen.getByText('未裁定')).toBeInTheDocument()
  })
})
