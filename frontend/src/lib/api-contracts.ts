import type { components } from '@/lib/api-types'
import type { SentenceText } from '@/lib/text'

/**
 * Stable frontend names for the generated backend contract.
 *
 * `api-types.d.ts` is replaced by `pnpm types:sync`; this file is the small
 * compatibility boundary used by clients, repositories, fixtures, and
 * components. The intersections only make nullable OpenAPI fields explicit
 * for the existing frontend contract and brand persisted text surfaces with
 * their code-point semantics; they do not add fields or alter wire values.
 */
type Schemas = components['schemas']

export type Material = Schemas['MaterialOut'] & {
  source_sha256: string | null
  current_sidecar_id: string | null
}

export type Sentence = Schemas['SentenceOut'] & {
  time_start: number | null
  time_end: number | null
  translation: string | null
}

export type Sidecar = Schemas['SidecarOut']
export type MaterialLexemeCount = Schemas['MaterialLexemeCountOut']
export type MaterialLexemeCounts = Schemas['MaterialLexemeCountsOut']

export type TokenProvenance = Schemas['TokenProvenanceOut']
export type AlgorithmToken = Schemas['AlgorithmTokenOut'] & { surface: SentenceText }
export type SentenceTokens = Schemas['SentenceTokensOut'] & { tokens: AlgorithmToken[] }

export type DictionarySource = Schemas['DictionarySourceOut']
export type DictionaryDefinition = Omit<Schemas['DictionaryDefinitionOut'], 'structured_content'> & {
  structured_content: Record<string, unknown> | null
}
export type DictionaryEntry = Omit<Schemas['LookupEntryOut'], 'reading' | 'sequence' | 'definitions'> & {
  reading: string | null
  sequence: number | null
  definitions: DictionaryDefinition[]
}
export type DictionaryLookupResult = Omit<Schemas['DictionaryLookupOut'], 'reading' | 'entries'> & {
  reading: string | null
  entries: DictionaryEntry[]
}
export type DictionarySearchResult = Omit<Schemas['DictionarySearchOut'], 'entries'> & {
  entries: DictionaryEntry[]
}

export type AnnotationSpan = Omit<Schemas['AnnotationSpanOut'], 'alignment_sidecar_id' | 'token_start' | 'token_end' | 'surface'> & {
  surface: SentenceText
  alignment_sidecar_id: string | null
  token_start: number | null
  token_end: number | null
}
export type Annotation = Omit<Schemas['AnnotationOut'], 'note' | 'color' | 'spans'> & {
  note: string | null
  color: string | null
  spans: AnnotationSpan[]
}

export type LexemeDecisionResult = Omit<Schemas['DecisionOut'], 'evidence_id' | 'conjugated_form'> & {
  evidence_id: string | null
  conjugated_form: string | null
}
export type EvidenceSummaryScope = Omit<Schemas['EvidenceSummaryScopeOut'], 'current_decision' | 'current_decision_id' | 'current_decision_seq'> & {
  current_decision: Exclude<Schemas['EvidenceSummaryScopeOut']['current_decision'], undefined>
  current_decision_id: string | null
  current_decision_seq: number | null
}
export type EvidenceSummary = Omit<Schemas['EvidenceSummaryOut'], 'scopes'> & {
  scopes: EvidenceSummaryScope[]
}

/** Canonical request body used by the lexeme decision client. */
export type DecisionCreateBody = Schemas['DecisionCreateIn']
