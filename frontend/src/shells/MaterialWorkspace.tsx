import { useCallback, useEffect, useRef, useState } from 'react'
import { ContentIndexPanel, type ContentIndexStatus } from '@/components/ContentIndexPanel'
import { LookupPanel, type LookupPanelStatus, type LookupVersionStamps } from '@/components/LookupPanel'
import { LookupSurface } from '@/components/LookupSurface'
import { TokenizedSentence, tokenKey } from '@/components/TokenizedSentence'
import { MaterialLibrary } from '@/components/MaterialLibrary'
import { SentenceList } from '@/components/SentenceList'
import { SentenceContext } from '@/components/SentenceContext'
import { libraryModeForKind, type LibraryMode } from '@/lib/library'
import {
  type Material,
  type MaterialLexemeCounts,
  type Sentence,
  type Sidecar,
} from '@/lib/materials'
import type { AlgorithmToken, SentenceTokens } from '@/lib/tokens'
import {
  DictionaryRequestError,
  type DictionaryEntry,
} from '@/lib/dictionary'
import {
  DecisionConflictError,
  type EvidenceSummary,
  type EvidenceSummaryScope,
  type LexemeDecisionValue,
} from '@/lib/lexemes'
import { createMaterialApiAdapter, type MaterialRepository } from '@/lib/material-repository'
import { createReaderApiAdapter, type ReaderRepository } from '@/lib/reader-repository'
import { useLookupVariant } from '@/lib/viewport'

type LoadStatus = 'loading' | 'error' | 'ready'

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

/** Lexeme 级作用域键（scope_form_key 的 Lexeme 级取值，data-model §2.2）。 */
const LEXEME_SCOPE_KEY = 'lexeme:'
const DEFAULT_MATERIAL_REPOSITORY = createMaterialApiAdapter()
const DEFAULT_READER_REPOSITORY = createReaderApiAdapter()

/**
 * 素材浏览/阅读 shell（P1 素材浏览 + P2 算法阅读器装配）。
 *
 * shell 持有页面状态并装配独立组件（ADR-023）：token 点击/键盘查词、
 * 响应式查词形态（宽屏右侧抽屉、紧凑 popover、移动底部面板）与显式
 * Lexeme 裁定由 shell 接线；组件本身不 import shell、不依赖路由。
 * 查词、阅读、播放都是只读路径——只有用户点击裁定控件才写入 Lexeme
 * 证据（不产生 KE 之外的任何写入，也不创建 KP/ReviewItem）。
 */
