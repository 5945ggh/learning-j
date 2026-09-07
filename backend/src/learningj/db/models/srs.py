"""SRS 层：ReviewItem 与 ReviewState（`data-model.md` §7，ADR-019）。

- 闸门在 ReviewItem，受每日配额控制：加入学习 ≠ 立刻进入复习队列；
- 默认一个 KP 只有一条有效 ReviewItem；`retired_at` 是 MVP 中唯一允许的
  单向状态标记：只能从空值单向写入，不得修改或清除；
- `retention = reference` 的 KP 不存在 `retired_at IS NULL` 的有效项
  （§9 不变量 3，数据层以触发器强制）。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from learningj.db.types import json_list
from learningj.db.base import Base, Timestamped, UuidPk
from learningj.domain.ids import new_uuid7


class ReviewItem(UuidPk, Timestamped, Base):
    __tablename__ = "review_items"
    __table_args__ = (
        # 有效项（retired_at IS NULL）默认每 KP 至多一条（§9 不变量 4）。
        # 部分唯一索引在 migration 中以 SQLite 方言创建。
        UniqueConstraint("kp_id", "occurrence_id"),
    )

    kp_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_points.kp_id"), nullable=False, index=True
    )
    # 作为例句的那条 Occurrence，用户可更换。
    occurrence_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("occurrences.id"), nullable=False, index=True
    )
    # MVP 唯一允许的单向状态标记：只能从空值单向写入时间戳（§0）。
    retired_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class ReviewState(Timestamped, Base):
    """标准 SRS 状态字段（间隔、易度、到期时间、复习历史），字段形状对齐
    FSRS Card（`docs/mvp-tech-and-phases.md` §1.1）。选定算法后补行为；
    列名保持 FSRS 术语。"""

    __tablename__ = "review_states"
    __table_args__ = (UniqueConstraint("review_item_id"),)

    review_item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("review_items.id"), primary_key=True
    )
    # FSRS Card 形状。
    state: Mapped[str] = mapped_column(Integer, nullable=False, default=0)
    stability: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    difficulty: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_review_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 复习历史（reps / lapses 等计数与状态快照）。
    reps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lapses: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    history: Mapped[list[dict[str, Any]]] = mapped_column(json_list(), nullable=False, default=list)
