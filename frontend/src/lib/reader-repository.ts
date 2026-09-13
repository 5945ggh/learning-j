import {
  fetchDictionaries,
  lookupDictionary,
  searchDictionary,
  type DictionaryLookupResult,
  type DictionarySearchResult,
  type DictionarySource,
} from '@/lib/dictionary'
import {
  fixtureDictionaries,
  fixtureEvidenceSummary,
  fixtureEvidenceSummaryUndecided,
  fixtureLookupResult,
  fixtureSearchResult,
  fixtureSentenceTokens,
  fixtureSubtitleSentenceTokens,
  fixtureAnnotations,
  fixtureDecision,
} from '@/lib/reader-fixtures'
import { fetchSentenceTokens } from '@/lib/tokens'
import {
  fetchEvidenceSummary,
  postLexemeDecision,
  DecisionConflictError,
  type EvidenceSummary,
  type LexemeDecisionRequest,
  type LexemeDecisionResult,
} from '@/lib/lexemes'
import type { SentenceTokens } from '@/lib/tokens'
import { fetchAnnotations, type Annotation, type AnnotationListOptions } from '@/lib/annotations'
import {
  cloneFixture,
  type RepositoryMetadata,
  type RepositoryRequestOptions,
  type RepositorySource,
  throwIfAborted,
} from '@/lib/repository-utils'

/** Options for the real dictionary clients, kept as a small reader contract. */
export type ReaderLookupOptions = {
  reading?: string | null
  signal?: AbortSignal
}

export type ReaderSearchOptions = RepositoryRequestOptions

/**
 * P2 reader boundary.  Every method maps to an existing P1/P2 client; the
 * interface does not expose future Study, extraction, or review operations.
 */
export interface ReaderRepository extends RepositoryMetadata {
  getSentenceTokens(sentenceId: string, options?: RepositoryRequestOptions): Promise<SentenceTokens>
  listDictionaries(options?: RepositoryRequestOptions): Promise<DictionarySource[]>
  lookupDictionary(expression: string, options?: ReaderLookupOptions): Promise<DictionaryLookupResult>
  searchDictionary(query: string, options?: ReaderSearchOptions): Promise<DictionarySearchResult>
  getEvidenceSummary(lexemeId: string, options?: RepositoryRequestOptions): Promise<EvidenceSummary>
  recordLexemeDecision(request: LexemeDecisionRequest): Promise<LexemeDecisionResult>
  listAnnotations(materialId: string, options?: AnnotationListOptions): Promise<Annotation[]>
}

/**
 * API adapter for the already shipped P1/P2 clients.  Keeping this wrapper
 * thin is deliberate: parsing, endpoint paths, error classes, and write
 * semantics stay owned by materials/dictionary/tokens/lexemes modules.
 */
export class ReaderApiAdapter implements ReaderRepository {
  readonly source = 'api' as const
  readonly unstable = false

  getSentenceTokens(sentenceId: string, options: RepositoryRequestOptions = {}): Promise<SentenceTokens> {
    return fetchSentenceTokens(sentenceId, options.signal)
  }

  listDictionaries(options: RepositoryRequestOptions = {}): Promise<DictionarySource[]> {
    return fetchDictionaries(options.signal)
  }

  lookupDictionary(expression: string, options: ReaderLookupOptions = {}): Promise<DictionaryLookupResult> {
    return lookupDictionary(expression, options)
  }

  searchDictionary(query: string, options: ReaderSearchOptions = {}): Promise<DictionarySearchResult> {
    return searchDictionary(query, options)
  }

  getEvidenceSummary(lexemeId: string, options: RepositoryRequestOptions = {}): Promise<EvidenceSummary> {
    return fetchEvidenceSummary(lexemeId, options.signal)
  }

  recordLexemeDecision(request: LexemeDecisionRequest): Promise<LexemeDecisionResult> {
    return postLexemeDecision(request)
  }

  listAnnotations(materialId: string, options: AnnotationListOptions = {}): Promise<Annotation[]> {
    return fetchAnnotations(materialId, options)
  }
}

