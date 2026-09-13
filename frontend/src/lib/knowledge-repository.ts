import {
  cloneFixture,
  FixtureCapabilityError,
  type RepositoryMetadata,
  type RepositoryRequestOptions,
  throwIfAborted,
} from '@/lib/repository-utils'

export type KnowledgeAnchorShape = 'pattern' | 'lexical' | 'entity' | 'opaque'
export type KnowledgeRetention = 'srs' | 'reference'
export type OccurrenceRetentionOverride = 'inherit' | KnowledgeRetention
export type KnowledgeSalience = 'primary' | 'secondary'
export type KnowledgeContentSource = 'analysis_section' | 'user_gloss'

/**
 * Data-model §3.1 KnowledgePoint.  This is an intentionally small read
 * contract: all fields retained here are domain fields, not UI-only labels.
 */
export type KnowledgePointRecord = {
  kp_id: string
  anchor_shape: KnowledgeAnchorShape
  anchor_payload: Record<string, unknown>
  anchor: string
  pattern_grammar_version: string | null
  opaque_reason: 'model_chosen' | 'validation_failed' | null
  display_form: string | null
  tags: string[]
  default_retention: KnowledgeRetention
  canonical_id: string | null
  lexical_anchors: string[]
  origin: 'extraction' | 'manual'
}

/** Data-model §3.3 Occurrence with its immutable source/version references. */
export type KnowledgeOccurrenceRecord = {
  occurrence_id: string
  kp_id: string
  sentence_id: string
  material_id: string
  /** Persisted Span spelling: Unicode code-point half-open offsets. */
  spans: Array<{ char_start: number; char_end: number }>
  slot_bindings: Record<string, string>
  salience: KnowledgeSalience
  retention_override: OccurrenceRetentionOverride
  brief: string
  content_source: KnowledgeContentSource
  section_id: string
  section_revision: number
  source_analysis_id: string
  extraction_run_id: string
  extractor_model: string
  extractor_prompt_version: string
  user_marked_useful: boolean | null
}

export type KnowledgeAggregate = {
  knowledge_point: KnowledgePointRecord
  occurrences: KnowledgeOccurrenceRecord[]
}

export type KnowledgeFilter = {
  material_id?: string
  kp_id?: string
}

/**
 * P4/P5 read boundary.  No current backend endpoint provides KP aggregates,
 * so this contract is unstable and fixture-only until those phases publish an
 * API.  It does not expose mutation methods that would imply a phantom API.
 */
export interface KnowledgeRepository extends RepositoryMetadata {
  readonly unstable: true
  listKnowledgePoints(options?: RepositoryRequestOptions): Promise<KnowledgePointRecord[]>
  getKnowledgePoint(kpId: string, options?: RepositoryRequestOptions): Promise<KnowledgePointRecord | null>
  listOccurrences(filter?: KnowledgeFilter, options?: RepositoryRequestOptions): Promise<KnowledgeOccurrenceRecord[]>
  getAggregate(kpId: string, options?: RepositoryRequestOptions): Promise<KnowledgeAggregate | null>
  listAggregates(filter?: KnowledgeFilter, options?: RepositoryRequestOptions): Promise<KnowledgeAggregate[]>
}

export type KnowledgeFixtureSeed = {
  knowledgePoints?: readonly KnowledgePointRecord[]
  occurrences?: readonly KnowledgeOccurrenceRecord[]
}

