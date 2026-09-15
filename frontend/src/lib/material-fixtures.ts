import type {
  Material,
  MaterialLexemeCounts,
  Sentence,
  Sidecar,
} from '@/lib/materials'

/**
 * 组件 props / 测试 fixture（P1-frontend 发布给 P2 的素材面）。
 *
 * 边界声明：这不是第二份 API 契约。API 契约唯一来源是生成的
 * `backend/fixtures/openapi.json` 与 `backend/fixtures/material-fixture.json`；
 * 本文件只提供组件 props 形状的本地示例数据：
 * - txt / srt 条目照抄生成 fixture 的取值（plain_text / subtitle 锚点）。
 * - EPUB 条目补齐生成 fixture 未覆盖的第三种锚点，形状严格按
 *   data-model §8.2「锚点取值」表（`{spine_index, char_start, char_end}`）
 *   与 OpenAPI `SentenceOut`，字段不做任何契约扩展。
 * - `unavailableAnchorSentence` 覆盖「定位不可用」展示分支。
 */

export const fixtureTextMaterial: Material = {
  id: 'fixture-id-001',
  title: 'fixture-sample',
  author: null,
  content_hash: '9a107a153000cfc6e454f6430708b9b4b7db8f3f76e81dde420ec1c3a3b44a40',
  locator: 'fixture-sample.txt',
  kind: 'text',
  copy_stored: false,
  storage_mode: 'external_reference',
  source_sha256: '9a107a153000cfc6e454f6430708b9b4b7db8f3f76e81dde420ec1c3a3b44a40',
  current_sidecar_id: 'fixture-id-002',
  sentence_count: 3,
}

export const fixtureSubtitleMaterial: Material = {
  id: 'fixture-id-006',
  title: 'fixture-sample',
  author: null,
  content_hash: 'd4e8866e776f2c1011d7df72b7710f378af6b7f8cbcd5739f329bac56a819abb',
  locator: 'fixture-sample.srt',
  kind: 'subtitle_video',
  copy_stored: false,
  storage_mode: 'external_reference',
  source_sha256: '452cac88a6da644d66a7a245ca6b83b2603b803165fe609f7d423551077ade53',
  current_sidecar_id: 'fixture-id-007',
  sentence_count: 2,
}

/** 本地示例：生成 fixture 仅覆盖 txt/srt，epub 形状按 data-model §8.2 构造。 */
export const fixtureEpubMaterial: Material = {
  id: 'local-fixture-epub-001',
  title: 'ローカル fixture 作品',
  author: 'fixture-author',
  content_hash: 'local-fixture-epub-content-hash',
  locator: 'local-fixture-sample.epub',
  kind: 'epub',
  copy_stored: true,
  storage_mode: 'managed_copy',
  source_sha256: 'local-fixture-epub-source-hash',
  current_sidecar_id: null,
  sentence_count: 2,
}

export const fixtureTextSentences: Sentence[] = [
  {
    id: 'fixture-id-003',
    material_id: 'fixture-id-001',
    index: 0,
    text: '𠮟られた。',
    time_start: null,
    time_end: null,
    translation: null,
    anchor_type: 'plain_text',
    anchor_payload: { char_start: 0, char_end: 5 },
  },
  {
    id: 'fixture-id-004',
    material_id: 'fixture-id-001',
    index: 1,
    text: '次は君の番です！',
    time_start: null,
    time_end: null,
    translation: null,
    anchor_type: 'plain_text',
    anchor_payload: { char_start: 5, char_end: 13 },
  },
  {
    id: 'fixture-id-005',
    material_id: 'fixture-id-001',
    index: 2,
    text: '向上心が熱い。',
    time_start: null,
    time_end: null,
    translation: null,
    anchor_type: 'plain_text',
    anchor_payload: { char_start: 15, char_end: 22 },
  },
]

export const fixtureSubtitleSentences: Sentence[] = [
  {
    id: 'fixture-id-008',
    material_id: 'fixture-id-006',
    index: 0,
    text: 'また寄ってしまった。',
    time_start: 1000,
    time_end: 4200,
    translation: null,
    anchor_type: 'subtitle',
    anchor_payload: { cue_index: 0 },
  },
  {
    id: 'fixture-id-009',
    material_id: 'fixture-id-006',
    index: 1,
    text: '今日も頑張ろう。',
    time_start: 4400,
    time_end: 8000,
    translation: null,
    anchor_type: 'subtitle',
    anchor_payload: { cue_index: 1 },
  },
]

