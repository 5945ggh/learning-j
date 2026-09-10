"""SRS 层：ReviewItem 与 ReviewState（`data-model.md` §7，ADR-019/041）。

- status 取值 queued/active/paused/retired（ADR-041）：

  - `queued`：用户已明确加入但尚未获得新卡配额；`admitted_at` 与
    `retired_at` 均为空，且不得有 ReviewState；
  - `active`：已写入 `admitted_at`；**不要求**已有 ReviewState——首次评分前
    没有排程投影是合法的（§7.1/§7.2），ReviewState 在首次评分时与首条
    ReviewEvent 同一事务建立；
  - `paused`：reference 意愿或用户暂停；可发生于准入前（`admitted_at`
    为空）、准入后未首评或已首评之后，保留原准入标记；
  - `retired`：`status = retired` 当且仅当 `retired_at` 非空（CHECK 强制）。
    reference 的 KP 无 active 卡，paused 卡保留（§9 不变量 3，触发器强制）；
- `admitted_at` 与 `retired_at` 都是单向标记：一经写入不得修改或清除
  （§7.1“一经分配保留”；触发器强制）。
- ReviewState 不是准入产物：首次评分时建立；初始 S/D 由首次评分决定，
  P0 只保留列形状，不实现该算法（P5）。
- 同一 Occurrence 默认至多一条非退役 ReviewItem；同一 KP 下不同 Occurrence
  可各自建卡（§7.1 / ADR-041）。产品规划 §8 允许用户显式增加卡片。
  当前表仍保留 ADR-041 之前的 `UniqueConstraint("kp_id", "occurrence_id")`：
  它比 §7.1 更严（挡住 retired 后为同一 Occurrence 另建卡），也不等价于
  “按 Occurrence 唯一”（同一句若挂不同 `kp_id` 仍可两条）。把唯一键改为
  occurrence 粒度的非 retired 部分唯一索引属于 **P5 的前滚迁移项**，已登记在
  不变量 4 的测试 reason；P0 不改产品唯一性口径。
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
    Integer,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from learningj.db.types import json_list, str_enum
from learningj.db.base import Base, Timestamped, UuidPk
from learningj.domain.enums import ReviewItemStatus
from learningj.domain.ids import new_uuid7


class ReviewItem(UuidPk, Timestamped, Base):
    __tablename__ = "review_items"
    __table_args__ = (
        # §7.1 / §9 不变量 4：retired ⇔ retired_at 非空；queued/active/paused
        # 不得携带退役时间戳。退役同次提交状态与时间戳且不可恢复。
        CheckConstraint(
            "(status = 'retired' AND retired_at IS NOT NULL)"
            " OR (status IN ('queued', 'active', 'paused') AND retired_at IS NULL)",
            name="status_retired_at_equivalent",
        ),
        # §7.1：queued 的 admitted_at 必须为空；active 必须已有 admitted_at
        # （ReviewState 可选，首次评分时建立）；paused/retired 保留原准入
        # 标记，准入前暂停与未准入退役都可以为空。
        CheckConstraint(
            "(status = 'queued' AND admitted_at IS NULL)"
            " OR (status = 'active' AND admitted_at IS NOT NULL)"
            " OR status IN ('paused', 'retired')",
            name="admitted_at_semantics",
        ),
        # 遗留自 ADR-041 之前的口径；比 §7.1 更严且不是 Occurrence 唯一。
        # P5 前滚迁移：改为 occurrence 粒度、限定 status != 'retired' 的部分
        # 唯一索引（见模块 docstring 与不变量 4 的测试 reason）。
        UniqueConstraint("kp_id", "occurrence_id"),
    )

    kp_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_points.kp_id"), nullable=False, index=True
    )
    # 作为例句的那条 Occurrence，用户可更换。
    occurrence_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("occurrences.id"), nullable=False, index=True
    )
    # 排程控制状态：queued/active/paused/retired；reference 意愿表达为 paused。
    status: Mapped[ReviewItemStatus] = mapped_column(
        str_enum(ReviewItemStatus, name="review_item_status"), nullable=False
    )
    # 首次获新卡配额并进入排程的时间；一经分配保留（单向写入触发器强制），
    # 用于区分 paused 恢复为 queued 还是 active。
    admitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 真正退役的时间戳：只能从空值单向写入（§0 / §7.1 触发器强制）。
    retired_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class ReviewState(Timestamped, Base):
    """标准 SRS 状态字段（间隔、易度、到期时间、复习历史），字段形状对齐
    FSRS Card（`docs/mvp-tech-and-phases.md` §1.1）。

    §7.2：本行在**首次评分**时与首条 ReviewEvent 同一事务建立，准入本身不
    创建它；FSRS 的初始 stability/difficulty 由首次评分决定（P5）。P0 只
    保留列形状与占位默认值，不实现任何排程算法。列名保持 FSRS 术语。"""

    __tablename__ = "review_states"
    __table_args__ = (UniqueConstraint("review_item_id"),)

    review_item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("review_items.id"), primary_key=True
    )
    # FSRS Card 形状。默认值只是列形状占位；首次评分（P5）必须按首评结果
    # 写入 state/stability/difficulty，P0 不在此处发明初始 S/D 算法。
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
