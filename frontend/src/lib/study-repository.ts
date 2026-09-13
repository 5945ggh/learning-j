import {
  cloneFixture,
  FixtureCapabilityError,
  type RepositoryMetadata,
  type RepositoryRequestOptions,
  throwIfAborted,
} from '@/lib/repository-utils'

/** P3a domain enums copied from data-model §4; kept here as an unstable read view. */
export type StudySessionMode = 'interactive' | 'automatic'
export type StudySessionStatus = 'active' | 'completed' | 'parked'
export type StudySessionPhase = 'preparation' | 'discussion' | 'extraction' | 'confirmation'

export type StudyRunPurpose = 'generation' | 'discussion'
export type StudyRunStatus = 'queued' | 'running' | 'paused' | 'failed' | 'cancelled' | 'succeeded'
export type StudyRunPauseReason = 'budget_exhausted'

/** Data-model §4.1 leaves return_position as JSON; do not invent its payload. */
export type StudyReturnPosition = Record<string, unknown> | null

export type StudyAnalysisSection = {
  section_version_id: string
  section_id: string
  analysis_id: string
  heading_path: string[]
  split_strategy: 'heading' | 'paragraph' | 'fallback_single'
  body_md: string
  revision: number
  origin_agent_run_id: string | null
}

export type StudyAnalysisRevision = {
  analysis_revision_id: string
  analysis_id: string
  revision: number
  section_refs: string[]
  sections: StudyAnalysisSection[]
}

export type StudyAnalysis = {
  analysis_id: string
  session_id: string
  current_revision_id: string | null
  style_modules: string[]
  style_free_text: string | null
  user_question: string | null
  output_language: string
  retrieval_enabled: boolean
  revisions: StudyAnalysisRevision[]
  /** A generation draft is visible but is not an extractable revision. */
  draft: string | null
}

export type StudyAnalysisMessage = {
  id: string
  session_id: string
  message_index: number
  role: 'user' | 'assistant'
  content: string
  agent_run_id: string | null
  edited_sections: string[]
}

/** Queue/run state is read as-is; the frontend never derives timer progress. */
export type StudyRunRecord = {
  id: string
  session_id: string
  purpose: StudyRunPurpose
  status: StudyRunStatus
  pause_reason: StudyRunPauseReason | null
  provider: string | null
  model: string | null
  prompt_version: string | null
}

export type StudySessionRecord = {
  id: string
  material_id: string
  source_sentence_ids: string[]
  parent_session_id: string | null
  source_analysis_revision_id: string | null
  mode: StudySessionMode
  status: StudySessionStatus
  phase: StudySessionPhase
  current_extraction_run_id: string | null
  completed_at: string | null
  return_position: StudyReturnPosition
  analysis: StudyAnalysis | null
  messages: StudyAnalysisMessage[]
  question_draft: string
  created_at: string
  /** Optional fixture-only execution status; absent when no run exists. */
  current_run: StudyRunRecord | null
  /** Extraction/confirmation remain explicit placeholders in this package. */
  unsupported_notice: string | null
}

export type StudySessionFilter = {
  material_id?: string
  status?: StudySessionStatus
  phase?: StudySessionPhase
}

/**
 * P3+ repository contract.  No backend StudySession endpoints exist in the
 * current OpenAPI, so this interface is intentionally read-only and unstable.
 * P3a replaces the adapter while retaining the same component-facing fields.
 */
export interface StudyRepository extends RepositoryMetadata {
  readonly unstable: true
  listSessions(filter?: StudySessionFilter, options?: RepositoryRequestOptions): Promise<StudySessionRecord[]>
  getSession(sessionId: string, options?: RepositoryRequestOptions): Promise<StudySessionRecord | null>
  listActiveSessions(materialId?: string, options?: RepositoryRequestOptions): Promise<StudySessionRecord[]>
  listHistory(materialId?: string, options?: RepositoryRequestOptions): Promise<StudySessionRecord[]>
}

export type StudyFixtureSeed = {
  sessions?: readonly StudySessionRecord[]
}

const section = (
  analysisId: string,
  sectionId: string,
  heading: string,
  body: string,
  revision = 1,
): StudyAnalysisSection => ({
  section_version_id: `${sectionId}-v${revision}`,
  section_id: sectionId,
  analysis_id: analysisId,
  heading_path: [heading],
  split_strategy: 'heading',
  body_md: body,
  revision,
  origin_agent_run_id: null,
})

const analysis = (
  sessionId: string,
  sections: StudyAnalysisSection[],
  draft: string | null = null,
): StudyAnalysis => {
  const analysisId = `analysis-${sessionId}`
  const revision: StudyAnalysisRevision | null = sections.length > 0
    ? {
      analysis_revision_id: `${analysisId}-r1`,
      analysis_id: analysisId,
      revision: 1,
      section_refs: sections.map((item) => item.section_version_id),
      sections: sections.map((item) => ({ ...item, analysis_id: analysisId })),
    }
    : null
  return {
    analysis_id: analysisId,
    session_id: sessionId,
    current_revision_id: revision?.analysis_revision_id ?? null,
    style_modules: ['grammar', 'vocabulary'],
    style_free_text: null,
    user_question: null,
    output_language: 'zh',
    retrieval_enabled: false,
    revisions: revision ? [revision] : [],
    draft,
  }
}