const defaultKnowledgeFixtureSeed: Required<KnowledgeFixtureSeed> = {
  knowledgePoints: [
    {
      kp_id: 'fixture-kp-kimi',
      anchor_shape: 'lexical',
      anchor_payload: { surface: '君' },
      anchor: '君',
      pattern_grammar_version: null,
      opaque_reason: null,
      display_form: '君',
      tags: ['lexical'],
      default_retention: 'srs',
      canonical_id: null,
      lexical_anchors: ['lx_da636c71bab3557686de138257d58e6dec4abbbfc2eaabfac6c70ca7eb5d5150'],
      origin: 'extraction',
    },
    {
      kp_id: 'fixture-kp-tsugi',
      anchor_shape: 'lexical',
      anchor_payload: { surface: '次' },
      anchor: '次',
      pattern_grammar_version: null,
      opaque_reason: null,
      display_form: '次',
      tags: ['lexical'],
      default_retention: 'srs',
      canonical_id: null,
      lexical_anchors: ['lx_f7b9336979d127199e41f12a8b8d1470a9b412c158b5c8813589cb20033ac080'],
      origin: 'extraction',
    },
    {
      kp_id: 'fixture-kp-ganbaru',
      anchor_shape: 'lexical',
      anchor_payload: { surface: '頑張る' },
      anchor: '頑張る',
      pattern_grammar_version: null,
      opaque_reason: null,
      display_form: '頑張る',
      tags: ['lexical'],
      // The fixture does not include a KnowledgePointRetentionDecision row;
      // keep the persisted default at the data-model initial value and model
      // the reference choice on the concrete Occurrence below.
      default_retention: 'srs',
      canonical_id: null,
      lexical_anchors: ['lx_687037f08b690ee2604ecfd28d74cd4032b3a3dc89882a2b954caaa4f413310b'],
      origin: 'extraction',
    },
  ],
  occurrences: [
    {
      occurrence_id: 'fixture-occ-kimi',
      kp_id: 'fixture-kp-kimi',
      sentence_id: 'fixture-id-004',
      material_id: 'fixture-id-001',
      spans: [{ char_start: 2, char_end: 3 }],
      slot_bindings: {},
      salience: 'primary',
      retention_override: 'inherit',
      brief: '「君」在这里是对听话人的直接称呼，语气取决于上下文关系。',
      content_source: 'analysis_section',
      section_id: 'sec-grammar',
      section_revision: 1,
      source_analysis_id: 'analysis-fixture-study-discussion',
      extraction_run_id: 'fixture-extraction-kimi',
      extractor_model: 'fixture-model',
      extractor_prompt_version: 'fixture-prompt-v1',
      user_marked_useful: null,
    },
    {
      occurrence_id: 'fixture-occ-tsugi',
      kp_id: 'fixture-kp-tsugi',
      sentence_id: 'fixture-id-004',
      material_id: 'fixture-id-001',
      spans: [{ char_start: 0, char_end: 1 }],
      slot_bindings: {},
      salience: 'secondary',
      retention_override: 'srs',
      brief: '「次」表示顺序上的下一个，也可以自然地引出后续安排。',
      content_source: 'analysis_section',
      section_id: 'sec-whole',
      section_revision: 1,
      source_analysis_id: 'analysis-fixture-study-discussion',
      extraction_run_id: 'fixture-extraction-tsugi',
      extractor_model: 'fixture-model',
      extractor_prompt_version: 'fixture-prompt-v1',
      user_marked_useful: true,
    },
    {
      occurrence_id: 'fixture-occ-ganbaru',
      kp_id: 'fixture-kp-ganbaru',
      sentence_id: 'fixture-id-009',
      material_id: 'fixture-id-006',
      spans: [{ char_start: 3, char_end: 7 }],
      slot_bindings: {},
      salience: 'primary',
      // A reference example is represented as an Occurrence-level choice;
      // the KP default above remains the untouched initial srs value.
      retention_override: 'reference',
      brief: '「頑張ろう」是「頑張る」的意志形，表示一起努力的提议。',
      content_source: 'analysis_section',
      section_id: 'sec-whole',
      section_revision: 1,
      source_analysis_id: 'analysis-fixture-study-completed',
      extraction_run_id: 'fixture-extraction-ganbaru',
      extractor_model: 'fixture-model',
      extractor_prompt_version: 'fixture-prompt-v1',
      user_marked_useful: false,
    },
  ],
}

export const fixtureKnowledgePoints = defaultKnowledgeFixtureSeed.knowledgePoints
export const fixtureKnowledgeOccurrences = defaultKnowledgeFixtureSeed.occurrences

export class KnowledgeFixtureAdapter implements KnowledgeRepository {
  readonly source = 'fixture' as const
  readonly unstable = true as const
  private readonly seed: Required<KnowledgeFixtureSeed>

