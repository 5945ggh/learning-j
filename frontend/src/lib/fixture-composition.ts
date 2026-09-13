/**
 * Application fixture composition.
 *
 * P1's material fixture and P2's reader fixture are generated from separate
 * isolated datasets.  Their `fixture-id-*` values are opaque database IDs,
 * so equal-looking values must not be joined across artifacts.  This module
 * is the only place that composes them for an offline UI: it assigns a fresh
 * application-local identity to each proved-by-surface pairing.  The raw
 * artifacts and their contract tests remain unchanged.
 */
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
import type { MaterialFixtureSeed, MaterialRepository } from '@/lib/material-repository'
import { MaterialApiAdapter, MaterialFixtureAdapter } from '@/lib/material-repository'
import {
  fixtureKnowledgeOccurrences,
  fixtureKnowledgePoints,
  type KnowledgeFixtureSeed,
} from '@/lib/knowledge-repository'
import { fixtureAnnotations, fixtureSentenceTokens, fixtureSubtitleSentenceTokens } from '@/lib/reader-fixtures'
import { asSentenceText } from '@/lib/text'
import { ReaderApiAdapter, type ReaderFixtureSeed, type ReaderRepository } from '@/lib/reader-repository'
import type { Annotation, AnnotationListOptions } from '@/lib/annotations'
import type { LexemeDecisionRequest, LexemeDecisionResult } from '@/lib/lexemes'
import type { DictionaryLookupResult, DictionarySearchResult, DictionarySource } from '@/lib/dictionary'
import type { EvidenceSummary } from '@/lib/lexemes'
import { fixtureReviewItems, type ReviewFixtureSeed } from '@/lib/review-repository'
import { fixtureStudySessions, type StudyFixtureSeed } from '@/lib/study-repository'
import type { Material, MaterialLexemeCounts, Sentence, Sidecar } from '@/lib/materials'
import type { SentenceTokens } from '@/lib/tokens'
import type { RepositoryRequestOptions } from '@/lib/repository-utils'

export const fixtureCompositionIds = {
  textMaterial: 'fixture-ui-text-material',
  textSentence: 'fixture-ui-text-sentence',
  annotationSentence: 'fixture-ui-text-annotation-sentence',
  subtitleMaterial: 'fixture-ui-subtitle-material',
  subtitleSentence: 'fixture-ui-subtitle-sentence',
  subtitleSecondSentence: 'fixture-ui-subtitle-second-sentence',
  epubMaterial: 'fixture-ui-epub-material',
} as const

const materialIds: Record<string, string> = {
  'fixture-id-001': fixtureCompositionIds.textMaterial,
  'fixture-id-004': fixtureCompositionIds.textMaterial,
  'fixture-id-006': fixtureCompositionIds.subtitleMaterial,
  'fixture-id-007': fixtureCompositionIds.subtitleMaterial,
  'local-fixture-epub-001': fixtureCompositionIds.epubMaterial,
}

/** P1 material fixture sentence identities (used by Study/Knowledge/API). */
const p1SentenceIds: Record<string, string> = {
  'fixture-id-003': fixtureCompositionIds.annotationSentence,
  'fixture-id-004': fixtureCompositionIds.textSentence,
  'fixture-id-005': 'fixture-ui-text-sentence-3',
  'fixture-id-008': fixtureCompositionIds.subtitleSentence,
  'fixture-id-009': fixtureCompositionIds.subtitleSecondSentence,
  'local-fixture-epub-002': 'fixture-ui-epub-sentence-1',
  'local-fixture-epub-003': 'fixture-ui-epub-sentence-2',
}

/** P2 reader artifact sentence identities (used only by raw reader fixtures). */
const readerArtifactSentenceIds: Record<string, string> = {
  'fixture-id-003': fixtureCompositionIds.textSentence,
  'fixture-id-006': fixtureCompositionIds.subtitleSentence,
  'fixture-id-011': fixtureCompositionIds.annotationSentence,
}

/** Raw endpoint identities corresponding to the composed UI identities. */
const materialEndpointIds: Record<string, string> = {
  // Annotation and decision endpoints are material-scoped P1 APIs. Their
  // request path must use the P1 material identity, not the separately
  // generated reader artifact's response `material_id`.
  [fixtureCompositionIds.textMaterial]: 'fixture-id-001',
  [fixtureCompositionIds.subtitleMaterial]: 'fixture-id-006',
}

