"""解析文档层：Analysis、ExtractionRun、AnalysisSection、AnalysisMessage
（`data-model.md` §4，ADR-017）。

关键不变的数据层约束：

- Analysis 与 Occurrence 分离持久化；抽取失败只重跑抽取，不重新生成解析；
- AnalysisSection 每个 revision 是一条**独立、不可变的物理行**，
  `(section_id, revision)` 唯一，Occurrence 经该唯一键形成可验证引用；
  旧版本与被合并小节永不删除（`superseded_by` 只追加）；
- AnalysisMessage 只持久化用户可见的往返；`session_closed = true` 后
  不再接受追问。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from learningj.db.base import Base, Timestamped, UuidPk, utcnow
from learningj.db.types import json_list, str_enum
from learningj.domain.enums import (
    AnalysisStatus,
    ExtractionFailureReason,
    ExtractionRunExecutionPath,
    ExtractionRunStatus,
    ExtractionStatus,
    ExtractionTrigger,
    MessageRole,
    SectionKind,
    SplitStrategy,
)
from learningj.domain.ids import new_uuid7


class Analysis(UuidPk, Timestamped, Base):
    __tablename__ = "analyses"
    __table_args__ = (
        # `status = generating` 时 `extraction_status` 必须为 `pending`（§4.1）。
        CheckConstraint(
            "status != 'generating' OR extraction_status = 'pending'",
            name="generating_implies_extraction_pending",
        ),
        CheckConstraint("turn_count >= 1", name="turn_count_positive"),
    )

    sentence_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sentences.id"), nullable=False, index=True
    )
    material_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("materials.id"), nullable=False, index=True
    )
    model: Mapped[str] = mapped_column(String(255), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(255), nullable=False)
    # 本次勾选的解析模块（prompt-contracts §1 的九项）。
    style_modules: Mapped[list[str]] = mapped_column(json_list(), nullable=False, default=list)
    style_free_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_question: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 注入了哪些已有 KP / 记忆条目，用于复现与对照实验。
    context_kp_ids: Mapped[list[str]] = mapped_column(json_list(), nullable=False, default=list)
    context_note_ids: Mapped[list[str]] = mapped_column(json_list(), nullable=False, default=list)
    # MVP 内恒为 false；留位保证将来对照实验的历史数据可比。
    retrieval_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    turn_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # 用户触发抽取后单向关闭；关闭后不得新增 AnalysisMessage。
    session_closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[AnalysisStatus] = mapped_column(
        str_enum(AnalysisStatus, name="analysis_status"), nullable=False
    )
    extraction_status: Mapped[ExtractionStatus] = mapped_column(
        str_enum(ExtractionStatus, name="analysis_extraction_status"),
        nullable=False,
        default=ExtractionStatus.PENDING,
    )
    extraction_trigger: Mapped[ExtractionTrigger] = mapped_column(
        str_enum(ExtractionTrigger, name="analysis_extraction_trigger"),
        nullable=False,
    )


class ExtractionRun(UuidPk, Timestamped, Base):
    __tablename__ = "extraction_runs"
    __table_args__ = (
        CheckConstraint(
            "status = 'running' OR finished_at IS NOT NULL",
            name="finished_runs_have_finished_at",
        ),
        CheckConstraint("candidate_count >= 0", name="candidate_count_nonnegative"),
    )

    analysis_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analyses.id"), nullable=False, index=True
    )
    execution_path: Mapped[ExtractionRunExecutionPath] = mapped_column(
        str_enum(ExtractionRunExecutionPath, name="extraction_run_execution_path"),
        nullable=False,
    )
    model: Mapped[str] = mapped_column(String(255), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[ExtractionRunStatus] = mapped_column(
        str_enum(ExtractionRunStatus, name="extraction_run_status"),
        nullable=False,
        default=ExtractionRunStatus.RUNNING,
    )
    # 指向被重跑的上一次 ExtractionRun；重跑保留旧 run、旧 Occurrence。
    retry_of: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("extraction_runs.id"), nullable=True
    )
    failure_reason: Mapped[ExtractionFailureReason | None] = mapped_column(
        str_enum(ExtractionFailureReason, name="extraction_failure_reason"),
        nullable=True,
    )
    # 原句中找不到的 surface；可为空。失败检测与重跑使用。
    unresolved_surfaces: Mapped[list[str]] = mapped_column(
        json_list(), nullable=False, default=list
    )
    candidate_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class AnalysisSection(Timestamped, Base):
    """解析正文的可寻址单元。**每个 revision 是一条独立、不可变的物理行**：
    本表不提供 UPDATE 语义；改写产生同一 `section_id` 的新 revision 行。"""

    __tablename__ = "analysis_sections"
    __table_args__ = (
        UniqueConstraint("section_id", "revision"),
        CheckConstraint("revision >= 1", name="revision_positive"),
        # superseded_by 只能指向同一逻辑小节下的其他版本行，且不允许自指。
        CheckConstraint(
            "superseded_by IS NULL OR superseded_by != section_version_id",
            name="superseded_not_self",
        ),
    )

    # 具体版本行的实体 id。
    section_version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), primary_key=True, default=new_uuid7
    )
    # 逻辑小节身份；同一逻辑小节的所有版本相同。
    section_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), nullable=False, default=new_uuid7
    )
    analysis_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analyses.id"), nullable=False, index=True
    )
    # 从根到叶的 heading id 路径；降级切分时为空数组。
    heading_path: Mapped[list[str]] = mapped_column(json_list(), nullable=False, default=list)
    split_strategy: Mapped[SplitStrategy] = mapped_column(
        str_enum(SplitStrategy, name="analysis_section_split_strategy"), nullable=False
    )
    # 抽取完成前为空；完成后为九模块 + takeaway + qa 之一（§9 不变量 10）。
    kind: Mapped[SectionKind | None] = mapped_column(
        str_enum(SectionKind, name="analysis_section_kind"), nullable=True
    )
    # 覆盖原句中的哪些位置：物理上经 analysis_section_spans 关联（有序数组）。
    body_md: Mapped[str] = mapped_column(Text, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    origin_turn: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # 指向新的 section_version_id；旧版本不删除。
    superseded_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("analysis_sections.section_version_id"), nullable=True
    )


class AnalysisMessage(UuidPk, Base):
    __tablename__ = "analysis_messages"
    __table_args__ = (
        UniqueConstraint("analysis_id", "turn_index", "role"),
        CheckConstraint("turn_index >= 1", name="turn_index_positive"),
    )

    analysis_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analyses.id"), nullable=False, index=True
    )
    turn_index: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[MessageRole] = mapped_column(
        str_enum(MessageRole, name="analysis_message_role"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
