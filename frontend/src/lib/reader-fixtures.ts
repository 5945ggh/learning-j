import type {
  DictionaryLookupResult,
  DictionarySearchResult,
  DictionarySource,
} from '@/lib/dictionary'
import type { EvidenceSummary, LexemeDecisionResult } from '@/lib/lexemes'
import { asSentenceText } from '@/lib/text'
import type { SentenceTokens } from '@/lib/tokens'

/**
 * P2 reader 组件 props / 测试 fixture（P2-frontend 发布给 P3 的 reader 面）。
 *
 * 边界声明：这不是第二份 API 契约。API 契约唯一来源是生成的
 * `backend/fixtures/openapi.json` 与 `backend/fixtures/reader-fixture.json`；
 * 本文件只提供组件 props 形状的本地示例数据：
 * - `fixtureSentenceTokens` 照抄生成 reader fixture 的 `tokens/txt`
 *   （完整 token 表，含 BMP 外安全的 code point 区间）；
 * - `fixtureLookupResult` / `fixtureSearchResult` / `fixtureDecision` /
 *   `fixtureEvidenceSummary` 照抄对应 fixture 条目；
 * - `fixtureDictionaries` 照抄 `dictionary/source.source`。
 * 一致性由 `p2-frontend.contract.test.ts` 对生成产物锁定。
 */

export const fixtureDictionaries: DictionarySource[] = [
  {
    id: 'fixture-id-001',
    format: 'yomitan_zip',
    display_name: 'fixture-辞書',
    source_version: '2026-09-12',
    schema_version: 'term_bank_v1',
    archive_hash: '6c3605f62adbe92730cf5df4d6f50990663413370987a2117baea74f30e3ceea',
    imported_at: 'fixture-timestamp',
  },
]

export const fixtureSentenceTokens: SentenceTokens = {
  sentence_id: 'fixture-id-003',
  material_id: 'fixture-id-004',
  sidecar_generation_id: 'fixture-id-005',
  segmenter_version: 'learningj-segmenter-v1',
  tokenizer_version: '0.6.11',
  analyzer_dict_version: '20260723',
  dictionary_sources: [
    { source_id: 'fixture-id-001', display_name: 'fixture-辞書', source_version: '2026-09-12' },
  ],
  tokens: [
    {
      surface: asSentenceText('次'),
      normalized_form: '次',
      pos: '名詞,普通名詞,一般,*,*,*',
      reading_form: 'ツギ',
      reading_source: 'sudachi',
      lexeme_id: 'lx_f7b9336979d127199e41f12a8b8d1470a9b412c158b5c8813589cb20033ac080',
      char_start: 0,
      char_end: 1,
      dictionary_source_ids: ['fixture-id-001'],
    },
    {
      surface: asSentenceText('は'),
      normalized_form: 'は',
      pos: '助詞,係助詞,*,*,*,*',
      reading_form: 'ハ',
      reading_source: 'sudachi',
      lexeme_id: 'lx_f85e7a1387f9abb0a6b0a25211cf920f6470a6177eaba9f5e96b37d64de57c09',
      char_start: 1,
      char_end: 2,
      dictionary_source_ids: [],
    },
    {
      surface: asSentenceText('君'),
      normalized_form: '君',
      pos: '代名詞,*,*,*,*,*',
      reading_form: 'キミ',
      reading_source: 'sudachi',
      lexeme_id: 'lx_da636c71bab3557686de138257d58e6dec4abbbfc2eaabfac6c70ca7eb5d5150',
      char_start: 2,
      char_end: 3,
      dictionary_source_ids: ['fixture-id-001'],
    },
    {
      surface: asSentenceText('の'),
      normalized_form: 'の',
      pos: '助詞,格助詞,*,*,*,*',
      reading_form: 'ノ',
      reading_source: 'sudachi',
      lexeme_id: 'lx_46795d7cb728bc3bb90eadd1224a109e9a016e6d4ff53d5311702f797c300596',
      char_start: 3,
      char_end: 4,
      dictionary_source_ids: [],
    },
    {
      surface: asSentenceText('番'),
      normalized_form: '番',
      pos: '名詞,普通名詞,助数詞可能,*,*,*',
      reading_form: 'バン',
      reading_source: 'sudachi',
      lexeme_id: 'lx_8570418e7ff221f3975335d3adde76c305a10ea7ce3bb142b6c02f6137e372ae',
      char_start: 4,
      char_end: 5,
      dictionary_source_ids: ['fixture-id-001'],
    },
    {
      surface: asSentenceText('です'),
      normalized_form: 'です',
      pos: '助動詞,*,*,*,助動詞-デス,終止形-一般',
      reading_form: 'デス',
      reading_source: 'sudachi',
      lexeme_id: 'lx_27bd2ce237c1cf6b65cddf139f26254b7a76a3ba9f7e7b7d6465bd90dd696333',
      char_start: 5,
      char_end: 7,
      dictionary_source_ids: [],
    },
    {
      surface: asSentenceText('！'),
      normalized_form: '!',
      pos: '補助記号,句点,*,*,*,*',
      reading_form: '!',
      reading_source: 'sudachi',
      lexeme_id: 'lx_7b1497a24f7f43c2e9c4cd2b0f1c9c222253a979f337fc19242b07560f80fccc',
      char_start: 7,
      char_end: 8,
      dictionary_source_ids: [],
    },
  ],
}

