"""P0 rework 2: drop the retired ReviewState-at-admission triggers

`docs/data-model.md` §7.1/§7.2 (2026-09-10) place ReviewState creation at the
**first rating**, not at admission: FSRS initial stability is a function of the
first grade, so a merely admitted card has no S/D to write. `active` therefore
no longer implies a pre-existing ReviewState, and two definitions installed by
the previous P0 round are retired:

- `trg_review_items_no_direct_active_insert` — active no longer needs a
  pre-existing ReviewState, and `admitted_at` is already enforced by CHECK
  `ck_review_items_admitted_at_semantics` on INSERT;
- `trg_review_items_active_requires_state` — its whole premise is void.

`learningj.db.models.invariant_triggers.install_invariant_triggers` only issues
`CREATE TRIGGER IF NOT EXISTS` and never drops, so removing these DDLs from
`_TRIGGER_DDL` would leave the retired triggers live on every database that
already ran `c66997d83060` (its `env.py` installed the then-current set). They
are dropped here by a forward revision instead, matching the precedent in that
migration, which drops its stale definitions before `env.py` re-installs the
current set after all migrations.

`trg_review_states_requires_admission` is deliberately retained: a ReviewState
created at the first rating still requires an admitted (`admitted_at` non-null)
parent. The reference guards and the write-once monotonic triggers are
unaffected.

Reversibility: this toolchain is forward-only (`mvp-tech-and-phases.md` §1.1);
`downgrade` intentionally raises. History safety comes from the mandatory
pre-migration backup (`learningj.db.maintenance`).

Revision ID: d8b3f6a1c204
Revises: c66997d83060
Create Date: 2026-09-10

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = 'd8b3f6a1c204'
down_revision: str | None = 'c66997d83060'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Triggers installed by the previous P0 round and retired by the first-rating
# contract. `DROP IF EXISTS` tolerates databases where they were never
# installed (fresh upgrades, or a partial install).
_RETIRED_TRIGGERS = (
    "trg_review_items_no_direct_active_insert",
    "trg_review_items_active_requires_state",
)


def upgrade() -> None:
    for name in _RETIRED_TRIGGERS:
        op.execute(f"DROP TRIGGER IF EXISTS {name}")


def downgrade() -> None:
    raise NotImplementedError(
        "P0 迁移工具链是 forward-only（mvp-tech-and-phases.md §1.1）；"
        "历史回滚依赖迁移前自动备份（learningj.db.maintenance）。"
    )