const sentenceEndpointIds: Record<string, string> = {
  // The default API bundle is proven against the P1 material fixture. Do not
  // use the independently generated reader artifact IDs here: in that
  // artifact fixture-id-003/006 identify different entities.
  [fixtureCompositionIds.textSentence]: 'fixture-id-004',
  [fixtureCompositionIds.subtitleSentence]: 'fixture-id-008',
}

function materialId(id: string): string { return materialIds[id] ?? id }
function p1SentenceId(id: string): string { return p1SentenceIds[id] ?? id }
function readerArtifactSentenceId(id: string): string { return readerArtifactSentenceIds[id] ?? id }
function annotationSentenceId(id: string): string {
  const p1Id = p1SentenceId(id)
  return p1Id === id ? readerArtifactSentenceId(id) : p1Id
}

function composeMaterial(material: Material, id: string, sidecarId: string | null): Material {
  return { ...material, id, current_sidecar_id: sidecarId }
}

function composeSentence(sentence: Sentence, id: string, parentId: string): Sentence {
  return { ...sentence, id, material_id: parentId }
}

function composeSidecar(sidecar: Sidecar, parentId: string, id: string): Sidecar {
  return { ...sidecar, material_id: parentId, sidecar_generation_id: id }
}

function composeCounts(counts: MaterialLexemeCounts, parentId: string, sidecarId: string): MaterialLexemeCounts {
  return { ...counts, material_id: parentId, sidecar_generation_id: sidecarId }
}

function composeTokens(tokens: SentenceTokens): SentenceTokens {
  return {
    ...tokens,
    material_id: materialId(tokens.material_id),
    sentence_id: readerArtifactSentenceId(tokens.sentence_id),
    sidecar_generation_id: tokens.sentence_id === 'fixture-id-003' ? 'fixture-ui-text-sidecar' : 'fixture-ui-subtitle-sidecar',
  }
}

/** A complete, offline-only fixture bundle with no raw cross-artifact IDs. */
export function createFixtureComposition(): {
  materials: MaterialFixtureSeed
  reader: ReaderFixtureSeed
  study: StudyFixtureSeed
  knowledge: KnowledgeFixtureSeed
  review: ReviewFixtureSeed
} {
  const textSidecar = composeSidecar(fixtureSidecar, fixtureCompositionIds.textMaterial, 'fixture-ui-text-sidecar')
  // The generated P1 sidecar artifacts are separate datasets.  Reuse only
  // their shared version shape here, while preserving the subtitle material's
  // own content hash so a composed sidecar can never claim the txt payload.
  const subtitleSidecar = composeSidecar(
    { ...fixtureSidecar, content_hash: fixtureSubtitleMaterial.content_hash },
    fixtureCompositionIds.subtitleMaterial,
    'fixture-ui-subtitle-sidecar',
  )
  const materials: MaterialFixtureSeed = {
    materials: [
      composeMaterial(fixtureTextMaterial, fixtureCompositionIds.textMaterial, textSidecar.sidecar_generation_id),
      composeMaterial(fixtureSubtitleMaterial, fixtureCompositionIds.subtitleMaterial, subtitleSidecar.sidecar_generation_id),
      composeMaterial(fixtureEpubMaterial, fixtureCompositionIds.epubMaterial, null),
    ],
    sentences: [
      composeSentence(fixtureTextSentences[0]!, fixtureCompositionIds.annotationSentence, fixtureCompositionIds.textMaterial),
      composeSentence(fixtureTextSentences[1]!, fixtureCompositionIds.textSentence, fixtureCompositionIds.textMaterial),
      composeSentence(fixtureTextSentences[2]!, 'fixture-ui-text-sentence-3', fixtureCompositionIds.textMaterial),
      composeSentence(fixtureSubtitleSentences[0]!, fixtureCompositionIds.subtitleSentence, fixtureCompositionIds.subtitleMaterial),
      composeSentence(fixtureSubtitleSentences[1]!, fixtureCompositionIds.subtitleSecondSentence, fixtureCompositionIds.subtitleMaterial),
      ...fixtureEpubSentences.map((item) => composeSentence(item, p1SentenceId(item.id), fixtureCompositionIds.epubMaterial)),
    ],
    sidecars: [textSidecar, subtitleSidecar],
    lexemeCounts: [
      composeCounts(fixtureLexemeCounts, fixtureCompositionIds.textMaterial, textSidecar.sidecar_generation_id),
      { material_id: fixtureCompositionIds.subtitleMaterial, sidecar_generation_id: subtitleSidecar.sidecar_generation_id, counts: [] },
    ],
  }

  return {
    materials,
    reader: {
      sentenceTokens: [composeTokens(fixtureSentenceTokens), composeTokens(fixtureSubtitleSentenceTokens)],
      annotations: fixtureAnnotations.map((annotation) => ({
        ...annotation,
        material_id: fixtureCompositionIds.textMaterial,
        spans: annotation.spans.map((span) => ({ ...span, sentence_id: fixtureCompositionIds.annotationSentence, alignment_sidecar_id: textSidecar.sidecar_generation_id })),
      })),
    },
    study: {
      sessions: fixtureStudySessions.map((item) => ({
        ...item,
        material_id: materialId(item.material_id),
        source_sentence_ids: item.source_sentence_ids.map(p1SentenceId),
      })),
    },
    knowledge: {
      knowledgePoints: fixtureKnowledgePoints,
      occurrences: fixtureKnowledgeOccurrences.map((item) => ({ ...item, material_id: materialId(item.material_id), sentence_id: p1SentenceId(item.sentence_id) })),
    },
    review: { reviewItems: fixtureReviewItems },
  }
}

