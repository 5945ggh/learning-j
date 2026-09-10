"""解析文档层：Analysis、ExtractionRun、AnalysisSection、AnalysisMessage
（`data-model.md` §4，ADR-017）。

关键不变的数据层约束：

- Analysis 与 Occurrence 分离持久化；抽取失败只重跑抽取，不重新生成解析；
- AnalysisSection 每个 revision 是一条**独立、不可变的物理行**，
  `(section_id, revision)` 唯一，Occurrence 经该唯一键形成可验证引用；
  旧版本与被合并小节永不删除（`superseded_by` 只追加）；
- AnalysisMessage 只持久化用户可见的往返。

P0 拆债（`docs/mvp-tech-and-phases.md` §3 P0 第 1 条）：旧 Analysis 上的
`status / extraction_status / extraction_trigger / session_closed / turn_count`
是旧原型留下的**第二状态机**，已由前滚迁移删除；会话阶段与运行状态由
StudySession / AgentRun / ExtractionRun 承载（P3a/P3b 落地）。
`model / prompt_version / context_kp_ids / context_note_ids` 保留为
只读历史列，迁移说明见迁移文件。
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
    ExtractionFailureReason,
    ExtractionRunExecutionPath,
    ExtractionRunStatus,
    MessageRole,
    SectionKind,
    SplitStrategy,
)
from learningj.domain.ids import new_uuid7


class Analysis(UuidPk, Timestamped, Base):
    """旧契约遗留的解析文档行。

    P0 起只保留能映射到当前契约（`data-model.md` §4.3）或需保留历史的列；
    会话生命周期归 StudySession（P3a），不再在此维护状态机。
    """

    __tablename__ = "analyses"

    sentence_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sentences.id"), nullable=False, index=True
    )
    material_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("materials.id"), nullable=False, index=True
    )
    # 旧运行来源记录，只读历史；现行归属是 AgentRun（§4.5，P3a/P3b 落地）。
    model: Mapped[str] = mapped_column(String(255), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(255), nullable=False)
    # 本次勾选的解析模块（prompt-contracts §1 的九项）。
    style_modules: Mapped[list[str]] = mapped_column(json_list(), nullable=False, default=list)
    style_free_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_question: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 旧上下文注入记录，只读历史；现行归属是 AgentRun 注入记录（§4.5）。
    context_kp_ids: Mapped[list[str]] = mapped_column(json_list(), nullable=False, default=list)
    context_note_ids: Mapped[list[str]] = mapped_column(json_list(), nullable=False, default=list)
    # MVP 内恒为 false；留位保证将来对照实验的历史数据可比。
    retrieval_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
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
    # P0 兼容迁移列（`docs/mvp-tech-and-phases.md` §3 P0 第 2 条）：现行契约
    # 要求提取固定输入文档版本（§4.6 [不可推迟]）；AnalysisRevision 表随
    # P3a/P4a 落地时补 NOT NULL 与外键，P0 不建空 manifest 表。
    # 旧行没有可指涉的文档版本，保持 NULL，不做无损性猜测。
    analysis_revision_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(), nullable=True)
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
