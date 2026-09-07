"""Lexeme 层与已知状态证据（`data-model.md` §2.1、§2.2，ADR-006）。

Lexeme 是算法构成的自然键实体，**不是知识点**：无自签发主键、无
`canonical_id`、不进别名表、不需要合并。它不参与 KnowledgePoint 的 ID
空间（ADR-005）。已知状态是证据之上的派生视图，不落库为字段；
证据的目标是 Lexeme，不是 KnowledgePoint。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from learningj.db.base import Base, Timestamped, UuidPk
from learningj.db.types import str_enum
from learningj.domain.enums import KnownEvidenceSource


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
    )

    # [不可推迟] 证据目标是 Lexeme，不是 KnowledgePoint（ADR-006）。
    # 该外键同时是 §9 不变量 8 的数据层保证：KP 不可能出现在 target 位。
    lexeme_id: Mapped[str] = mapped_column(
        ForeignKey("lexemes.lexeme_id"), nullable=False, index=True
    )
    # [不可推迟] 本次遇到的活用形表层；空值表示证据不针对具体词形。
    conjugated_form: Mapped[str | None] = mapped_column(String(512), nullable=True)
    source: Mapped[KnownEvidenceSource] = mapped_column(
        str_enum(KnownEvidenceSource, name="known_evidence_source"), nullable=False
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # [不可推迟] 产生该证据时的 SudachiDict 版本。
    analyzer_dict_version: Mapped[str] = mapped_column(String(255), nullable=False)
    material_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("materials.id"), nullable=True
    )