export function MaterialWorkspace({
  initialMaterialId,
  initialSentenceId,
  hideLibrary = false,
  materialRepository = DEFAULT_MATERIAL_REPOSITORY,
  readerRepository = DEFAULT_READER_REPOSITORY,
}: {
  initialMaterialId?: string
  /** Reader routes may preserve an exact source Sentence in the query. */
  initialSentenceId?: string
  /** Reader route can reuse the P2 reader area without nesting the library rail. */
  hideLibrary?: boolean
  materialRepository?: MaterialRepository
  readerRepository?: ReaderRepository
} = {}) {
  const [materials, setMaterials] = useState<Material[]>([])
  const [materialsStatus, setMaterialsStatus] = useState<LoadStatus>('loading')
  const [materialsError, setMaterialsError] = useState<string | null>(null)
  const [materialsAttempt, setMaterialsAttempt] = useState(0)

  const [selected, setSelected] = useState<Material | null>(null)
  const [mode, setMode] = useState<LibraryMode>('books')

  const [sentences, setSentences] = useState<Sentence[]>([])
  const [sentenceStatus, setSentenceStatus] = useState<LoadStatus>('loading')
  const [sentenceError, setSentenceError] = useState<string | null>(null)
  const [sentenceAttempt, setSentenceAttempt] = useState(0)
  const [selectedSentence, setSelectedSentence] = useState<Sentence | null>(null)

  const [indexStatus, setIndexStatus] = useState<ContentIndexStatus>('loading')
  const [sidecar, setSidecar] = useState<Sidecar | null>(null)
  const [counts, setCounts] = useState<MaterialLexemeCounts | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [indexAttempt, setIndexAttempt] = useState(0)

  const [tokensStatus, setTokensStatus] = useState<LoadStatus>('loading')
  const [tokensError, setTokensError] = useState<string | null>(null)
  const [sentenceTokens, setSentenceTokens] = useState<SentenceTokens | null>(null)
  const [tokensAttempt, setTokensAttempt] = useState(0)

  const lookupVariant = useLookupVariant()

  const [lookupOpen, setLookupOpen] = useState(false)
  const [lookupToken, setLookupToken] = useState<AlgorithmToken | null>(null)
  const [lookupTrigger, setLookupTrigger] = useState<HTMLElement | null>(null)
  const [lookupStatus, setLookupStatus] = useState<LookupPanelStatus>('loading')
  const [lookupEntries, setLookupEntries] = useState<DictionaryEntry[]>([])
  const [lookupSearchQuery, setLookupSearchQuery] = useState<string | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookupFts, setLookupFts] = useState(false)
  const [lookupAttempt, setLookupAttempt] = useState(0)

  const [decisionSummary, setDecisionSummary] = useState<EvidenceSummary | null>(null)
  const [decisionScope, setDecisionScope] = useState<EvidenceSummaryScope | null>(null)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [pendingDecision, setPendingDecision] = useState<LexemeDecisionValue | null>(null)

  const lookupRequestId = useRef(0)
  /** 当前查词目标的 lexeme 身份；裁定响应回来时用它丢弃已换词元的旧结果。 */
  const lookupLexemeIdRef = useRef<string | null>(null)
  const decisionRequestIdRef = useRef(0)

  /** 切换句子/素材或显式关闭时统一清理查词语境（面板与当前阅读语境绑定）。 */
  const resetLookup = useCallback(() => {
    lookupLexemeIdRef.current = null
    decisionRequestIdRef.current += 1
    setLookupOpen(false)
    setLookupToken(null)
    setLookupTrigger(null)
    setLookupStatus('loading')
    setLookupEntries([])
    setLookupSearchQuery(null)
    setLookupError(null)
    setLookupFts(false)
    setDecisionSummary(null)
    setDecisionScope(null)
    setDecisionError(null)
    setPendingDecision(null)
    setLookupAttempt((attempt) => attempt + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setMaterialsStatus('loading')
    setMaterialsError(null)
    materialRepository.listMaterials({ signal: controller.signal })
      .then((items) => {
        setMaterials(items)
        setSelected((current) => initialMaterialId
          ? items.find((item) => item.id === initialMaterialId) ?? null
          : current ?? items[0] ?? null)
        setMaterialsStatus('ready')
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return
        setMaterialsError(errorMessage(cause, '素材加载失败'))
        setMaterialsStatus('error')
      })
    return () => controller.abort()
  }, [initialMaterialId, materialRepository, materialsAttempt])

  useEffect(() => {
    if (!selected) {
      setSentences([])
      setSelectedSentence(null)
      setSentenceStatus('ready')
      setSentenceError(null)
      return
    }
    setSelectedSentence(null)
    const controller = new AbortController()
    setSentenceStatus('loading')
    setSentenceError(null)
    materialRepository.listSentences(selected.id, { signal: controller.signal })
      .then((items) => {
        setSentences(items)
        setSelectedSentence((current) => {
          if (initialSentenceId) return items.find((item) => item.id === initialSentenceId) ?? null
          return current
        })
        setSentenceStatus('ready')
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return
        setSentenceError(errorMessage(cause, '句子加载失败'))
        setSentenceStatus('error')
      })
    return () => controller.abort()
  }, [initialSentenceId, materialRepository, selected, sentenceAttempt])

  useEffect(() => {
    if (!selected || selected.current_sidecar_id === null) {
      setSidecar(null)
      setCounts(null)
      setIndexError(null)
      setIndexStatus('absent')
      return
    }
    const controller = new AbortController()
    setIndexStatus('loading')
    setIndexError(null)
    setSidecar(null)
    setCounts(null)
    Promise.all([
      materialRepository.getSidecar(selected.id, { signal: controller.signal }),
      materialRepository.getLexemeCounts(selected.id, { signal: controller.signal }),
    ])
      .then(([loadedSidecar, loadedCounts]) => {
        setSidecar(loadedSidecar)
        setCounts(loadedCounts)
        setIndexStatus('ready')
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return
        setIndexError(errorMessage(cause, '内容索引加载失败'))
        setIndexStatus('error')
      })
    return () => controller.abort()
  }, [indexAttempt, materialRepository, selected])

  useEffect(() => {
    // 查词面板与当前句子绑定：换句（含切素材导致的换句）即关闭并清空。
    resetLookup()
    if (!selectedSentence) {
      setSentenceTokens(null)
      setTokensError(null)
      setTokensStatus('ready')
      return
    }
    const controller = new AbortController()
    setTokensStatus('loading')
    setTokensError(null)
    setSentenceTokens(null)
    readerRepository.getSentenceTokens(selectedSentence.id, { signal: controller.signal })
      .then((tokens) => {
        setSentenceTokens(tokens)
        setTokensStatus('ready')
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return
        setTokensError(errorMessage(cause, 'token 表加载失败'))
        setTokensStatus('error')
      })
    return () => controller.abort()
  }, [readerRepository, resetLookup, selectedSentence, tokensAttempt])

  const openLookup = useCallback((token: AlgorithmToken, trigger: HTMLElement) => {
    // 每次重新打开都使旧裁定请求失效，即使重新打开的是同一 lexeme。
    // 否则“关闭→重开同一 token”会让迟到响应穿过 lexeme 身份守卫。
    decisionRequestIdRef.current += 1
    lookupLexemeIdRef.current = token.lexeme_id
    setLookupToken(token)
    setLookupTrigger(trigger)
    setLookupOpen(true)
    setLookupSearchQuery(null)
    setLookupEntries([])
    setLookupError(null)
    setLookupFts(false)
    setDecisionScope(null)
    setDecisionSummary(null)
    setDecisionError(null)
    setPendingDecision(null)
    setLookupStatus('loading')
    setLookupAttempt((attempt) => attempt + 1)
  }, [])

  useEffect(() => {
    if (!lookupOpen || !lookupToken) return
    const requestId = ++lookupRequestId.current
    const lexemeId = lookupToken.lexeme_id
    const controller = new AbortController()
    const isCurrent = () => lookupRequestId.current === requestId

    readerRepository.getEvidenceSummary(lexemeId, { signal: controller.signal })
      .then((summary) => {
        if (!isCurrent()) return
        setDecisionSummary(summary)
        setDecisionScope(summary.scopes.find((scope) => scope.scope_form_key === LEXEME_SCOPE_KEY) ?? null)
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause) || !isCurrent()) return
        setDecisionError(errorMessage(cause, '判断状态加载失败'))
      })

    const loadEntries = async () => {
      let entries: DictionaryEntry[] = []
      try {
        if (lookupSearchQuery) {
          const result = await readerRepository.searchDictionary(lookupSearchQuery, { signal: controller.signal })
          entries = result.entries
        } else {
          // 精确查找候选：先规范化形（词典形），无命中再试本次表层
          //（覆盖词典只收表层变体的导入）。
          const candidates = [...new Set([lookupToken.normalized_form, lookupToken.surface].filter((form) => form.length > 0))]
          for (const candidate of candidates) {
            const result = await readerRepository.lookupDictionary(candidate, { signal: controller.signal })
            entries = result.entries
            if (entries.length > 0) break
          }
        }
        if (!isCurrent()) return
        if (entries.length === 0) {
          // 无命中时区分「无词典」与「有词典但无结果」（DESIGN.md 交互状态）。
          const dictionaries = await readerRepository.listDictionaries({ signal: controller.signal })
          if (!isCurrent()) return
          setLookupStatus(dictionaries.length === 0 ? 'no_dictionary' : 'no_result')
          setLookupEntries([])
          return
        }
        setLookupEntries(entries)
        setLookupStatus('ready')
      } catch (cause: unknown) {
        if (isAbortError(cause) || !isCurrent()) return
        if (cause instanceof DictionaryRequestError && cause.kind === 'fts_unavailable') {
          setLookupFts(true)
          setLookupError(cause.message)
        } else {
          setLookupFts(false)
          setLookupError(errorMessage(cause, '查词失败'))
        }
        setLookupStatus('error')
      }
    }
    void loadEntries()
    return () => controller.abort()
    // lookupToken 参与依赖：换词元时在原面板内更新（DESIGN.md 工具栏与查词边界）。
  }, [lookupAttempt, lookupOpen, lookupSearchQuery, lookupToken, readerRepository])

  const closeLookup = useCallback(() => {
    // 关闭同样必须使在途裁定响应失效；保留 trigger 引用供 LookupSurface
    // 在 open=false 的 effect 中恢复焦点。
    decisionRequestIdRef.current += 1
    lookupLexemeIdRef.current = null
    setLookupOpen(false)
  }, [])

  const handleLookupSearch = useCallback((query: string) => {
    setLookupSearchQuery(query)
    setLookupAttempt((attempt) => attempt + 1)
  }, [])

  const retryLookup = useCallback(() => setLookupAttempt((attempt) => attempt + 1), [])

  const dismissDecisionError = useCallback(() => setDecisionError(null), [])

  /** 应用一次摘要响应；仅当仍对应当前查词词元时写入（丢弃换 token/切句后的旧结果）。 */
  const applyDecisionSummary = useCallback((lexemeId: string, summary: EvidenceSummary) => {
    if (lookupLexemeIdRef.current !== lexemeId) return
    setDecisionSummary(summary)
    setDecisionScope(summary.scopes.find((scope) => scope.scope_form_key === LEXEME_SCOPE_KEY) ?? null)
  }, [])

  const submitDecision = useCallback(async (decision: LexemeDecisionValue) => {
    const token = lookupToken
    if (!token || pendingDecision !== null) return
    if (!decisionSummary) {
      setDecisionError('判断状态尚未加载，请稍候重试。')
      return
    }
    const lexemeId = token.lexeme_id
    // 裁定请求代数 + 词元身份双重守卫：请求进行中换 token/切句时，
    // 旧响应不得写回新语境的面板（expected_decision_seq 必须属于当前词元）。
    const requestId = ++decisionRequestIdRef.current
    const isCurrent = () =>
      decisionRequestIdRef.current === requestId && lookupLexemeIdRef.current === lexemeId
    // expected_decision_seq 是必填版本令牌：无裁定历史（摘要无 lexeme 作用域行）时为 0。
    const expectedSeq = decisionScope?.current_decision_seq ?? 0
    setPendingDecision(decision)
    setDecisionError(null)
    const refreshSummaryIfCurrent = async () => {
      const summary = await readerRepository.getEvidenceSummary(lexemeId)
      if (!isCurrent()) return
      applyDecisionSummary(lexemeId, summary)
    }
    try {
      await readerRepository.recordLexemeDecision({
        lexemeId,
        decision,
        inputSurface: token.surface,
        expectedDecisionSeq: expectedSeq,
        operationKey: `lexeme-decision:${decision}:${lexemeId}:${expectedSeq}`,
        inputReading: token.reading_form || null,
        // The decision records the currently selected material scope. Token
        // provenance is an immutable response field and must not be treated
        // as the caller's material identity (fixture composition makes this
        // distinction observable).
        materialId: selected?.id ?? null,
      })
      if (!isCurrent()) return
      await refreshSummaryIfCurrent()
    } catch (cause: unknown) {
      if (!isCurrent()) return
      if (cause instanceof DecisionConflictError) {
        setDecisionError(`${cause.message} 判断状态已自动刷新，请重试。`)
        try {
          await refreshSummaryIfCurrent()
        } catch {
          // 冲突提示已展示；摘要刷新失败保留旧状态供用户重试。
        }
      } else {
        setDecisionError(errorMessage(cause, '裁定提交失败'))
      }
    } finally {
      if (isCurrent()) setPendingDecision(null)
    }
  }, [applyDecisionSummary, decisionScope, decisionSummary, lookupToken, pendingDecision, readerRepository, selected?.id])

  const selectMaterial = useCallback((material: Material) => {
    resetLookup()
    setSelected(material)
    setMode(libraryModeForKind(material.kind))
  }, [resetLookup])

  const retryMaterials = useCallback(() => setMaterialsAttempt((attempt) => attempt + 1), [])
  const retrySentences = useCallback(() => setSentenceAttempt((attempt) => attempt + 1), [])
  const retryIndex = useCallback(() => setIndexAttempt((attempt) => attempt + 1), [])
  const retryTokens = useCallback(() => setTokensAttempt((attempt) => attempt + 1), [])

  if (materialsStatus !== 'ready') {
    return (
      <div className="flex min-h-48 items-center justify-center px-6">
        {materialsStatus === 'loading' ? (
          <p role="status" className="text-sm text-muted-foreground">正在加载素材…</p>
        ) : (
          <div role="alert" className="w-full max-w-md rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p>{materialsError ?? '素材加载失败'}</p>
            <p className="mt-1 text-muted-foreground">素材浏览不依赖 BYOK；请确认本地后端已启动后重试。</p>
            <button
              type="button"
              onClick={retryMaterials}
              className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              重试
            </button>
          </div>
        )}
      </div>
    )
  }

  const versionStamps: LookupVersionStamps | null = sentenceTokens
    ? {
        sidecar_generation_id: sentenceTokens.sidecar_generation_id,
        segmenter_version: sentenceTokens.segmenter_version,
        tokenizer_version: sentenceTokens.tokenizer_version,
        analyzer_dict_version: sentenceTokens.analyzer_dict_version,
      }
    : null

  const searchPending = lookupStatus === 'loading' && lookupSearchQuery !== null

  const lookupPanel = (
    <LookupPanel
      status={lookupStatus}
      error={lookupError}
      ftsUnavailable={lookupFts}
      token={lookupToken}
      versionStamps={versionStamps}
      entries={lookupEntries}
      searchQuery={lookupSearchQuery}
      searchPending={searchPending}
      decisionScope={decisionScope}
      decisionSummaryLoaded={decisionSummary !== null}
      decisionError={decisionError}
      pendingDecision={pendingDecision}
      onDecide={(decision) => {
        void submitDecision(decision)
      }}
      onDismissDecisionError={dismissDecisionError}
      onSearch={handleLookupSearch}
      onRetry={retryLookup}
    />
  )

  const readerArea = selectedSentence ? (
    <div
      className={
        lookupOpen && lookupVariant === 'drawer'
          ? 'grid items-start gap-6 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]'
          : 'relative'
      }
    >
      <div className="min-w-0 space-y-6">
        <TokenizedSentence
          sentence={selectedSentence}
          tokens={sentenceTokens?.tokens ?? []}
          loading={tokensStatus === 'loading'}
          error={tokensError}
          selectedKey={lookupOpen && lookupToken && lookupSearchQuery === null ? tokenKey(lookupToken) : null}
          onTokenSelect={openLookup}
          onRetry={retryTokens}
        />
        <SentenceContext sentence={selectedSentence} />
      </div>
      {/* 关闭时保持 surface 挂载（返回 null），让 Escape 关闭能把焦点还给触发 token。 */}
      {lookupVariant === 'drawer' ? (
        <LookupSurface variant="drawer" open={lookupOpen} onClose={closeLookup} trigger={lookupTrigger}>
          {lookupPanel}
        </LookupSurface>
      ) : (
        <div className={lookupOpen ? 'pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-end' : undefined}>
          <div className={lookupOpen ? 'pointer-events-auto relative' : undefined}>
            <LookupSurface variant={lookupVariant} open={lookupOpen} onClose={closeLookup} trigger={lookupTrigger}>
              {lookupPanel}
            </LookupSurface>
          </div>
        </div>
      )}
    </div>
  ) : null

  return (
    <div className={hideLibrary ? 'space-y-6' : 'grid gap-6 lg:grid-cols-[minmax(240px,0.32fr)_minmax(0,1fr)]'}>
      {!hideLibrary && <aside className="rounded-md border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Library</h2>
        <MaterialLibrary
          status="ready"
          materials={materials}
          error={null}
          mode={mode}
          onModeChange={setMode}
          selectedId={selected?.id ?? null}
          onSelect={selectMaterial}
          onRetry={retryMaterials}
        />
      </aside>}
      <section className="min-w-0 space-y-6">
        {sentenceStatus === 'loading' ? (
          <div role="status" className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
            正在加载句子…
          </div>
        ) : sentenceStatus === 'error' ? (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p>{sentenceError ?? '句子加载失败'}</p>
            <button
              type="button"
              onClick={retrySentences}
              className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              重试
            </button>
          </div>
        ) : (
          <SentenceList
            material={selected}
            sentences={sentences}
            selectedId={selectedSentence?.id}
            onSelect={setSelectedSentence}
          />
        )}
        {readerArea}
        {selected ? (
          <ContentIndexPanel
            status={indexStatus}
            sidecar={sidecar}
            counts={counts}
            error={indexError}
            onRetry={retryIndex}
          />
        ) : null}
      </section>
    </div>
  )
}
