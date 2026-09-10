"""P0 rework: ReviewItem queued status + admitted_at (ADR-041, data-model §7.1)

Forward-only migration per `docs/mvp-tech-and-phases.md` §3 P0 (must-do 2) and
the ADR-041 re-sync. It extends the already-forward-migrated schema (revision
`a51c2aeea6cf`) from the pre-ADR-041 three-state ReviewItem to the current
`queued`/`active`/`paused`/`retired` contract:

- adds `admitted_at` (nullable): the first new-card-quota admission time. It is
  a write-once marker (§7.1 "一经分配保留").
- rebuilds `review_items` so the status enum CHECK admits `queued` and adds the
  §7.1 CHECKs:
  * retired ⇔ `retired_at` NOT NULL; queued/active/paused keep it NULL;
  * queued ⇒ `admitted_at` NULL; active ⇒ `admitted_at` NOT NULL;
    paused/retired keep whatever admission marker they had.
- backfills with a total, evidence-based mapping (no guessing):
  * `retired_at` NOT NULL → `retired`;
  * legacy `paused` → `paused`. A legacy paused card with a ReviewState keeps
    its admission marker; one without is a pre-admission pause (§7.1/§7.2);
  * legacy `active` with a ReviewState → `active`, `admitted_at` taken from
    `review_states.created_at` (the recorded admission evidence);
  * legacy `active` without a ReviewState → `queued`. This is a deliberate
    contract-owner compatibility choice, not an implication of an invariant:
    under §7.1/§7.2 (2026-09-10) "admitted but ungraded" is itself a legal
    active state, so these rows could equally map to active. They are queued
    because the legacy three-state schema recorded no admission time and no
    quota evidence for them, and inventing one would fabricate history; the
    P0-contract audit logs this as "deliberate compatibility interpretation,
    not proof of historical quota admission".
  * `retired_at` is never rewritten; `admitted_at` is set from evidence only.

The post-backfill assertion `active_without_state = 0` is meaningful **only
because of that conservative choice**: every legacy state-less active row became
queued, so no active row is left without a ReviewState. It checks this backfill's
outcome rather than restating a schema invariant — active without a ReviewState
is legal under the current contract (§7.1/§7.2).

The current trigger set is installed by `alembic/env.py` after migrations
(`learningj.db.models.invariant_triggers`, idempotent); the stale pre-rework
definitions are dropped here so the SQLite table rebuild cannot trip over old
bodies. That installed set still contained
`trg_review_items_active_requires_state` and
`trg_review_items_no_direct_active_insert`, which the first-rating contract
retires; forward revision `d8b3f6a1c204` drops them from already-upgraded
databases.

Reversibility: this toolchain is forward-only (`mvp-tech-and-phases.md` §1.1);
`downgrade` intentionally raises. History safety comes from the mandatory
pre-migration backup (`learningj.db.maintenance`).

Revision ID: c66997d83060
Revises: a51c2aeea6cf
Create Date: 2026-09-10

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'c66997d83060'
down_revision: str | None = 'a51c2aeea6cf'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Stale trigger definitions that reference the pre-rework shape. They are
# dropped before the rebuild; env.py reinstalls the current set afterwards.
_STALE_TRIGGERS = (
    "trg_review_items_valid_requires_srs",
    "trg_review_items_no_active_update",
    "trg_knowledge_points_reference_switch_guard",
    "trg_review_items_no_direct_active_insert",
    "trg_review_items_active_requires_state",
    "trg_review_states_requires_admission",
    "trg_review_items_retired_at_monotonic",
    "trg_review_items_admitted_at_monotonic",
)

# `review_items` 的目标形态（约束/索引命名与 `Base.metadata` 一致；Alembic
# 重建后的列与约束顺序不保证与 create_all 相同）：queued 进入
# 枚举 CHECK，新增 `admitted_at` 与 §7.1 的两条语义 CHECK。
_RETIRED_EQUIVALENT_CHECK = (
    "(status = 'retired' AND retired_at IS NOT NULL) OR "
    "(status IN ('queued', 'active', 'paused') AND retired_at IS NULL)"
)
_ADMITTED_AT_CHECK = (
    "(status = 'queued' AND admitted_at IS NULL) OR "
    "(status = 'active' AND admitted_at IS NOT NULL) OR "
    "status IN ('paused', 'retired')"
)


def _review_items_table(*, with_admitted_check: bool) -> sa.Table:
    """构造 `review_items` 目标表；中间态先不加 admitted_at 语义 CHECK。

    a51 迁移留下的枚举 CHECK 不允许 'queued'，而回填必须把无排程状态的
    legacy active 改成 queued；因此先重建一次以放宽枚举，回填后再重建一次
    落最终 CHECK。
    """
    constraints = [
        sa.CheckConstraint(
            _RETIRED_EQUIVALENT_CHECK,
            name='ck_review_items_status_retired_at_equivalent',
        )
    ]
    if with_admitted_check:
        constraints.append(
            sa.CheckConstraint(
                _ADMITTED_AT_CHECK,
                name='ck_review_items_admitted_at_semantics',
            )
        )
    table = sa.Table(
        'review_items',
        sa.MetaData(),
        sa.Column('kp_id', sa.Uuid(), nullable=False),
        sa.Column('occurrence_id', sa.Uuid(), nullable=False),
        sa.Column(
            'status',
            # 命名与 Base.metadata 约束约定（ck_<table>_<name>）一致，
            # 使迁移产物与 create_all 的约束命名相同（顺序不保证）。
            sa.Enum('queued', 'active', 'paused', 'retired',
                    name='ck_review_items_review_item_status',
                    native_enum=False, create_constraint=True,
                    values_callable=lambda cls: [m.value for m in cls]),
            nullable=False,
        ),
        sa.Column('admitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('retired_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        *constraints,
        sa.ForeignKeyConstraint(['kp_id'], ['knowledge_points.kp_id'],
                                name='fk_review_items_kp_id_knowledge_points'),
        sa.ForeignKeyConstraint(['occurrence_id'], ['occurrences.id'],
                                name='fk_review_items_occurrence_id_occurrences'),
        sa.PrimaryKeyConstraint('id', name='pk_review_items'),
        sa.UniqueConstraint('kp_id', 'occurrence_id', name='uq_review_items_kp_id'),
    )
    sa.Index('ix_review_items_kp_id', table.c.kp_id)
    sa.Index('ix_review_items_occurrence_id', table.c.occurrence_id)
    return table


_REVIEW_ITEMS_WIDENED = _review_items_table(with_admitted_check=False)
_REVIEW_ITEMS_AFTER = _review_items_table(with_admitted_check=True)

# 全函数回填：所有 RHS 按更新前的行值求值（`status` 指 a51 迁移后的值）。
_BACKFILL = (
    "UPDATE review_items SET"
    " admitted_at = (SELECT rs.created_at FROM review_states rs"
    "                WHERE rs.review_item_id = review_items.id),"
    " status = CASE"
    "   WHEN retired_at IS NOT NULL THEN 'retired'"
    "   WHEN status = 'paused' THEN 'paused'"
    "   WHEN EXISTS (SELECT 1 FROM review_states rs"
    "                WHERE rs.review_item_id = review_items.id) THEN 'active'"
    "   ELSE 'queued' END"
)


def upgrade() -> None:
    # 旧触发器在 SQLite 表重建前移除（IF EXISTS 覆盖未安装/部分安装的情况）。
    for name in _STALE_TRIGGERS:
        op.execute(f"DROP TRIGGER IF EXISTS {name}")

    # 1) 新增 admitted_at。
    op.add_column(
        'review_items',
        sa.Column('admitted_at', sa.DateTime(timezone=True), nullable=True),
    )

    # 2) 先重建为放宽枚举的中间形态（a51 的枚举 CHECK 不允许 queued，回填前
    #    必须先放开），再按 ReviewState 证据回填 admitted_at 与 status。
    with op.batch_alter_table(
        'review_items', copy_from=_REVIEW_ITEMS_WIDENED, recreate='always'
    ) as batch_op:
        pass
    op.execute(_BACKFILL)

    # 存量不变量 3 断言：回填只信任 a51 的 paused 映射，这里显式核验没有
    # reference KP 的 active 卡残留，避免把非法历史行带进新约束形状。
    violations = op.get_bind().execute(
        sa.text(
            "SELECT count(*) FROM review_items r"
            " JOIN knowledge_points kp ON kp.kp_id = r.kp_id"
            " WHERE kp.retention = 'reference' AND r.status = 'active'"
        )
    ).scalar_one()
    if violations:
        raise RuntimeError(
            "invariant 3 violation after backfill: "
            f"{violations} active review item(s) belong to reference KPs"
        )

    # 回填结果断言：保守映射（无状态的 legacy active → queued）保证这一步之后
    # `active ⇒ 已有 ReviewState` 成立。它只核验本次回填的选择与边界，**不是**
    # 现行 schema 不变量——§7.1/§7.2 允许“已准入但未首评”的 active 没有
    # ReviewState。若将来把无状态 active 改映射为 active，必须同时移除本断言
    # 并重新论证历史解释。
    active_without_state = op.get_bind().execute(
        sa.text(
            "SELECT count(*) FROM review_items r"
            " WHERE r.status = 'active' AND NOT EXISTS ("
            "   SELECT 1 FROM review_states rs WHERE rs.review_item_id = r.id)"
        )
    ).scalar_one()
    if active_without_state:
        raise RuntimeError(
            "conservative backfill failed: "
            f"{active_without_state} active review item(s) lack a ReviewState"
        )

    # 3) 再重建一次，落下 §7.1 的 admitted_at 语义 CHECK（此时全部行已满足）。
    with op.batch_alter_table(
        'review_items', copy_from=_REVIEW_ITEMS_AFTER, recreate='always'
    ) as batch_op:
        pass


def downgrade() -> None:
    raise NotImplementedError(
        "P0 迁移工具链是 forward-only（mvp-tech-and-phases.md §1.1）；"
        "历史回滚依赖迁移前自动备份（learningj.db.maintenance）。"
    )