/**
 * Production material reads stay on the real API.  Fixture source IDs live in
 * a disjoint namespace, so only those IDs receive the explicit offline
 * resolver fallback needed by P3+ fixture routes.
 */
export class FixtureResolvingMaterialRepository implements MaterialRepository {
  readonly source = 'api' as const
  readonly unstable = false
  private readonly api = new MaterialApiAdapter()
  private readonly fixtures: MaterialFixtureAdapter

  constructor(seed: MaterialFixtureSeed = createFixtureComposition().materials) {
    this.fixtures = new MaterialFixtureAdapter(seed)
  }

  private async fixtureMaterialId(id: string): Promise<string | null> {
    // Only the application-local namespace is trusted without an API proof.
    // Raw `fixture-id-*` aliases are checked against the API material's
    // content hash before they can resolve to this offline composition.
    return (await this.fixtures.getMaterial(id)) ? id : null
  }

  private async resolveFixtureAlias(id: string, options: RepositoryRequestOptions): Promise<string | null> {
    const composedId = materialId(id)
    if (composedId === id) return null
    const fixture = await this.fixtures.getMaterial(composedId, options)
    if (!fixture) return null
    const remote = await this.api.getMaterial(id, options)
    return remote && remote.content_hash === fixture.content_hash ? composedId : null
  }

  async listMaterials(options: RepositoryRequestOptions = {}) {
    const materials = await this.api.listMaterials(options)
    // When a local backend exposes the generated material fixture, compose it
    // into the same identity space used by the P3+ fixture projections.  A
    // content-hash check proves that this is the known fixture, so arbitrary
    // real materials remain untouched and API-backed.
    return Promise.all(materials.map(async (material) => {
      const composedId = materialId(material.id)
      const fixture = await this.fixtures.getMaterial(composedId)
      return fixture && fixture.content_hash === material.content_hash ? fixture : material
    }))
  }

  async getMaterial(id: string, options: RepositoryRequestOptions = {}) {
    const fixtureId = await this.fixtureMaterialId(id)
    if (fixtureId) return this.fixtures.getMaterial(fixtureId, options)
    const aliasId = await this.resolveFixtureAlias(id, options)
    if (aliasId) return this.fixtures.getMaterial(aliasId, options)
    return this.api.getMaterial(id, options)
  }

  async listSentences(id: string, options: RepositoryRequestOptions = {}) {
    const fixtureId = await this.fixtureMaterialId(id)
    if (fixtureId) return this.fixtures.listSentences(fixtureId, options)
    const aliasId = await this.resolveFixtureAlias(id, options)
    if (aliasId) return this.fixtures.listSentences(aliasId, options)
    return this.api.listSentences(id, options)
  }

