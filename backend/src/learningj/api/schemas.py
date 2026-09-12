"""Pydantic API 模型（`docs/mvp-tech-and-phases.md` §3 P0 第 4 条）。

统一 Pydantic/API 模型与 OpenAPI 生成入口：现有素材端点的响应形状
在这里定义一次，路由经 `response_model` 引用，前端以后从 OpenAPI
生成类型，不再手写平行契约。P0 不定义任何 Analysis/Session/KP 模型——
不存在的能力不进契约面。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, Field

MaterialKindLiteral = Literal["subtitle_video", "subtitle_audio", "text", "epub"]
MaterialStorageModeLiteral = Literal["external_reference", "managed_copy"]
SentenceAnchorTypeLiteral = Literal["subtitle", "plain_text", "epub"]
AlignmentStatusLiteral = Literal["aligned", "partial", "ambiguous", "unaligned"]
LexemeDecisionLiteral = Literal["known", "unknown", "clear"]


class MaterialOut(BaseModel):
    """`GET /materials` / `POST /materials` 的响应（data-model §8.1 +
    素材无关抽象 §8.2；`sentence_count` 是列表视图的读投影）。"""

    id: str
    title: str
    content_hash: str
    locator: str
    kind: MaterialKindLiteral
    copy_stored: bool
    storage_mode: MaterialStorageModeLiteral
    source_sha256: str | None = None
    current_sidecar_id: str | None = None
    sentence_count: int


class SentenceOut(BaseModel):
    """`GET /materials/{material_id}/sentences` 的响应；`text` 与
    `anchor_payload` 的偏移均为 Unicode code point（data-model §0/§8.2）。"""

    id: str
    material_id: str
    index: int
    text: str
    time_start: int | None = None
    time_end: int | None = None
    translation: str | None = None
    anchor_type: SentenceAnchorTypeLiteral
    anchor_payload: dict[str, Any]


class SidecarOut(BaseModel):
    """`GET /materials/{material_id}/sidecar` 的响应；payload 为
    msgpack 解包后的分句/分词结果（data-model §8.3）。"""

    material_id: str
    sidecar_generation_id: str
    content_hash: str
    segmenter_version: str
    tokenizer_version: str
    analyzer_dict_version: str
    payload: dict[str, Any]


class MaterialLexemeCountOut(BaseModel):
    lexeme_id: str
    token_count: int


class MaterialLexemeCountsOut(BaseModel):
    """One immutable sidecar generation's sparse material token counts."""

    material_id: str
    sidecar_generation_id: str
    counts: list[MaterialLexemeCountOut]


# ---------------------------------------------------------------------------
# P2 算法 token 视图（plan P2 第 1 条；§8.3、ADR-009/018）
# ---------------------------------------------------------------------------


class TokenProvenanceOut(BaseModel):
    """词典来源 provenance（§2.0：查询结果必须带 source/version）。"""

    source_id: str
    display_name: str
    source_version: str


class AlgorithmTokenOut(BaseModel):
    """单个 token：表层、规范化形、POS、reading、code point 半开区间与
    确定性 lexeme_id（ADR-018）。偏移以 Unicode code point 计（§0）。"""

    surface: str
    normalized_form: str
    pos: str
    reading_form: str
    reading_source: str
    lexeme_id: str
    char_start: int
    char_end: int
    dictionary_source_ids: list[str]


class SentenceTokensOut(BaseModel):
    """`GET /sentences/{sentence_id}/tokens` 的响应：当前已发布 sidecar
    代次的 token 视图，带完整版本来源（§8.3 三个版本戳 + 代次 id）。"""

    sentence_id: str
    material_id: str
    sidecar_generation_id: str
    segmenter_version: str
    tokenizer_version: str
    analyzer_dict_version: str
    dictionary_sources: list[TokenProvenanceOut]
    tokens: list[AlgorithmTokenOut]


# ---------------------------------------------------------------------------
# P2 词典（§2.0，ADR-032）
# ---------------------------------------------------------------------------


class DictionarySourceOut(BaseModel):
    id: str
    format: str
    display_name: str
    source_version: str
    schema_version: str
    archive_hash: str
    license_metadata: dict[str, Any] | None = None
    imported_at: str


class DictionaryDefinitionOut(BaseModel):
    """纯文本投影始终可用（资源缺失时定义仍可降级显示）；
    structured_content 保留原始富文本 payload。"""

    ordinal: int
    plain_text: str
    structured_content: dict[str, Any] | None = None


class LookupEntryOut(BaseModel):
    source_id: str
    display_name: str
    source_version: str
    source_local_id: str
    expression: str
    reading: str | None = None
    tags: list[str]
    score: int
    sequence: int | None = None
    definitions: list[DictionaryDefinitionOut]


class DictionaryLookupOut(BaseModel):
    """`GET /dictionaries/lookup`：精确查找；无命中时 entries 为空列表。"""

    expression: str
    reading: str | None = None
    entries: list[LookupEntryOut]


