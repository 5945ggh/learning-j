"""枚举定义的唯一来源。

`data-model.md` 中所有 enum 字段集中在此定义，db 模型与后续的
Pydantic 契约都引用本模块，避免出现第二份平行定义。

注意（`data-model.md` §4.3 约束 4）：`SectionKind` 与 KnowledgePoint 的
`tags` 是两套东西。`tags` 是自由字符串多值标签（ADR-021），**没有**枚举；
同名值（如 ``grammar``）不得复用同一个枚举定义。
"""

from __future__ import annotations

from enum import Enum


class _StrEnum(str, Enum):
    """以小写值入库的枚举基类（SQLite 中以 VARCHAR 存储）。"""


class AlignmentStatus(_StrEnum):
    """Span 与 token 边界的对齐结果（`data-model.md` §1）。

    `ambiguous`（指哪一处未知）与 `partial`（边界不落在 token 上）是两回事，
    不得混用。
    """

    ALIGNED = "aligned"
    PARTIAL = "partial"
    AMBIGUOUS = "ambiguous"
    UNALIGNED = "unaligned"


class MaterialKind(_StrEnum):
    """素材类型（`data-model.md` §8.1）。上层逻辑不得按该类型分支。"""

    SUBTITLE_VIDEO = "subtitle_video"
    SUBTITLE_AUDIO = "subtitle_audio"
    TEXT = "text"
    EPUB = "epub"


class SentenceAnchorType(_StrEnum):
    """句子位置锚点类型（`data-model.md` §8.2，MVP 三种）。"""

    SUBTITLE = "subtitle"
    PLAIN_TEXT = "plain_text"
    EPUB = "epub"


class KnownEvidenceSource(_StrEnum):
    """已知状态证据来源（`data-model.md` §2.2）。

    `listening_native` 与 `listening_tts` 必须是不同的取值（ADR-016）。
    """

    READING_INFERRED = "reading_inferred"
    ANALYSIS_MARKED = "analysis_marked"
    IMPORT_ANKI = "import_anki"
    IMPORT_JPDB = "import_jpdb"
    SRS_MATURED = "srs_matured"
    LISTENING_NATIVE = "listening_native"
    LISTENING_TTS = "listening_tts"


class Retention(_StrEnum):
    """唯一的学习意愿字段（`data-model.md` §3.1）。"""

    SRS = "srs"
    REFERENCE = "reference"


class RetentionSetBy(_StrEnum):
    """`retention` 的决定者。为 `user` 后，重跑抽取不得覆盖。"""

    DEFAULT = "default"
    USER = "user"


class AnchorShape(_StrEnum):
    """知识点锚点形态判别器（ADR-034）。"""

    PATTERN = "pattern"
    LEXICAL = "lexical"
    ENTITY = "entity"
    OPAQUE = "opaque"


class OpaqueReason(_StrEnum):
    """opaque 形态的原因（ADR-034）。"""

    MODEL_CHOSEN = "model_chosen"
    VALIDATION_FAILED = "validation_failed"


class KpOrigin(_StrEnum):
    """KnowledgePoint 的指认来源。MVP 内唯一取值 `extraction`。"""

    EXTRACTION = "extraction"
    MANUAL = "manual"  # 预留，不进 MVP 流程


class AliasSource(_StrEnum):
    """别名来源（`data-model.md` §3.2）。别名表只服务 KP 层。"""

    SEED = "seed"
    EXTRACTION = "extraction"
    MERGE = "merge"
    MANUAL = "manual"


class Salience(_StrEnum):
    """Occurrence 显著性（`data-model.md` §3.3）。

    决定 ReviewItem 的创建优先级，不决定候选是否构成 KP（ADR-019）。
    """

    PRIMARY = "primary"
    SECONDARY = "secondary"


class OccurrenceContentSource(_StrEnum):
    """Occurrence 内容来源（`data-model.md` §3.3）。MVP 内唯一取值
    `analysis_section`。"""

    ANALYSIS_SECTION = "analysis_section"
    USER_GLOSS = "user_gloss"  # 预留


class ReviewItemStatus(_StrEnum):
    """ReviewItem 排程控制状态（`data-model.md` §7.1，ADR-041）。

    加入决定一旦记录就立即创建 ReviewItem；当日新卡配额不足时为
    `queued`，配额足够、写入 `admitted_at` 并初始化 ReviewState 后才转为
    `active`。reference 是 KP／Occurrence 意愿，表达为对应卡片 `paused`
    （准入前暂停同样使用 paused，但其 `admitted_at` 仍为空）；退役是单向
    终点，与 `retired_at` 非空等价。"""

    QUEUED = "queued"
    ACTIVE = "active"
    PAUSED = "paused"
    RETIRED = "retired"


class ExtractionRunExecutionPath(_StrEnum):
    """抽取执行路径：续轮快路径或独立调用（`data-model.md` §4.2）。"""

    CONTINUED_TURN = "continued_turn"
    STANDALONE = "standalone"


class ExtractionRunStatus(_StrEnum):
    """单次抽取运行的状态（`data-model.md` §4.2）。"""

    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class ExtractionFailureReason(_StrEnum):
    """抽取失败原因（`data-model.md` §4.2）。"""

    INVALID_JSON = "invalid_json"
    EMPTY_CANDIDATES = "empty_candidates"
    ALL_UNRESOLVED = "all_unresolved"
    PROVIDER_ERROR = "provider_error"


class SplitStrategy(_StrEnum):
    """解析正文的切分策略（`data-model.md` §4.3，三级降级）。"""

    HEADING = "heading"
    PARAGRAPH = "paragraph"
    FALLBACK_SINGLE = "fallback_single"


class SectionKind(_StrEnum):
    """AnalysisSection 的 `kind`（`data-model.md` §4.3）。

    kind 集合 = 九个用户可勾选解析模块 + `takeaway` + `qa`。
    抽取完成前允许为空；与 KP 的 `tags` 不是同一套定义。
    """

    OVERVIEW = "overview"
    LEXICAL = "lexical"
    CONJUGATION = "conjugation"
    GRAMMAR = "grammar"
    PARTICLE = "particle"
    COLLOQUIAL = "colloquial"
    REGISTER = "register"
    CULTURE = "culture"
    TRANSLATION_NOTE = "translation_note"
    TAKEAWAY = "takeaway"
    QA = "qa"


class MessageRole(_StrEnum):
    """AnalysisMessage 的角色（`data-model.md` §4.4）。只持久化用户可见的往返。"""

    USER = "user"
    ASSISTANT = "assistant"


class NoteUpdatedBy(_StrEnum):
    """记忆条目的最后写入者（`data-model.md` §6）。"""

    AGENT = "agent"
    USER = "user"


class DictionarySourceFormat(_StrEnum):
    """词典导入格式。MVP 第一等格式是 Yomitan ZIP（ADR-032）；
    其他格式经未来的 `DictionaryImporter` adapter 增加。"""

    YOMITAN_ZIP = "yomitan_zip"


class DictionaryImportRunStatus(_StrEnum):
    """词典导入运行状态（`data-model.md` §2.0）。"""

    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class SrsCardState(_StrEnum):
    """FSRS Card 状态（`docs/mvp-tech-and-phases.md` §1.1，py-fsrs FSRS-5）。"""

    NEW = "new"
    LEARNING = "learning"
    REVIEW = "review"
    RELEARNING = "relearning"
