"""P0 baseline debt removal: drop legacy analysis state machine, add review item status, add extraction run compat revision column

Forward-only migration per `docs/mvp-tech-and-phases.md` §3 P0 (must-do 1–2).

Reversibility: this toolchain is forward-only (`mvp-tech-and-phases.md` §1.1);
`downgrade` intentionally raises. History safety comes from the mandatory
pre-migration backup (see `learningj.db.maintenance`).

Migration notes for legacy history (plan P0 #1):
- `analyses.status / extraction_status / extraction_trigger / session_closed /
  turn_count` were a second state machine owned by the pre-contract prototype.
  They have no lawful mapping in the current contract (`data-model.md` §4.5:
  sessions and run records replace them; `extraction_trigger`'s batch/background
  semantics were rejected with ADR-037). Their values are preserved only in the
  pre-migration backup; they are dropped here and never re-derived.
- Kept as read-only legacy columns on `analyses`: `model`, `prompt_version`,
  `context_kp_ids`, `context_note_ids` (current owner is AgentRun, P3a/P3b).
- `review_items.status` is backfilled from `retired_at` **and** KP retention
  (§7.1 semantics, total mapping — no guessing):
  retired_at NOT NULL → 'retired'; NULL on a reference KP → 'paused'（the old
  schema never guarded `UPDATE knowledge_points.retention`, so legacy DBs can
  hold reference KPs with non-retired cards; the current contract says those
  are paused, preserving the card, its ReviewState and history）;
  otherwise NULL → 'active'.
- `extraction_runs.analysis_revision_id` is a nullable compatibility column
  without a foreign key; the NOT NULL/FK completes when AnalysisRevision lands
  (P3a/P4a). No empty AnalysisRevision table is created in P0.
- `known_evidence.source` legacy values, `review_states.history` and the
  `analysis_sections.kind/superseded_by/origin_turn` shape are NOT touched in
  P0; their owning phases are P2 / P5 / P3a-P4a respectively (P0-contract audit,
  unmappable-field list).

Table rebuilds use `copy_from` with the target schema and
`recreate='always'` instead of reflected diffs: SQLite reflection cannot report
named CHECK constraints, and batch constraint operations re-expand names
through the naming convention. Constraint and index names below are written in
their final `Base.metadata` form; column/constraint *ordering* after an Alembic
rebuild is not guaranteed to match `create_all`, only the named constraint set
and column set are.

Revision ID: a51c2aeea6cf
Revises: 1c1fc8f7fc96
Create Date: 2026-09-09 23:03:02.327440

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'a51c2aeea6cf'
down_revision: str | None = '1c1fc8f7fc96'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# `analyses` 的目标形态：旧表去掉第二状态机（5 列与 2 个 CHECK）后的样子。
_ANALYSES_AFTER = sa.Table(
    'analyses',
    sa.MetaData(),
    sa.Column('sentence_id', sa.Uuid(), nullable=False),
    sa.Column('material_id', sa.Uuid(), nullable=False),
    sa.Column('model', sa.String(length=255), nullable=False),
    sa.Column('prompt_version', sa.String(length=255), nullable=False),
    sa.Column('style_modules', sa.JSON(), nullable=False),
    sa.Column('style_free_text', sa.Text(), nullable=True),
    sa.Column('user_question', sa.Text(), nullable=True),
    sa.Column('context_kp_ids', sa.JSON(), nullable=False),
    sa.Column('context_note_ids', sa.JSON(), nullable=False),
    sa.Column('retrieval_enabled', sa.Boolean(), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['material_id'], ['materials.id'],
                            name='fk_analyses_material_id_materials'),
    sa.ForeignKeyConstraint(['sentence_id'], ['sentences.id'],
                            name='fk_analyses_sentence_id_sentences'),
    sa.PrimaryKeyConstraint('id', name='pk_analyses'),
)
sa.Index('ix_analyses_material_id', _ANALYSES_AFTER.c.material_id)
sa.Index('ix_analyses_sentence_id', _ANALYSES_AFTER.c.sentence_id)

# `review_items` 的目标形态：新增 NOT NULL `status` 列（与 ORM 的
# str_enum 渲染一致：VARCHAR + 命名枚举 CHECK）与 §7.1 等价 CHECK。
_REVIEW_ITEMS_AFTER = sa.Table(
    'review_items',
    sa.MetaData(),
    sa.Column('kp_id', sa.Uuid(), nullable=False),
    sa.Column('occurrence_id', sa.Uuid(), nullable=False),
    sa.Column(
        'status',
        # 命名与 Base.metadata 约束约定（ck_<table>_<name>）一致，
        # 使迁移产物与 create_all 的约束命名相同（顺序不保证）。
        sa.Enum('active', 'paused', 'retired',
                name='ck_review_items_review_item_status',
                native_enum=False, create_constraint=True,
                values_callable=lambda cls: [m.value for m in cls]),
        nullable=False,
    ),
    sa.Column('retired_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint(
        "(status = 'retired' AND retired_at IS NOT NULL) OR "
        "(status IN ('active', 'paused') AND retired_at IS NULL)",
        name='ck_review_items_status_retired_at_equivalent',
    ),
    sa.ForeignKeyConstraint(['kp_id'], ['knowledge_points.kp_id'],
                            name='fk_review_items_kp_id_knowledge_points'),
    sa.ForeignKeyConstraint(['occurrence_id'], ['occurrences.id'],
                            name='fk_review_items_occurrence_id_occurrences'),
    sa.PrimaryKeyConstraint('id', name='pk_review_items'),
    sa.UniqueConstraint('kp_id', 'occurrence_id', name='uq_review_items_kp_id'),
)
sa.Index('ix_review_items_kp_id', _REVIEW_ITEMS_AFTER.c.kp_id)
sa.Index('ix_review_items_occurrence_id', _REVIEW_ITEMS_AFTER.c.occurrence_id)

# 不变量 3 触发器按 status 语义替换，并覆盖全部可能制造
# `reference + active` 的写路径（INSERT / UPDATE review_items /
# UPDATE knowledge_points.retention）。旧定义按 retired_at IS NULL 判断，
# 会错误拦截合法 paused 卡，必须 DROP 后重建（IF NOT EXISTS 不会更新）。
_TRIGGER_INVARIANT_3 = """
CREATE TRIGGER trg_review_items_valid_requires_srs
BEFORE INSERT ON review_items
WHEN NEW.status = 'active' AND (
    SELECT retention FROM knowledge_points WHERE kp_id = NEW.kp_id
) = 'reference'
BEGIN
    SELECT RAISE(ABORT, 'invariant 3: reference KP must not have an active review item');