  async getSidecar(id: string, options: RepositoryRequestOptions = {}) {
    const fixtureId = await this.fixtureMaterialId(id)
    if (fixtureId) return this.fixtures.getSidecar(fixtureId, options)
    const aliasId = await this.resolveFixtureAlias(id, options)
    if (aliasId) return this.fixtures.getSidecar(aliasId, options)
    return this.api.getSidecar(id, options)
  }

  async getLexemeCounts(id: string, options: RepositoryRequestOptions = {}) {
    const fixtureId = await this.fixtureMaterialId(id)
    if (fixtureId) return this.fixtures.getLexemeCounts(fixtureId, options)
    const aliasId = await this.resolveFixtureAlias(id, options)
    if (aliasId) return this.fixtures.getLexemeCounts(aliasId, options)
    return this.api.getLexemeCounts(id, options)
  }
}

export function createFixtureResolvingMaterialRepository(seed?: MaterialFixtureSeed): MaterialRepository {
  return new FixtureResolvingMaterialRepository(seed)
}

/**
 * API-first reader resolver for the composed UI namespace.  P1/P2 endpoints
 * still receive their generated raw IDs; the adapter rewrites only the
 * response provenance back into the same application-local identity space as
 * the material resolver.  Unknown IDs pass through untouched.
 */
export class FixtureResolvingReaderRepository implements ReaderRepository {
  readonly source = 'api' as const
  readonly unstable = false
  private readonly api = new ReaderApiAdapter()

  async getSentenceTokens(sentenceId: string, options = {}) {
    const rawSentenceId = sentenceEndpointIds[sentenceId] ?? sentenceId
    const tokens = await this.api.getSentenceTokens(rawSentenceId, options)
    if (rawSentenceId === sentenceId) return tokens
    return {
      ...tokens,
      sentence_id: sentenceId,
      // The composition map, not the reader artifact's echoed identity, is
      // authoritative for the material scope of a known sentence fixture.
      material_id: sentenceId === fixtureCompositionIds.textSentence
        ? fixtureCompositionIds.textMaterial
        : fixtureCompositionIds.subtitleMaterial,
      sidecar_generation_id: sentenceId === fixtureCompositionIds.textSentence
        ? 'fixture-ui-text-sidecar'
        : 'fixture-ui-subtitle-sidecar',
    }
  }

  listDictionaries(options = {}): Promise<DictionarySource[]> {
    return this.api.listDictionaries(options)
  }

  lookupDictionary(expression: string, options = {}): Promise<DictionaryLookupResult> {
    return this.api.lookupDictionary(expression, options)
  }

  searchDictionary(query: string, options = {}): Promise<DictionarySearchResult> {
    return this.api.searchDictionary(query, options)
  }

  getEvidenceSummary(lexemeId: string, options = {}): Promise<EvidenceSummary> {
    return this.api.getEvidenceSummary(lexemeId, options)
  }

  recordLexemeDecision(request: LexemeDecisionRequest): Promise<LexemeDecisionResult> {
    const material = request.materialId
    return this.api.recordLexemeDecision({
      ...request,
      materialId: material ? (materialEndpointIds[material] ?? material) : material,
    })
  }

  async listAnnotations(materialIdValue: string, options: AnnotationListOptions = {}): Promise<Annotation[]> {
    const rawMaterialId = materialEndpointIds[materialIdValue] ?? materialIdValue
    const annotations = await this.api.listAnnotations(rawMaterialId, options)
    if (rawMaterialId === materialIdValue) return annotations
    return annotations.map((annotation) => ({
      ...annotation,
      material_id: materialIdValue,
      spans: annotation.spans.map((span) => ({
        ...span,
        surface: asSentenceText(span.surface),
        sentence_id: annotationSentenceId(span.sentence_id),
        alignment_sidecar_id: materialIdValue === fixtureCompositionIds.subtitleMaterial
          ? 'fixture-ui-subtitle-sidecar'
          : 'fixture-ui-text-sidecar',
      })),
    }))
  }
}

export function createFixtureResolvingReaderRepository(): ReaderRepository {
  return new FixtureResolvingReaderRepository()
}