/** The generated P2 subtitle token fixture, retained separately from txt. */
export const fixtureSubtitleSentenceTokens: SentenceTokens = {
  sentence_id: 'fixture-id-006', material_id: 'fixture-id-007', sidecar_generation_id: 'fixture-id-008',
  segmenter_version: 'learningj-segmenter-v1', tokenizer_version: '0.6.11', analyzer_dict_version: '20260723', dictionary_sources: [],
  tokens: [
    { surface: asSentenceText('また'), normalized_form: '又', pos: '接続詞,*,*,*,*,*', reading_form: 'マタ', reading_source: 'sudachi', lexeme_id: 'lx_daf6c367c1bea91f9e4fbc38d1de093ae0a5b24e64576ae256ae71f03590b4a9', char_start: 0, char_end: 2, dictionary_source_ids: [] },
    { surface: asSentenceText('寄っ'), normalized_form: '寄る', pos: '動詞,一般,*,*,五段-ラ行,連用形-促音便', reading_form: 'ヨッ', reading_source: 'sudachi', lexeme_id: 'lx_a3c51c40815583e5077e5305bbc5d96cec57f67871acff63bd6575f8ca31ccda', char_start: 2, char_end: 4, dictionary_source_ids: [] },
    { surface: asSentenceText('て'), normalized_form: 'て', pos: '助詞,接続助詞,*,*,*,*', reading_form: 'テ', reading_source: 'sudachi', lexeme_id: 'lx_e8b3f906c9981bbfd22163cd4777dc5daff759f0b696551005320c3528edbe1d', char_start: 4, char_end: 5, dictionary_source_ids: [] },
    { surface: asSentenceText('しまっ'), normalized_form: '仕舞う', pos: '動詞,非自立可能,*,*,五段-ワア行,連用形-促音便', reading_form: 'シマッ', reading_source: 'sudachi', lexeme_id: 'lx_0c649983d58b41e9d3513bbd9a28b0b586b2d0d735dbc5d045604acfd510ea45', char_start: 5, char_end: 8, dictionary_source_ids: [] },
    { surface: asSentenceText('た'), normalized_form: 'た', pos: '助動詞,*,*,*,助動詞-タ,終止形-一般', reading_form: 'タ', reading_source: 'sudachi', lexeme_id: 'lx_621560ee20f258b69e3d35cda37560af3002dded248372c5ec3ec2c9cdaa6624', char_start: 8, char_end: 9, dictionary_source_ids: [] },
    { surface: asSentenceText('。'), normalized_form: '。', pos: '補助記号,句点,*,*,*,*', reading_form: '。', reading_source: 'sudachi', lexeme_id: 'lx_9ca0779be06cdd19bcb8577014b30bdcf35ed0aae61773d3f3e62641deaf0bac', char_start: 9, char_end: 10, dictionary_source_ids: [] },
  ],
}