const run = (
  id: string,
  sessionId: string,
  purpose: StudyRunPurpose,
  status: StudyRunStatus,
  pauseReason: StudyRunPauseReason | null = null,
): StudyRunRecord => ({
  id,
  session_id: sessionId,
  purpose,
  status,
  pause_reason: pauseReason,
  provider: status === 'succeeded' ? 'fixture-provider' : null,
  model: status === 'succeeded' ? 'fixture-model' : null,
  prompt_version: status === 'succeeded' ? 'fixture-prompt-v1' : null,
})

function session(
  values: Omit<StudySessionRecord, 'parent_session_id' | 'source_analysis_revision_id' | 'current_extraction_run_id' | 'completed_at' | 'return_position' | 'messages' | 'question_draft' | 'current_run' | 'unsupported_notice'> &
    Partial<Pick<StudySessionRecord, 'parent_session_id' | 'source_analysis_revision_id' | 'current_extraction_run_id' | 'completed_at' | 'return_position' | 'messages' | 'question_draft' | 'current_run' | 'unsupported_notice'>>,
): StudySessionRecord {
  return {
    parent_session_id: null,
    source_analysis_revision_id: null,
    current_extraction_run_id: null,
    completed_at: null,
    return_position: null,
    messages: [],
    question_draft: '',
    current_run: null,
    unsupported_notice: null,
    ...values,
  }
}

const defaultStudyFixtureSeed: Required<StudyFixtureSeed> = {
  sessions: [
    session({
      id: 'fixture-study-preparation',
      material_id: 'fixture-id-001',
      source_sentence_ids: ['fixture-id-004'],
      mode: 'interactive',
      status: 'active',
      phase: 'preparation',
      created_at: '2026-09-10T09:20:00+08:00',
      analysis: analysis(
        'fixture-study-preparation',
        [],
        '正在读取原句并组织讲解…\n\n先确认这句话的谓语落在哪里，再决定要不要拆成两节。',
      ),
      question_draft: '这句的「君」在这里是什么语气？',
      current_run: run('fixture-study-preparation-run', 'fixture-study-preparation', 'generation', 'queued'),
    }),
    session({
      id: 'fixture-study-discussion',
      material_id: 'fixture-id-001',
      source_sentence_ids: ['fixture-id-004'],
      mode: 'interactive',
      status: 'active',
      phase: 'discussion',
      created_at: '2026-09-10T09:12:00+08:00',
      analysis: analysis('fixture-study-discussion', [
        section('analysis-fixture-study-discussion', 'sec-whole', '整句在说什么', '这句话先提出一个对象，再用后半句补充说明语境。'),
        section('analysis-fixture-study-discussion', 'sec-grammar', '句法关系', '这里的助词把前后两个短语连接起来；完整文档来自已提交 revision。'),
      ]),
      messages: [
        {
          id: 'fixture-study-discussion-m1',
          session_id: 'fixture-study-discussion',
          message_index: 0,
          role: 'user',
          content: '这个表达和更正式的说法有什么差别？',
          agent_run_id: null,
          edited_sections: [],
        },
        {
          id: 'fixture-study-discussion-m2',
          session_id: 'fixture-study-discussion',
          message_index: 1,
          role: 'assistant',
          content: '这里保留了口语语气；当前 fixture 只展示只读回复。',
          agent_run_id: null,
          edited_sections: [],
        },
      ],
      current_run: run('fixture-study-discussion-run', 'fixture-study-discussion', 'discussion', 'succeeded'),
    }),
    session({
      id: 'fixture-study-extraction-placeholder',
      material_id: 'fixture-id-006',
      source_sentence_ids: ['fixture-id-008'],
      mode: 'interactive',
      status: 'active',
      phase: 'extraction',
      created_at: '2026-09-10T09:02:00+08:00',
      analysis: analysis('fixture-study-extraction-placeholder', [
        section('analysis-fixture-study-extraction-placeholder', 'sec-whole', '已提交文档', '固定 revision 的文档可查看；提取面在本包中仍为待实现。'),
      ]),
      current_extraction_run_id: 'fixture-extraction-not-implemented',
      current_run: run('fixture-study-extraction-run', 'fixture-study-extraction-placeholder', 'generation', 'running'),
      unsupported_notice: '提取行为待实现；不会在前端伪造进度或候选。',
    }),
    session({
      id: 'fixture-study-confirmation-placeholder',
      material_id: 'fixture-id-001',
      source_sentence_ids: ['fixture-id-003'],
      mode: 'automatic',
      status: 'active',
      phase: 'confirmation',
      created_at: '2026-09-10T08:40:00+08:00',
      analysis: analysis('fixture-study-confirmation-placeholder', [
        section('analysis-fixture-study-confirmation-placeholder', 'sec-whole', '解析文档', '确认单位与 Occurrence 规则属于后续 P4b；本包只保留来源语境。'),
      ]),
      current_extraction_run_id: 'fixture-confirmation-not-implemented',
      current_run: run('fixture-study-confirmation-run', 'fixture-study-confirmation-placeholder', 'generation', 'succeeded'),
      unsupported_notice: '提取候选与确认流程待实现。',
    }),
    session({
      id: 'fixture-study-parked',
      material_id: 'fixture-id-006',
      source_sentence_ids: ['fixture-id-009'],
      mode: 'interactive',
      status: 'parked',
      phase: 'discussion',
      created_at: '2026-09-09T20:10:00+08:00',
      analysis: analysis('fixture-study-parked', [
        section('analysis-fixture-study-parked', 'sec-whole', '暂停的文档', '这是一个保留阶段与来源的搁置会话。'),
      ]),
      current_run: run('fixture-study-parked-run', 'fixture-study-parked', 'discussion', 'paused', 'budget_exhausted'),
    }),
    session({
      id: 'fixture-study-completed',
      material_id: 'fixture-id-006',
      source_sentence_ids: ['fixture-id-008'],
      mode: 'interactive',
      status: 'completed',
      phase: 'confirmation',
      created_at: '2026-09-08T20:10:00+08:00',
      completed_at: '2026-09-08T20:24:00+08:00',
      analysis: analysis('fixture-study-completed', [
        section('analysis-fixture-study-completed', 'sec-whole', '学习记录', '完成的会话保留原文来源与已提交文档。'),
      ]),
      current_run: run('fixture-study-completed-run', 'fixture-study-completed', 'generation', 'succeeded'),
    }),
  ],
}