export const fixtureEpubSentences: Sentence[] = [
  {
    id: 'local-fixture-epub-002',
    material_id: 'local-fixture-epub-001',
    index: 0,
    text: '峠のかなたに何があるのか。',
    time_start: null,
    time_end: null,
    translation: null,
    anchor_type: 'epub',
    anchor_payload: { spine_index: 2, char_start: 0, char_end: 13 },
  },
  {
    id: 'local-fixture-epub-003',
    material_id: 'local-fixture-epub-001',
    index: 1,
    text: '問題の挿絵はここにある。',
    time_start: null,
    time_end: null,
    translation: null,
    anchor_type: 'epub',
    anchor_payload: { spine_index: 4, char_start: 8, char_end: 16 },
  },
]

/** 非法锚点取值必须呈现「定位不可用」，不得虚构 spine 0 或偏移 0。 */
export const unavailableAnchorSentence: Sentence = {
  id: 'local-fixture-unavailable-001',
  material_id: 'local-fixture-epub-001',
  index: 2,
  text: 'この文の定位は壊れている。',
  time_start: null,
  time_end: null,
  translation: null,
  anchor_type: 'epub',
  anchor_payload: { spine_index: -3, char_start: 0, char_end: 5 },
}

export const fixtureSidecar: Sidecar = {
  material_id: 'fixture-id-001',
  sidecar_generation_id: 'fixture-id-002',
  content_hash: '9a107a153000cfc6e454f6430708b9b4b7db8f3f76e81dde420ec1c3a3b44a40',
  segmenter_version: 'learningj-segmenter-v1',
  tokenizer_version: '0.6.11',
  analyzer_dict_version: '20260723',
  payload: { sentences: [] },
}

/** 照抄生成 fixture 的 `lexeme-counts/txt`（15 条稀疏词频，共 16 token）。 */
export const fixtureLexemeCounts: MaterialLexemeCounts = {
  material_id: 'fixture-id-001',
  sidecar_generation_id: 'fixture-id-002',
  counts: [
    { lexeme_id: 'lx_1a62aff490e05c2929730add79879139fa7d2d7a2893af3354c407901f049f78', token_count: 1 },
    { lexeme_id: 'lx_27bd2ce237c1cf6b65cddf139f26254b7a76a3ba9f7e7b7d6465bd90dd696333', token_count: 1 },
    { lexeme_id: 'lx_29dfe58849d53f568a5891e23db8b3f365f61f7636e959b622cfc586569fa6d9', token_count: 1 },
    { lexeme_id: 'lx_46795d7cb728bc3bb90eadd1224a109e9a016e6d4ff53d5311702f797c300596', token_count: 1 },
    { lexeme_id: 'lx_621560ee20f258b69e3d35cda37560af3002dded248372c5ec3ec2c9cdaa6624', token_count: 1 },
    { lexeme_id: 'lx_6570645c6f8cef3036f34b53e7d98faf121c3b1103f0c82c177ae9dbc7c335ce', token_count: 1 },
    { lexeme_id: 'lx_7b1497a24f7f43c2e9c4cd2b0f1c9c222253a979f337fc19242b07560f80fccc', token_count: 1 },
    { lexeme_id: 'lx_8570418e7ff221f3975335d3adde76c305a10ea7ce3bb142b6c02f6137e372ae', token_count: 1 },
    { lexeme_id: 'lx_8d1b5e0eb5c96148b739b7cd2b5e270b47946375acfece9aeb3e43a0acbd0f7b', token_count: 1 },
    { lexeme_id: 'lx_9385ad1428a73f6aed1f0dec4414ec1172592e3b46f39c8bb7f825123fc67c66', token_count: 1 },
    { lexeme_id: 'lx_9ca0779be06cdd19bcb8577014b30bdcf35ed0aae61773d3f3e62641deaf0bac', token_count: 2 },
    { lexeme_id: 'lx_9fa24af7c9cfe605e4c3677cbc67153e39746c35ff7dd83e0a513abc8e44caa5', token_count: 1 },
    { lexeme_id: 'lx_da636c71bab3557686de138257d58e6dec4abbbfc2eaabfac6c70ca7eb5d5150', token_count: 1 },
    { lexeme_id: 'lx_f7b9336979d127199e41f12a8b8d1470a9b412c158b5c8813589cb20033ac080', token_count: 1 },
    { lexeme_id: 'lx_f85e7a1387f9abb0a6b0a25211cf920f6470a6177eaba9f5e96b37d64de57c09', token_count: 1 },
  ],
}
