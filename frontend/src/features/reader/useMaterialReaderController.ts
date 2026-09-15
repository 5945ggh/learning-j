import { useCallback, useEffect, useRef, useState } from 'react'
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
import {
  type Material,
  type MaterialLexemeCounts,
  type Sentence,
  type Sidecar,
} from '@/lib/materials'
import type { MaterialRepository } from '@/lib/material-repository'
import type { ReaderRepository } from '@/lib/reader-repository'

export type MaterialReaderLoadStatus = 'loading' | 'error' | 'ready'

/** 材料会话读取面状态；由 ReaderScreen 持有，workspace 只消费。 */
export type MaterialSessionState = 'loading' | 'ready' | 'unavailable'

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

/** Lexeme 级作用域键（scope_form_key 的 Lexeme 级取值，data-model §2.2）。 */
const LEXEME_SCOPE_KEY = 'lexeme:'

/**
 * Shared non-EPUB reader controller for `ReaderWorkspace`. The route Material
 * resolved by the screen is the only material source: the controller never
 * lists materials again, so `MaterialApiAdapter.getMaterial`'s internal
 * `GET /materials` is not repeated a second time. Lookup/decision request
 * guards and selection lifecycle stay shell-independent.
 */
export function useMaterialReaderController({
  material,
  initialSentenceId,
  materialRepository,
  readerRepository,
}: {
  /** Route Material resolved by the screen; the only material source. */
  material: Material
  initialSentenceId?: string
  materialRepository: MaterialRepository
  readerRepository: ReaderRepository
}) {
  const [sentences, setSentences] = useState<Sentence[]>([])
  const [sentenceStatus, setSentenceStatus] = useState<MaterialReaderLoadStatus>('loading')
  const [sentenceError, setSentenceError] = useState<string | null>(null)
  const [sentenceAttempt, setSentenceAttempt] = useState(0)
  const [selectedSentence, setSelectedSentence] = useState<Sentence | null>(null)

  const [indexStatus, setIndexStatus] = useState<'loading' | 'absent' | 'error' | 'ready'>('loading')
  const [sidecar, setSidecar] = useState<Sidecar | null>(null)
  const [counts, setCounts] = useState<MaterialLexemeCounts | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [indexAttempt, setIndexAttempt] = useState(0)

  const [tokensStatus, setTokensStatus] = useState<MaterialReaderLoadStatus>('loading')
  const [tokensError, setTokensError] = useState<string | null>(null)
  const [sentenceTokens, setSentenceTokens] = useState<SentenceTokens | null>(null)
  const [tokensAttempt, setTokensAttempt] = useState(0)

  const [lookupOpen, setLookupOpen] = useState(false)
  const [lookupToken, setLookupToken] = useState<AlgorithmToken | null>(null)
  const [lookupTrigger, setLookupTrigger] = useState<HTMLElement | null>(null)
  const [lookupStatus, setLookupStatus] = useState<'loading' | 'no_dictionary' | 'no_result' | 'ready' | 'error'>('loading')
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
  const lookupLexemeIdRef = useRef<string | null>(null)
  const decisionRequestIdRef = useRef(0)
  // 每次「新的查词打开」递增（openLookup）。ReaderShell 用它作为触发元素
  // 记账的重放信号：同一个 token 再次打开时 DOM 引用不变，但这是一次新的
  // 打开，surface 的触发元素必须被重新覆盖（CR 修复轮）。
  const [lookupOpenSeq, setLookupOpenSeq] = useState(0)

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
    // 路由切换到新材料：清空旧材料的查词作用域。lookup 面板内容由
    // `workspace` 的槽位展开集合与当前 lookup 结果共同决定，这里只重置数据。
    resetLookup()
  }, [material, resetLookup])

  useEffect(() => {
    setSelectedSentence(null)
    const controller = new AbortController()
    setSentenceStatus('loading')
    setSentenceError(null)
    materialRepository.listSentences(material.id, { signal: controller.signal })
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
  }, [initialSentenceId, material.id, materialRepository, sentenceAttempt])

  useEffect(() => {
    if (material.current_sidecar_id === null) {
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
      materialRepository.getSidecar(material.id, { signal: controller.signal }),
      materialRepository.getLexemeCounts(material.id, { signal: controller.signal }),
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
  }, [indexAttempt, material, materialRepository])

  useEffect(() => {
    resetLookup()
    if (!selectedSentence || material.current_sidecar_id === null) {
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
  }, [material, readerRepository, resetLookup, selectedSentence, tokensAttempt])

  const openLookup = useCallback((token: AlgorithmToken, trigger: HTMLElement) => {
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
    setLookupOpenSeq((seq) => seq + 1)
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
          const candidates = [...new Set([lookupToken.normalized_form, lookupToken.surface].filter((form) => form.length > 0))]
          for (const candidate of candidates) {
            const result = await readerRepository.lookupDictionary(candidate, { signal: controller.signal })
            entries = result.entries
            if (entries.length > 0) break
          }
        }
        if (!isCurrent()) return
        if (entries.length === 0) {
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
  }, [lookupAttempt, lookupOpen, lookupSearchQuery, lookupToken, readerRepository])

  const closeLookup = useCallback(() => {
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
    const requestId = ++decisionRequestIdRef.current
    const isCurrent = () => decisionRequestIdRef.current === requestId && lookupLexemeIdRef.current === lexemeId
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
        materialId: material.id,
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
          // Keep the conflict visible; the user can retry from the same panel.
        }
      } else {
        setDecisionError(errorMessage(cause, '裁定提交失败'))
      }
    } finally {
      if (isCurrent()) setPendingDecision(null)
    }
  }, [applyDecisionSummary, decisionScope, decisionSummary, lookupToken, material.id, pendingDecision, readerRepository])

  return {
    sentences,
    sentenceStatus,
    sentenceError,
    selectedSentence,
    setSelectedSentence,
    indexStatus,
    sidecar,
    counts,
    indexError,
    tokensStatus,
    tokensError,
    sentenceTokens,
    lookupOpen,
    lookupToken,
    lookupTrigger,
    /** 单调递增的「新的一次查词打开」信号；供 shell 重放触发元素记账。 */
    lookupOpenSeq,
    lookupStatus,
    lookupEntries,
    lookupSearchQuery,
    lookupError,
    lookupFts,
    decisionSummary,
    decisionScope,
    decisionError,
    pendingDecision,
    openLookup,
    closeLookup,
    handleLookupSearch,
    retryLookup,
    dismissDecisionError,
    submitDecision,
    retrySentences: () => setSentenceAttempt((attempt) => attempt + 1),
    retryIndex: () => setIndexAttempt((attempt) => attempt + 1),
    retryTokens: () => setTokensAttempt((attempt) => attempt + 1),
  }
}