/** Formal fixture records available to the P3a adapter and tests. */
export const fixtureStudySessions = defaultStudyFixtureSeed.sessions

/**
 * Fixture-only P3+ read adapter.  It is deliberately not an API mock: no
 * `fetch`, timer, localStorage, or route lifecycle is used here.
 */
export class StudyFixtureAdapter implements StudyRepository {
  readonly source = 'fixture' as const
  readonly unstable = true as const
  private readonly seed: Required<StudyFixtureSeed>

  constructor(seed: StudyFixtureSeed = {}) {
    this.seed = { sessions: seed.sessions ?? defaultStudyFixtureSeed.sessions }
  }

  async listSessions(
    filter: StudySessionFilter = {},
    options: RepositoryRequestOptions = {},
  ): Promise<StudySessionRecord[]> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    return cloneFixture(this.seed.sessions.filter((item) =>
      (filter.material_id === undefined || item.material_id === filter.material_id) &&
      (filter.status === undefined || item.status === filter.status) &&
      (filter.phase === undefined || item.phase === filter.phase),
    ))
  }

  async getSession(sessionId: string, options: RepositoryRequestOptions = {}): Promise<StudySessionRecord | null> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    const item = this.seed.sessions.find((sessionItem) => sessionItem.id === sessionId)
    return item ? cloneFixture(item) : null
  }

  listActiveSessions(materialId?: string, options: RepositoryRequestOptions = {}): Promise<StudySessionRecord[]> {
    return this.listSessions({ material_id: materialId, status: 'active' }, options)
  }

  async listHistory(materialId?: string, options: RepositoryRequestOptions = {}): Promise<StudySessionRecord[]> {
    throwIfAborted(options.signal)
    await Promise.resolve()
    return cloneFixture(this.seed.sessions.filter((item) =>
      (item.status === 'completed' || item.status === 'parked') &&
      (materialId === undefined || item.material_id === materialId),
    ))
  }
}

/** Placeholder API adapter kept explicit until P3a publishes Study endpoints. */
export class StudyApiAdapter implements StudyRepository {
  readonly source = 'api' as const
  readonly unstable = true as const

  private unavailable(): Promise<never> {
    return Promise.reject(new FixtureCapabilityError('StudySession API'))
  }

  listSessions(filter?: StudySessionFilter, options?: RepositoryRequestOptions): Promise<StudySessionRecord[]> { void filter; void options; return this.unavailable() }
  getSession(sessionId: string, options?: RepositoryRequestOptions): Promise<StudySessionRecord | null> { void sessionId; void options; return this.unavailable() }
  listActiveSessions(materialId?: string, options?: RepositoryRequestOptions): Promise<StudySessionRecord[]> { void materialId; void options; return this.unavailable() }
  listHistory(materialId?: string, options?: RepositoryRequestOptions): Promise<StudySessionRecord[]> { void materialId; void options; return this.unavailable() }
}

export function createStudyFixtureAdapter(seed?: StudyFixtureSeed): StudyRepository {
  return new StudyFixtureAdapter(seed)
}

export function createStudyApiAdapter(): StudyRepository {
  return new StudyApiAdapter()
}

/** P3a has no API surface yet; this factory makes the boundary explicit. */
export function createStudyRepository(seed?: StudyFixtureSeed): StudyRepository {
  return new StudyFixtureAdapter(seed)
}