class DictionarySearchOut(BaseModel):
    """`GET /dictionaries/search`：精确匹配优先，FTS5 前缀匹配随后。"""

    query: str
    entries: list[LookupEntryOut]


class DictionaryImportOut(BaseModel):
    """`POST /dictionaries/import`：canonical source + 运行记录；同 archive
    hash 重放时 `idempotent_replay=true` 且不产生新条目。"""

    source: DictionarySourceOut
    run_id: str
    status: str
    stats: dict[str, Any]
    idempotent_replay: bool


# ---------------------------------------------------------------------------
# P2 Annotation（§5，ADR-030）
# ---------------------------------------------------------------------------


class AnnotationSpanIn(BaseModel):
    sentence_id: str
    surface: str


class AnnotationCreateIn(BaseModel):
    spans: list[AnnotationSpanIn]
    note: str | None = None
    color: str | None = None


class AnnotationSpanOut(BaseModel):
    """Span 的 code point 半开区间由后端定位得出，切片恒等于 surface
    （§1 约束 1；§9 不变量 6 的生产行为面）。"""

    span_id: str
    sentence_id: str
    surface: str
    char_start: int
    char_end: int
    token_start: int | None = None
    token_end: int | None = None
    alignment_status: AlignmentStatusLiteral
    alignment_sidecar_id: str | None = None


class AnnotationOut(BaseModel):
    id: str
    material_id: str
    note: str | None = None
    color: str | None = None
    created_at: str
    spans: list[AnnotationSpanOut]


# ---------------------------------------------------------------------------
# P2 Lexeme 证据与用户裁定（§2.2/§2.5，ADR-040）
# ---------------------------------------------------------------------------


class DecisionCreateIn(BaseModel):
    decision: LexemeDecisionLiteral
    input_surface: str
    input_reading: str | None = None
    conjugated_form: str | None = None
    material_id: str | None = None
    operation_key: str
    # Latest decision_seq observed for this scope; every write must carry this
    # optimistic-concurrency token.  Aliases preserve clients that used the
    # generic revision/sequence terminology while keeping one canonical field.
    expected_decision_seq: int = Field(
        ...,
        validation_alias=AliasChoices(
            "expected_decision_seq", "expected_sequence", "expected_seq", "expected_revision"
        ),
    )


class DecisionOut(BaseModel):
    decision_id: str
    lexeme_id: str
    conjugated_form: str | None = None
    scope_form_key: str
    decision: LexemeDecisionLiteral
    decision_seq: int
    evidence_id: str | None = None
    operation_key: str
    created_at: str
    created: bool


class RetractionCreateIn(BaseModel):
    reason: str | None = None
    operation_key: str


class RetractionOut(BaseModel):
    retraction_id: str
    evidence_id: str
    reason: str | None = None
    operation_key: str
    appended_clear: bool
    created: bool
    created_at: str


class EvidenceItemOut(BaseModel):
    evidence_id: str
    source: str
    confidence: float
    observed_at: str
    observed_at_basis: str
    analyzer_dict_version: str
    resolver_version: str
    conjugated_form: str | None = None
    scope_form_key: str
    input_surface: str
    input_reading: str | None = None
    material_id: str | None = None
    retracted: bool
    retraction_id: str | None = None


class EvidenceListOut(BaseModel):
    """`GET /lexemes/{lexeme_id}/evidence`：原始证据分页读取（§2.5）。"""

    lexeme_id: str
    items: list[EvidenceItemOut]


class EvidenceSummaryScopeOut(BaseModel):
    scope_form_key: str
    current_decision: LexemeDecisionLiteral | None = None
    current_decision_seq: int | None = None
    current_decision_id: str | None = None
    known_evidence_id: str | None = None
    valid_source_counts: dict[str, int]
    input_revision: int
    known_rule_version: str
    resolver_version: str


class EvidenceSummaryOut(BaseModel):
    """`GET /lexemes/{lexeme_id}/evidence-summary`：按词证据摘要
    （可重建投影；写路径同事务更新，写后读一致）。"""

    lexeme_id: str
    projection_revision: int
    scopes: list[EvidenceSummaryScopeOut]


class KnownViewIn(BaseModel):
    lexeme_id: str
    form: str | None = None


class KnownViewsBatchIn(BaseModel):
    """阅读器按当前页去重 Lexeme 集合批量取摘要（§11.1），不逐 token 请求。"""

    items: list[KnownViewIn]


class EffectiveKnownOut(BaseModel):
    state: LexemeDecisionLiteral | None = None
    basis: Literal["form_decision", "lexeme_decision", "import_evidence"] | None = None
    decision_id: str | None = None
    evidence_id: str | None = None


class KnownViewItemOut(BaseModel):
    lexeme_id: str
    form: str | None = None
    lexeme_scope: EvidenceSummaryScopeOut | None = None
    form_scope: EvidenceSummaryScopeOut | None = None
    effective: EffectiveKnownOut


class KnownViewsBatchOut(BaseModel):
    known_rule_version: str
    items: list[KnownViewItemOut]