export const fixtureAnnotations = [{
  id: 'fixture-id-009', material_id: 'fixture-id-004', created_at: 'fixture-timestamp', note: 'fixture-annotation', color: 'yellow' as const,
  spans: [{ span_id: 'fixture-id-010', sentence_id: 'fixture-id-011', surface: asSentenceText('𠮟られた'), char_start: 0, char_end: 4, alignment_sidecar_id: 'fixture-id-005', token_start: 0, token_end: 3, alignment_status: 'aligned' as const }],
}]

export const fixtureLookupResult: DictionaryLookupResult = {
  expression: '君',
  reading: null,
  entries: [
    {
      source_id: 'fixture-id-001',
      display_name: 'fixture-辞書',
      source_version: '2026-09-12',
      source_local_id: 'term_bank_1.json:0',
      expression: '君',
      reading: 'きみ',
      tags: ['代名詞'],
      score: 8,
      sequence: 0,
      definitions: [
        { ordinal: 0, plain_text: 'you', structured_content: null },
        { ordinal: 1, plain_text: '第二人称代词', structured_content: { text: '第二人称代词', type: 'text' } },
      ],
    },
  ],
}

export const fixtureSearchResult: DictionarySearchResult = {
  query: '頑',
  entries: [
    {
      source_id: 'fixture-id-001',
      display_name: 'fixture-辞書',
      source_version: '2026-09-12',
      source_local_id: 'term_bank_1.json:3',
      expression: '頑張る',
      reading: 'がんばる',
      tags: ['動詞', 'v5'],
      score: 9,
      sequence: 3,
      definitions: [
        { ordinal: 0, plain_text: 'to persevere', structured_content: null },
        { ordinal: 1, plain_text: "to do one's best", structured_content: null },
      ],
    },
  ],
}

export const fixtureDecision: LexemeDecisionResult = {
  decision_id: 'fixture-id-012',
  lexeme_id: 'lx_da636c71bab3557686de138257d58e6dec4abbbfc2eaabfac6c70ca7eb5d5150',
  scope_form_key: 'lexeme:',
  decision: 'known',
  decision_seq: 1,
  operation_key: 'fixture-known-jun',
  created_at: 'fixture-timestamp',
  created: true,
  evidence_id: 'fixture-id-013',
  conjugated_form: null,
}

export const fixtureEvidenceSummary: EvidenceSummary = {
  lexeme_id: 'lx_da636c71bab3557686de138257d58e6dec4abbbfc2eaabfac6c70ca7eb5d5150',
  projection_revision: 1,
  scopes: [
    {
      scope_form_key: 'lexeme:',
      current_decision: 'known',
      current_decision_id: 'fixture-id-012',
      current_decision_seq: 1,
      valid_source_counts: { user_asserted: 1 },
      known_rule_version: 'learningj-known-rule-v1',
      resolver_version: 'learningj-scope-resolver-v1',
      input_revision: 1,
    },
  ],
}

/**
 * 无裁定的 Lexeme 摘要（本地构造示例）：真实后端对从未裁定的词元返回
 * 空 scopes 数组（已对运行中的重建库实测），客户端把「摘要已加载但无
 * `lexeme:` 行」解释为未裁定、expected_decision_seq 预期 0。
 */
export const fixtureEvidenceSummaryUndecided: EvidenceSummary = {
  lexeme_id: 'lx_f7b9336979d127199e41f12a8b8d1470a9b412c158b5c8813589cb20033ac080',
  projection_revision: 0,
  scopes: [],
}
