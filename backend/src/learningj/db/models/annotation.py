"""Annotation：阅读器划线与批注（`data-model.md` §5，ADR-030）。

叶子实体：与 KnowledgePoint 之间**没有边**。不进 SRS、不进别名表、
不需要合并、不需要锚点规范。不提供从 Annotation 自动提升为 KP 的入口。
"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from learningj.db.base import Base, Timestamped, UuidPk


class Annotation(UuidPk, Timestamped, Base):
    __tablename__ = "annotations"

    material_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("materials.id"), nullable=False, index=True
    )
    # 有序数组：物理上经 annotation_spans 关联（ordinal 保证顺序）。
    # 单句划线为长度 1，跨句划线为长度 n。
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str | None] = mapped_column(String(32), nullable=True)