  constructor(seed: KnowledgeFixtureSeed = {}) {
    this.seed = {
      knowledgePoints: Array.from(seed.knowledgePoints ?? defaultKnowledgeFixtureSeed.knowledgePoints),
      occurrences: Array.from(seed.occurrences ?? defaultKnowledgeFixtureSeed.occurrences),
    }
  }

  async listKnowledgePoints(options: RepositoryRequestOptions = {}): Promise<KnowledgePointRecord[]> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    return cloneFixture([...this.seed.knowledgePoints])
  }

  async getKnowledgePoint(kpId: string, options: RepositoryRequestOptions = {}): Promise<KnowledgePointRecord | null> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    const point = this.seed.knowledgePoints.find((item) => item.kp_id === kpId)
    return point ? cloneFixture(point) : null
  }

  async listOccurrences(
    filter: KnowledgeFilter = {},
    options: RepositoryRequestOptions = {},
  ): Promise<KnowledgeOccurrenceRecord[]> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    return cloneFixture(this.seed.occurrences.filter((item) =>
      (filter.material_id === undefined || item.material_id === filter.material_id) &&
      (filter.kp_id === undefined || item.kp_id === filter.kp_id),
    ))
  }

  async getAggregate(kpId: string, options: RepositoryRequestOptions = {}): Promise<KnowledgeAggregate | null> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    const point = this.seed.knowledgePoints.find((item) => item.kp_id === kpId)
    if (!point) return null
    return {
      knowledge_point: cloneFixture(point),
      occurrences: cloneFixture(this.seed.occurrences.filter((item) => item.kp_id === kpId)),
    }
  }

  async listAggregates(filter: KnowledgeFilter = {}, options: RepositoryRequestOptions = {}): Promise<KnowledgeAggregate[]> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    const points = this.seed.knowledgePoints.filter((item) => filter.kp_id === undefined || item.kp_id === filter.kp_id)
    const result: KnowledgeAggregate[] = []
    for (const point of points) {
      const occurrences = this.seed.occurrences.filter((item) =>
        item.kp_id === point.kp_id &&
        (filter.material_id === undefined || item.material_id === filter.material_id),
      )
      // A material-scoped view is an occurrence projection. Do not surface a
      // global KP with zero source rows as if it belonged to that material.
      if (filter.material_id !== undefined && occurrences.length === 0) continue
      result.push({ knowledge_point: cloneFixture(point), occurrences: cloneFixture(occurrences) })
    }
    return result
  }
}

/** Explicit placeholder for the P4/P5 API surface (no such endpoint exists yet). */
export class KnowledgeApiAdapter implements KnowledgeRepository {
  readonly source = 'api' as const
  readonly unstable = true as const

  private unavailable(): Promise<never> {
    return Promise.reject(new FixtureCapabilityError('KnowledgePoint API'))
  }

  listKnowledgePoints(options?: RepositoryRequestOptions): Promise<KnowledgePointRecord[]> { void options; return this.unavailable() }
  getKnowledgePoint(kpId: string, options?: RepositoryRequestOptions): Promise<KnowledgePointRecord | null> { void kpId; void options; return this.unavailable() }
  listOccurrences(filter?: KnowledgeFilter, options?: RepositoryRequestOptions): Promise<KnowledgeOccurrenceRecord[]> { void filter; void options; return this.unavailable() }
  getAggregate(kpId: string, options?: RepositoryRequestOptions): Promise<KnowledgeAggregate | null> { void kpId; void options; return this.unavailable() }
  listAggregates(filter?: KnowledgeFilter, options?: RepositoryRequestOptions): Promise<KnowledgeAggregate[]> { void filter; void options; return this.unavailable() }
}

export function createKnowledgeFixtureAdapter(seed?: KnowledgeFixtureSeed): KnowledgeRepository {
  return new KnowledgeFixtureAdapter(seed)
}

export function createKnowledgeApiAdapter(): KnowledgeRepository {
  return new KnowledgeApiAdapter()
}

/** P4b has no API surface yet; this factory intentionally remains fixture-only. */
export function createKnowledgeRepository(seed?: KnowledgeFixtureSeed): KnowledgeRepository {
  return new KnowledgeFixtureAdapter(seed)
}