END;
"""

_TRIGGER_INVARIANT_3_UPDATE = """
CREATE TRIGGER trg_review_items_no_active_update
BEFORE UPDATE OF status, kp_id ON review_items
WHEN NEW.status = 'active' AND (
    SELECT retention FROM knowledge_points WHERE kp_id = NEW.kp_id
) = 'reference'
BEGIN
    SELECT RAISE(ABORT, 'invariant 3: reference KP must not have an active review item');
END;
"""

_TRIGGER_REFERENCE_SWITCH_GUARD = """
CREATE TRIGGER trg_knowledge_points_reference_switch_guard
BEFORE UPDATE OF retention ON knowledge_points
WHEN NEW.retention = 'reference'
  AND OLD.retention != 'reference'
  AND EXISTS (
    SELECT 1 FROM review_items
    WHERE kp_id = NEW.kp_id AND status = 'active'
  )
BEGIN
    SELECT RAISE(ABORT, 'invariant 3: pause active review items before switching KP to reference');
END;
"""

_TRIGGER_RETIRED_MONOTONIC = """
CREATE TRIGGER trg_review_items_retired_at_monotonic
BEFORE UPDATE ON review_items
WHEN OLD.retired_at IS NOT NULL AND (
    NEW.retired_at IS NULL OR NEW.retired_at != OLD.retired_at
)
BEGIN
    SELECT RAISE(ABORT, 'retired_at is write-once: it must not be modified or cleared');
END;
"""


def upgrade() -> None:
    # Remove both legacy and partially-installed current triggers before any
    # SQLite batch rebuild.  A trigger body is compiled when the table is
    # renamed; a current trigger referring to NEW.status cannot survive the
    # legacy review_items shape, even though review_items itself is not being
    # rebuilt yet.
    op.execute("DROP TRIGGER IF EXISTS trg_review_items_valid_requires_srs")
    op.execute("DROP TRIGGER IF EXISTS trg_review_items_no_active_update")
    op.execute("DROP TRIGGER IF EXISTS trg_knowledge_points_reference_switch_guard")
    op.execute("DROP TRIGGER IF EXISTS trg_review_items_retired_at_monotonic")

    # 1) analyses：整表重建为去掉第二状态机的目标形态（数据按列名拷贝，
    #    历史 read-only 列 model/prompt_version/context_* 原样保留）。
    with op.batch_alter_table(
        'analyses', copy_from=_ANALYSES_AFTER, recreate='always'
    ) as batch_op:
        pass  # copy_from 已是目标形态；recreate='always' 强制走 COPY->MOVE

    # 2) review_items：加 status 列 → 回填 → 整表重建（NOT NULL + 等价 CHECK）。
    #    回填是全函数映射：retired_at 非空 → retired；retired_at 为空且 KP 为
    #    reference → paused（旧 schema 不守卫 KP retention 更新，历史库可能
    #    存在该状态，现契约语义即 paused）；其余 → active。
    op.add_column(
        'review_items', sa.Column('status', sa.String(length=16), nullable=True)
    )
    op.execute(
        "UPDATE review_items SET status = CASE"
        " WHEN retired_at IS NOT NULL THEN 'retired'"
        " WHEN (SELECT retention FROM knowledge_points"
        "       WHERE kp_id = review_items.kp_id) = 'reference' THEN 'paused'"
        " ELSE 'active' END"
    )
    with op.batch_alter_table(
        'review_items', copy_from=_REVIEW_ITEMS_AFTER, recreate='always'
    ) as batch_op:
        pass

    # 3) extraction_runs：固定输入版本的兼容迁移列（P0 不建 AnalysisRevision 表）。
    op.add_column(
        'extraction_runs',
        sa.Column('analysis_revision_id', sa.Uuid(), nullable=True),
    )

    # 4) 触发器按 status 语义重建（含 UPDATE 侧守卫与 KP 切换守卫）；
    #    此后 env.py 的 install_invariant_triggers 以 IF NOT EXISTS 兜底，
    #    定义与 learningj.db.models.invariant_triggers 保持一致。
    op.execute(_TRIGGER_INVARIANT_3)
    op.execute(_TRIGGER_INVARIANT_3_UPDATE)
    op.execute(_TRIGGER_REFERENCE_SWITCH_GUARD)
    op.execute(_TRIGGER_RETIRED_MONOTONIC)


def downgrade() -> None:
    raise NotImplementedError(
        "P0 迁移工具链是 forward-only（mvp-tech-and-phases.md §1.1）；"
        "历史回滚依赖迁移前自动备份（learningj.db.maintenance）。"
    )