export type ReaderFixtureSeed = {
  sentenceTokens?: readonly SentenceTokens[]
  dictionaries?: readonly DictionarySource[]
  lookupResults?: readonly DictionaryLookupResult[]
  searchResults?: readonly DictionarySearchResult[]
  evidenceSummaries?: readonly EvidenceSummary[]
  decisions?: readonly LexemeDecisionResult[]
  annotations?: readonly Annotation[]
}

const defaultReaderFixtureSeed: Required<ReaderFixtureSeed> = {
  sentenceTokens: [fixtureSentenceTokens, fixtureSubtitleSentenceTokens],
  dictionaries: fixtureDictionaries,
  lookupResults: [fixtureLookupResult],
  searchResults: [fixtureSearchResult],
  evidenceSummaries: [fixtureEvidenceSummary, fixtureEvidenceSummaryUndecided],
  decisions: [fixtureDecision],
  annotations: fixtureAnnotations,
}

/**
 * Reader fixture adapter for UI/development screens.  It uses the formal P1/P2
 * reader fixtures and never imports demo/fixtures/tokenize.ts.  Decisions are
 * an intentionally local fixture projection; production screens must select
 * ReaderApiAdapter to persist a decision through the real endpoint.
 */
export class ReaderFixtureAdapter implements ReaderRepository {
  readonly source = 'fixture' as const
  readonly unstable = false
  private readonly seed: Required<ReaderFixtureSeed>
  private readonly summaries = new Map<string, EvidenceSummary>()
  private readonly decisions = new Map<string, LexemeDecisionResult>()
  private readonly operations = new Map<string, LexemeDecisionResult>()

  constructor(seed: ReaderFixtureSeed = {}) {
    this.seed = {
      sentenceTokens: Array.from(seed.sentenceTokens ?? defaultReaderFixtureSeed.sentenceTokens),
      dictionaries: Array.from(seed.dictionaries ?? defaultReaderFixtureSeed.dictionaries),
      lookupResults: Array.from(seed.lookupResults ?? defaultReaderFixtureSeed.lookupResults),
      searchResults: Array.from(seed.searchResults ?? defaultReaderFixtureSeed.searchResults),
      evidenceSummaries: Array.from(seed.evidenceSummaries ?? defaultReaderFixtureSeed.evidenceSummaries),
      decisions: Array.from(seed.decisions ?? defaultReaderFixtureSeed.decisions),
      annotations: Array.from(seed.annotations ?? defaultReaderFixtureSeed.annotations),
    }
    for (const summary of this.seed.evidenceSummaries) {
      this.summaries.set(summary.lexeme_id, cloneFixture(summary))
    }
    for (const decision of this.seed.decisions) {
      this.decisions.set(`${decision.lexeme_id}\u0000${decision.scope_form_key}`, cloneFixture(decision))
      this.operations.set(decision.operation_key, cloneFixture(decision))
    }
  }

