"""KnowledgePoint 层：KP、Alias、Occurrence（`data-model.md` §3，ADR-005、ADR-019）。

- KP 由一次**显式指认**构成；MVP 内唯一指认来源是解析抽取。
- `anchor` 是自然键（数据库唯一约束），`kp_id` 是自签发主键；
  主键是形式级，不是义项级。
- 合并永不原地改写：合并写入 `canonical_id`，Occurrence 保持指向它当初
  指向的 `kp_id`，查询时经 canonical 视图归并，合并可撤销。
- Occurrence 无条件记录、永不去重（ADR-019 第一层闸门）。
"""

from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from learningj.db.base import Base, Timestamped, UuidPk
from learningj.db.types import json_list, str_enum
from learningj.domain.enums import (
    AliasSource,
    AnchorShape,
    KpOrigin,
    OccurrenceContentSource,
    OpaqueReason,
    Retention,
    Salience,
)
from learningj.domain.ids import new_uuid7


class KnowledgePoint(Timestamped, Base):
    __tablename__ = "knowledge_points"
    __table_args__ = (
        CheckConstraint(
            "anchor_shape != 'pattern' OR pattern_grammar_version IS NOT NULL",
            name="pattern_has_grammar_version",
        ),
        CheckConstraint(
            "anchor_shape != 'opaque' OR opaque_reason IS NOT NULL",
            name="opaque_has_reason",
        ),
    )

    # 自签发主键。
    kp_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), primary_key=True, default=new_uuid7
    )
    # 自然键：符合形态规范的锚点串；同一 anchor 不重复建 KP（§9 不变量 11）。
    anchor: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    # [不可推迟] 锚点形态判别器（ADR-034）。
    anchor_shape: Mapped[AnchorShape] = mapped_column(
        str_enum(AnchorShape, name="anchor_shape"),
        nullable=False,
    )
    # [不可推迟] 结构化载荷；由 anchor_shape 解释。
    anchor_payload: Mapped[dict[str, Any]] = mapped_column(
        "anchor_payload", type_=type("JSON", (sa.types.TypeDecorator,), {
            "impl": sa.JSON,
            "cache_ok": True,
        })(), nullable=False
    )
    # [不可推迟] pattern 形态时必填；记录用于生成该模式的语法版本。
    pattern_grammar_version: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    # [不可推迟] opaque 形态时必填；model_chosen 或 validation_failed。
    opaque_reason: Mapped[OpaqueReason | None] = mapped_column(
        str_enum(OpaqueReason, name="opaque_reason"),
        nullable=True,
    )
    # [不可推迟] 零槽位模式的词元校验结果；pattern 形态时可选。
    zero_slot_lexeme_check: Mapped[dict[str, Any] | None] = mapped_column(
        "zero_slot_lexeme_check", type_=type("JSON", (sa.types.TypeDecorator,), {
            "impl": sa.JSON,
            "cache_ok": True,
        })(), nullable=True
    )
    # 显示形式；可空，默认由 anchor_payload 渲染得出。
    display_form: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # 多值自由标签（ADR-021）：可为空、可重叠、可后加（并集累加）。
    # 注意：与 AnalysisSection 的 `kind` 是两套定义，不得复用枚举。
    tags: Mapped[list[str]] = mapped_column(json_list(), nullable=False, default=list)
    # [不可推迟] KP 默认复习策略（ADR-041）：不是逐 Occurrence 建卡授权，
    # 也不表示用户已确认。是否已有用户决定由 KnowledgePointRetentionDecision
    # 追加记录判定；自动处理不得覆盖用户决定（§0.1）。
    default_retention: Mapped[Retention] = mapped_column(
        str_enum(Retention, name="kp_default_retention"),
        nullable=False,
        default=Retention.SRS,
    )
    # [不可推迟] 合并指向；空值表示自身即 canonical。撤销合并即清空本字段。
    canonical_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("knowledge_points.kp_id"), nullable=True
    )
    # 可空、可多；仅作检索索引（lexeme_id 串列表），不参与身份判定。
    lexical_anchors: Mapped[list[str] | None] = mapped_column(json_list(), nullable=True)
    origin: Mapped[KpOrigin] = mapped_column(
        str_enum(KpOrigin, name="kp_origin"),
        nullable=False,
        default=KpOrigin.EXTRACTION,
    )


class Alias(UuidPk, Timestamped, Base):
    __tablename__ = "aliases"
    __table_args__ = (UniqueConstraint("kp_id", "alias_string"),)

    alias_string: Mapped[str] = mapped_column(String(512), nullable=False)
    kp_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_points.kp_id"), nullable=False, index=True
    )
    source: Mapped[AliasSource] = mapped_column(
        str_enum(AliasSource, name="alias_source"), nullable=False
    )
    # 别名表只服务 KP 层；Lexeme 不进此表（§9 不变量 8 的另一半）。
    # 外键保证写入目标必须是已存在的 KP。


class Occurrence(UuidPk, Timestamped, Base):
    __tablename__ = "occurrences"
    __table_args__ = (
        # 内容引用 = (逻辑小节, 版本号)，指向 analysis_sections 的唯一键
        # （§4.3 版本约束）；不得用字符区间指向解析原文。
        ForeignKeyConstraint(
            ["section_id", "section_revision"],
            ["analysis_sections.section_id", "analysis_sections.revision"],
            name="fk_occurrences_section_version",
        ),
        CheckConstraint(
            "content_source != 'analysis_section' OR ("
            "brief IS NOT NULL AND section_id IS NOT NULL AND section_revision IS NOT NULL)",
            name="analysis_section_content_reference",
        ),
    )

    kp_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_points.kp_id"), nullable=False, index=True
    )
    sentence_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sentences.id"), nullable=False, index=True
    )
    material_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("materials.id"), nullable=False, index=True
    )
    # [不可推迟] 该知识点在原句中的位置：物理上经 occurrence_spans 关联
    # （MVP 恰好一条 Span）。
    salience: Mapped[Salience] = mapped_column(
        str_enum(Salience, name="occurrence_salience"), nullable=False
    )
    # 该次讲解的要点摘要；content_source = analysis_section 时必填（见 CHECK）。
    brief: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_source: Mapped[OccurrenceContentSource] = mapped_column(
        str_enum(OccurrenceContentSource, name="occurrence_content_source"),
        nullable=False,
        default=OccurrenceContentSource.ANALYSIS_SECTION,
    )
    # [不可推迟] 指向 AnalysisSection 的逻辑小节 + 引用时的版本号。
    section_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    section_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # [不可推迟] 槽位绑定：pattern 形态 KP 的槽位 ID 到 span_id 的映射。
    # 格式：{"N1": "span-uuid", "V1": "span-uuid", ...}
    slot_bindings: Mapped[dict[str, Any] | None] = mapped_column(
        "slot_bindings", type_=type("JSON", (sa.types.TypeDecorator,), {
            "impl": sa.JSON,
            "cache_ok": True,
        })(), nullable=True
    )
    source_analysis_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analyses.id"), nullable=False, index=True
    )
    extraction_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("extraction_runs.id"), nullable=False, index=True
    )
    extractor_model: Mapped[str] = mapped_column(String(255), nullable=False)
    extractor_prompt_version: Mapped[str] = mapped_column(String(255), nullable=False)
    # 三态：未评价 / 有用 / 无用。
    user_marked_useful: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
