"""记忆层：作品笔记与学情画像（`data-model.md` §6，ADR-029）。

- 记忆只承载风格与画像；「某语法点是否已讲过」不由记忆承担，它来自
  KP 库检索这一确定性事实。
- 条数上限 N 与单条字数上限 M 由**写入路径**强制（§9 不变量 7），
  不由 prompt 约束，也不由清理任务兜底；上限值以配置传入，不硬编码。
- 长期未被命中的条目走 LRU 淘汰（`last_hit_at`）。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from learningj.db.base import Base, Timestamped, UuidPk
from learningj.db.types import str_enum
from learningj.domain.enums import NoteUpdatedBy


class MaterialNote(UuidPk, Timestamped, Base):
    __tablename__ = "material_notes"

    # 作用域为单部作品。
    material_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("materials.id"), nullable=False, index=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 产生该条笔记的句子。
    source_sentence_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sentences.id"), nullable=True
    )
    # 最近一次被注入上下文的时间；LRU 淘汰依据。
    last_hit_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_by: Mapped[NoteUpdatedBy] = mapped_column(
        str_enum(NoteUpdatedBy, name="note_updated_by"), nullable=False
    )


class LearnerProfileNote(UuidPk, Timestamped, Base):
    __tablename__ = "learner_profile_notes"

    content: Mapped[str] = mapped_column(Text, nullable=False)
    last_hit_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_by: Mapped[NoteUpdatedBy] = mapped_column(
        str_enum(NoteUpdatedBy, name="note_updated_by"), nullable=False
    )
