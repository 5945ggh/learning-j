/**
 * UI projection types used by the migrated, shell-independent components.
 *
 * These are intentionally small view contracts rather than persistence models.
 * P3+ repositories may adapt their API/fixture records to these shapes; no
 * component owns a fetch, a route, or a workflow transition.
 */

/**
 * Unicode code-point, half-open range used by the text highlighter.
 *
 * `char_start`/`char_end` is the API-facing spelling. The small `start`/`end`
 * view spelling is accepted for repository projections that have already
 * normalized a Span; both retain the same data-model semantics.
 */
export type TextSpan =
  | { char_start: number; char_end: number; surface?: string }
  | { start: number; end: number; surface?: string }

export type ChapterRecord = {
  id: string
  /** One-based chapter/episode ordinal. */
  index: number
  /** A value in the closed range [0, 1]. */
  progress: number
  /** Only imported chapters can be opened by the owning shell. */
  imported: boolean
  title?: string | null
}

export type SessionPhase = 'preparation' | 'discussion' | 'extraction' | 'confirmation'
export type SessionStatus = 'active' | 'completed' | 'parked'
export type SessionMode = 'interactive' | 'automatic'

/** Minimal StudySession projection needed by a session list. */
export type SessionRecord = {
  id: string
  phase: SessionPhase
  status: SessionStatus
  mode?: SessionMode
  material_title?: string | null
  source_text?: string | null
  created_at?: string | null
}

export type AnalysisSectionRecord = {
  id?: string
  section_id?: string
  sectionId?: string
  revision: number
  heading: string
  body_md?: string
  bodyMd?: string
}

export type AnalysisRevisionRecord = {
  revision: number
  sections: AnalysisSectionRecord[]
}

export type AnalysisMessageRecord = {
  id: string
  role: 'user' | 'assistant'
  content: string
  edited_sections?: string[]
  pending_note?: string | null
  editedSections?: string[]
  pendingNote?: string | null
}

export type RetentionChoice = 'inherit' | 'srs' | 'reference'
export type ReviewStatus = 'queued' | 'active' | 'paused' | 'retired'

export type KnowledgeOccurrenceRecord = {
  id: string
  sentence_id: string
  material_id: string
  sentence_text: string
  spans: TextSpan[]
  brief: string
  salience?: 'primary' | 'secondary'
  retention: RetentionChoice
  effective_retention?: Exclude<RetentionChoice, 'inherit'>
  review_status?: ReviewStatus | null
  source_label?: string | null
}

export type KnowledgeAggregateRecord = {
  id: string
  form: string
  reading?: string | null
  kind_label?: string | null
  default_retention: Exclude<RetentionChoice, 'inherit'>
  default_retention_set_by: 'default' | 'user'
  occurrences: KnowledgeOccurrenceRecord[]
}

export type ReviewCardRecord = {
  id: string
  form: string
  reading?: string | null
  sentence_text: string
  spans: TextSpan[]
  brief?: string | null
  status: ReviewStatus
  material_title?: string | null
  source_label?: string | null
}
