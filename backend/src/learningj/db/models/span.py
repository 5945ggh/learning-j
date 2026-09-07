"""Span 值对象及其关联表（`data-model.md` §1）。

Span 被四方共用：`Occurrence`、`Annotation`、`AnalysisSection`、以及将来的
可疑句高亮（ADR-014）。物理上是**独立、稳定的 `spans` 表**；实体之间不使用
`owner_type / owner_id` 多态外键，而使用带真实外键的关联表：

- `occurrence_spans(occurrence_id, span_id)`：MVP 中每条 Occurrence 恰好一条；
- `analysis_section_spans(section_version_id, span_id, ordinal)`；
- `annotation_spans(annotation_id, span_id, ordinal)`。

定位规则（ADR-009）：模型只给 `surface`，`char_start` / `char_end` 由后端
`find_all` 定位得出；>1 命中时每处各一个 Span 并全部标 `ambiguous`。
字符区间是权威值；token 区间是 sidecar 对齐的派生值，对齐失败保留
`unaligned`，不得丢弃 Span。跨句 Span 不支持，需要跨句时用有序 Span 数组。
"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKey,
    Integer,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from learningj.db.base import Base, Timestamped
from learningj.db.types import str_enum
from learningj.domain.enums import AlignmentStatus
from learningj.domain.ids import new_uuid7


class Span(Timestamped, Base):
    __tablename__ = "spans"
    __table_args__ = (
        CheckConstraint(
            "char_start >= 0 AND char_end > char_start",
            name="char_range",
        ),
    )

    span_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), primary_key=True, default=new_uuid7
    )
    sentence_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sentences.id"), nullable=False, index=True
    )
    # 定位输入：原文子串，由模型给出（ADR-009）。
    surface: Mapped[str] = mapped_column(Text, nullable=False)
    # 句内 code point 偏移，半开区间 [char_start, char_end)。由后端定位得出，
    # 存储后即权威值。
    char_start: Mapped[int] = mapped_column(Integer, nullable=False)
    char_end: Mapped[int] = mapped_column(Integer, nullable=False)
    # sidecar 分词序列内的 token 索引，派生值，可空。
    token_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    alignment_status: Mapped[AlignmentStatus] = mapped_column(
        str_enum(AlignmentStatus, name="alignment_status"), nullable=False
    )


# 每条 Occurrence 恰好一条 Span（MVP）：occurrence_id 上有唯一约束。
# 添加 ordinal 支持有序 Span 数组，与其他关联表保持一致。
occurrence_spans = Table(
    "occurrence_spans",
    Base.metadata,
    Column("occurrence_id", Uuid(), ForeignKey("occurrences.id"), primary_key=True),
    Column("span_id", Uuid(), ForeignKey("spans.span_id"), primary_key=True),
    Column("ordinal", Integer(), nullable=False),
    UniqueConstraint("occurrence_id", "ordinal"),
    CheckConstraint("ordinal >= 0", name="ordinal_nonnegative"),
)

# 有序 Span 数组：ordinal 保证数组顺序；span 只能指向其自身 sentence_id。
analysis_section_spans = Table(
    "analysis_section_spans",
    Base.metadata,
    Column(
        "section_version_id",
        Uuid(),
        ForeignKey("analysis_sections.section_version_id"),
        primary_key=True,
    ),
    Column("span_id", Uuid(), ForeignKey("spans.span_id"), primary_key=True),
    Column("ordinal", Integer(), nullable=False),
    UniqueConstraint("section_version_id", "ordinal"),
    CheckConstraint("ordinal >= 0", name="ordinal_nonnegative"),
)

annotation_spans = Table(
    "annotation_spans",
    Base.metadata,
    Column("annotation_id", Uuid(), ForeignKey("annotations.id"), primary_key=True),
    Column("span_id", Uuid(), ForeignKey("spans.span_id"), primary_key=True),
    Column("ordinal", Integer(), nullable=False),
    UniqueConstraint("annotation_id", "ordinal"),
    CheckConstraint("ordinal >= 0", name="ordinal_nonnegative"),
)