  async getSentenceTokens(sentenceId: string, options: RepositoryRequestOptions = {}): Promise<SentenceTokens> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    const result = this.seed.sentenceTokens.find((tokens) => tokens.sentence_id === sentenceId)
    if (!result) throw new Error(`token 表不存在：${sentenceId}`)
    return cloneFixture(result)
  }

  async listDictionaries(options: RepositoryRequestOptions = {}): Promise<DictionarySource[]> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    return cloneFixture([...this.seed.dictionaries])
  }

  async lookupDictionary(expression: string, options: ReaderLookupOptions = {}): Promise<DictionaryLookupResult> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    const exact = this.seed.lookupResults.find((result) =>
      result.expression === expression &&
      (!options.reading || result.reading === options.reading || result.entries.some((entry) => entry.reading === options.reading)),
    )
    if (exact) return cloneFixture(exact)
    return { expression, reading: options.reading ?? null, entries: [] }
  }

  async searchDictionary(query: string, options: ReaderSearchOptions = {}): Promise<DictionarySearchResult> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    const result = this.seed.searchResults.find((item) => item.query === query)
    return result ? cloneFixture(result) : { query, entries: [] }
  }

  async getEvidenceSummary(lexemeId: string, options: RepositoryRequestOptions = {}): Promise<EvidenceSummary> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    const summary = this.summaries.get(lexemeId)
    if (summary) return cloneFixture(summary)
    // A missing scope is the same undecided shape used by the P2 fixture.  It
    // is a read projection, not a claim that an unknown backend lexeme exists.
    return { lexeme_id: lexemeId, projection_revision: 0, scopes: [] }
  }

  async listAnnotations(materialId: string, options: AnnotationListOptions = {}): Promise<Annotation[]> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    return cloneFixture(this.seed.annotations.filter((annotation) => annotation.material_id === materialId))
  }

  async recordLexemeDecision(request: LexemeDecisionRequest): Promise<LexemeDecisionResult> {
    await Promise.resolve()
    if (!Number.isInteger(request.expectedDecisionSeq) || request.expectedDecisionSeq < 0) {
      throw new Error('缺少必填版本令牌 expected_decision_seq；请先读取按词证据摘要后重试')
    }
    const replay = this.operations.get(request.operationKey)
    if (replay) {
      // Match the real endpoint's idempotency boundary: an operation key is
      // replayable only for the same lexeme/decision input. A reused key with
      // a different decision is a visible conflict, never a silent replay.
      if (replay.lexeme_id !== request.lexemeId || replay.decision !== request.decision) {
        throw new DecisionConflictError('operation_key 已用于不同的裁定输入', 409)
      }
      return { ...cloneFixture(replay), created: false }
    }

    const scopeKey = `${request.lexemeId}\u0000lexeme:`
    const summary = this.summaries.get(request.lexemeId)
    const currentScope = summary?.scopes.find((scope) => scope.scope_form_key === 'lexeme:')
    const currentSeq = currentScope?.current_decision_seq ?? 0
    if (currentSeq !== request.expectedDecisionSeq) {
      throw new DecisionConflictError('裁定序号已变更，请刷新后重试', 409)
    }

    const result: LexemeDecisionResult = {
      decision_id: `fixture-decision-${this.decisions.size + 1}`,
      lexeme_id: request.lexemeId,
      scope_form_key: 'lexeme:',
      decision: request.decision,
      decision_seq: currentSeq + 1,
      operation_key: request.operationKey,
      created_at: 'fixture-timestamp',
      created: true,
      evidence_id: request.decision === 'known' ? `fixture-evidence-${this.decisions.size + 1}` : null,
      conjugated_form: request.conjugatedForm ?? null,
    }
    this.operations.set(request.operationKey, cloneFixture(result))
    this.decisions.set(scopeKey, cloneFixture(result))
    this.summaries.set(request.lexemeId, {
      lexeme_id: request.lexemeId,
      projection_revision: (summary?.projection_revision ?? 0) + 1,
      scopes: [{
        scope_form_key: 'lexeme:',
        current_decision: result.decision,
        current_decision_id: result.decision_id,
        current_decision_seq: result.decision_seq,
        valid_source_counts: request.decision === 'known' ? { user_asserted: 1 } : {},
        known_rule_version: 'learningj-known-rule-v1',
        resolver_version: 'learningj-scope-resolver-v1',
        input_revision: result.decision_seq,
      }],
    })
    return cloneFixture(result)
  }
}

export function createReaderApiAdapter(): ReaderRepository {
  return new ReaderApiAdapter()
}

export function createReaderFixtureAdapter(seed?: ReaderFixtureSeed): ReaderRepository {
  return new ReaderFixtureAdapter(seed)
}

/** Select the real P2 endpoints by default; fixture selection is explicit. */
export function createReaderRepository(
  source: RepositorySource = 'api',
  seed?: ReaderFixtureSeed,
): ReaderRepository {
  return source === 'api' ? new ReaderApiAdapter() : new ReaderFixtureAdapter(seed)
}
