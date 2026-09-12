"""Lexeme 层与已知状态证据（`data-model.md` §2.1、§2.2、§2.5，ADR-006/040）。

Lexeme 是算法构成的自然键实体，**不是知识点**：无自签发主键、无
`canonical_id`、不进别名表、不需要合并。它不参与 KnowledgePoint 的 ID
空间（ADR-005）。已知状态是证据之上的派生视图，不落库为字段；
证据的目标是 Lexeme，不是 KnowledgePoint。

§2.2（P2 落地面）：

- KE 与 `LexemeKnowledgeDecision` 共用 `domain/scopes.py` 的
  `scope_form_key` 派生规则；KE 行按 `(lexeme_id, scope_form_key)` 索引，
  导入唯一性归 `(import_run_id, …)`（P2-known-import 补 FK）；
- 决定追加保存，`(lexeme_id, scope_form_key, decision_seq)` 唯一且有序，
  读取当前决定取最新序号，不扫描全库（§11.1）；
- `KnownEvidenceRetraction` 追加记录误操作撤回；evidence_id 与
  import_run_id 恰好一个非空且分别唯一。import_run_id 的外键目标
  `KnownImportRun` 属 P2-known-import 切片，该切片落地时补建；
- `LexemeEvidenceSummary` 是可重建投影：同一写事务内更新受影响作用域，
  `lexeme_projection_state.revision` 是持久变更序列（§11.2）；
- import_run_id / session_id 列随其生产者切片（known-import / P3a）补建，
  当前最小字段原则（plan P3a「新实体只落地实际需要的最小字段」）。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from learningj.db.base import Base, Timestamped, UuidPk, utcnow
from learningj.db.types import json_dict, str_enum
from learningj.domain.enums import (
    KnownEvidenceSource,
    KnownObservedAtBasis,
    LexemeDecision,
)


class Lexeme(Timestamped, Base):
    __tablename__ = "lexemes"
    __table_args__ = (UniqueConstraint("normalized_form", "pos", "reading_form"),)

    # 确定性派生 id（见 `domain/lexeme.py`），非自签发。
    lexeme_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    normalized_form: Mapped[str] = mapped_column(String(512), nullable=False)
    pos: Mapped[str] = mapped_column(String(255), nullable=False)
    reading_form: Mapped[str] = mapped_column(String(512), nullable=False)
    # [不可推迟] 首次产生该记录时的 SudachiDict 版本。
    # 注意：不参与 lexeme_id 派生（§2.1 约束 1）。
    first_seen_analyzer_dict_version: Mapped[str] = mapped_column(
        String(255), nullable=False
    )
    # 不得使用 Sudachi 内部 word id 作持久锚点——它随词典构建变动。


class KnownEvidence(UuidPk, Timestamped, Base):
    __tablename__ = "known_evidence"
    __table_args__ = (
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="confidence_range"),
        # §11.1 最小索引访问路径：按 (lexeme_id, scope_form_key, source,
        # observed_at) 取目标集合，不全扫历史。
        Index(
            "ix_known_evidence_scope",
            "lexeme_id",
            "scope_form_key",
            "source",
            "observed_at",
        ),
    )

    # [不可推迟] 证据目标是 Lexeme，不是 KnowledgePoint（ADR-006）。
    # 该外键同时是 §9 不变量 8 的数据层保证：KP 不可能出现在 target 位。
    lexeme_id: Mapped[str] = mapped_column(
        ForeignKey("lexemes.lexeme_id"), nullable=False
    )
    # [不可推迟] 本次遇到的活用形表层；空值表示证据不针对具体词形。
    conjugated_form: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # [不可推迟] 由 conjugated_form 按 §0 规则派生（domain/scopes.py），
    # 不由调用方自由填写；唯一性与查询索引据此表达（不依赖 NULL 行为）。
    scope_form_key: Mapped[str] = mapped_column(String(600), nullable=False)
    source: Mapped[KnownEvidenceSource] = mapped_column(
        str_enum(KnownEvidenceSource, name="known_evidence_source"), nullable=False
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # observed_at 的时间依据（user_action / external / imported_at）。
    observed_at_basis: Mapped[KnownObservedAtBasis] = mapped_column(
        str_enum(KnownObservedAtBasis, name="known_observed_at_basis"), nullable=False
    )
    # [不可推迟] 产生该证据时的 SudachiDict 版本。
    analyzer_dict_version: Mapped[str] = mapped_column(String(255), nullable=False)
    # [不可推迟] 消解规则版本（把输入映射到 Lexeme + 作用域键的规则）。
    resolver_version: Mapped[str] = mapped_column(String(255), nullable=False)
    # 断言或导入的原始词串及可用读音；与规范化三元组分开，支持审计与重消解。
    input_surface: Mapped[str] = mapped_column(Text, nullable=False)
    input_reading: Mapped[str | None] = mapped_column(Text, nullable=True)
    material_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("materials.id"), nullable=True
    )
    # 写入幂等键：同键同输入返回原结果，同键异输入拒绝。
    # session_id / import_run_id 随 P3a / P2-known-import 生产者切片补建。
    operation_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)


class LexemeKnowledgeDecision(UuidPk, Timestamped, Base):
    """用户当前裁定（追加保存；`data-model.md` §2.2，ADR-040）。

    每个 `(lexeme_id, scope_form_key)` 只取最新 decision_seq；known 必须引用
    同次提交、同目标同作用域的 user_asserted KE（CHECK 承载必要条件，
    引用一致性由 `evidence/service.py` 同事务写入保证）。
    """

    __tablename__ = "lexeme_knowledge_decisions"
    __table_args__ = (
        # §0：decision_seq 在 (lexeme_id, scope_form_key) 内单调递增且唯一。
        UniqueConstraint("lexeme_id", "scope_form_key", "decision_seq"),
        CheckConstraint(
            "(decision = 'known') = (evidence_id IS NOT NULL)",
            name="known_requires_evidence_reference",
        ),
    )

    lexeme_id: Mapped[str] = mapped_column(
        ForeignKey("lexemes.lexeme_id"), nullable=False
    )
    conjugated_form: Mapped[str | None] = mapped_column(String(512), nullable=True)
    scope_form_key: Mapped[str] = mapped_column(String(600), nullable=False)
    # 作出目标判断时的身份口径；迁移不改写旧裁定。
    analyzer_dict_version: Mapped[str] = mapped_column(String(255), nullable=False)
    decision: Mapped[LexemeDecision] = mapped_column(
        str_enum(LexemeDecision, name="lexeme_decision"), nullable=False
    )
    evidence_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("known_evidence.id"), nullable=True
    )
    decision_seq: Mapped[int] = mapped_column(Integer, nullable=False)
    operation_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)


class KnownEvidenceRetraction(UuidPk, Timestamped, Base):
    """来源撤回（追加保存；`data-model.md` §2.2，ADR-040）。

    两个目标键恰好一个非空，分别唯一：单条 KE 或整个已发布导入运行。
    `import_run_id` 的外键目标 `KnownImportRun` 属 P2-known-import 切片，
    落地时补建；本表形状（恰一非空 CHECK、分别唯一）已按契约就位。
    """

    __tablename__ = "known_evidence_retractions"
    __table_args__ = (
        CheckConstraint(
            "(evidence_id IS NOT NULL) != (import_run_id IS NOT NULL)",
            name="exactly_one_retraction_target",
        ),
        UniqueConstraint("evidence_id", name="one_retraction_per_evidence"),
        UniqueConstraint("import_run_id", name="one_retraction_per_import_run"),
    )

    evidence_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("known_evidence.id"), nullable=True
    )
    import_run_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    operation_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)


class LexemeEvidenceSummary(Timestamped, Base):
    """按词证据摘要投影（`data-model.md` §2.5，可重建）。

    以 `(lexeme_id, scope_form_key)` 为粒度；所有证据/裁定/撤回写入在**同一
    事务**内更新受影响作用域（§2.2、§11.2），`input_revision` 取自
    `lexeme_projection_state` 的持久变更序列。撤回与 clear 的效果在重建后
    保持：本行永远可以从事实表完整重算。
    """

    __tablename__ = "lexeme_evidence_summaries"

    lexeme_id: Mapped[str] = mapped_column(
        ForeignKey("lexemes.lexeme_id"), primary_key=True
    )
    scope_form_key: Mapped[str] = mapped_column(String(600), primary_key=True)
    current_decision: Mapped[LexemeDecision | None] = mapped_column(
        str_enum(LexemeDecision, name="lexeme_decision_summary"), nullable=True
    )
    current_decision_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("lexeme_knowledge_decisions.id"), nullable=True
    )
    current_decision_seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 当前 known 决定引用的 user_asserted KE（追溯入口）。
    known_evidence_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("known_evidence.id"), nullable=True
    )
    # 有效（未被撤回）来源支持计数，按 source 枚举值分桶。
    valid_source_counts: Mapped[dict[str, Any]] = mapped_column(
        json_dict(), nullable=False, default=dict
    )
    input_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    known_rule_version: Mapped[str] = mapped_column(String(255), nullable=False)
    resolver_version: Mapped[str] = mapped_column(String(255), nullable=False)


class LexemeProjectionState(Base):
    """证据投影的持久变更序列（§11.2 的等价变更记录）。

    单行表；证据／裁定／撤回写入在同一事务内递增 revision，受影响作用域
    的摘要行携带新 revision。摘要可随时从事实表重建，该计数器用于缓存
    一致性核对与后续异步消费者的游标。
    """

    __tablename__ = "lexeme_projection_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
