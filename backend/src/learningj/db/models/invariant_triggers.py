"""数据层不变量触发器（§9 不变量 3 与 ReviewItem 状态／时间戳语义）。

SQLite 的 CHECK 约束无法跨表判断，这些必须有数据库级兜底；
其余不变量由唯一约束/外键/CHECK 或测试承载。

P0 起 ReviewItem 带 `status` 列（ADR-041，`data-model.md` §7.1）。除了沿用
的“reference 不得有 active 卡”，本模块补齐 §7.1/§7.2 的跨表与单向语义：

- INSERT review_items：`status='active'` 要求 `admitted_at` 非空。该条件是同表
  CHECK `ck_review_items_admitted_at_semantics`，不需要跨表触发器；active
  **不要求**已有 ReviewState——“已准入但尚未首评”是 §7.1/§7.2 的合法状态，
  因此本模块不再安装“active ⇒ 已有 ReviewState”的触发器。
- INSERT review_states：父 ReviewItem 的 `admitted_at` 为空时拒绝。§7.2 规定
  ReviewState 在首次评分时建立，而首次评分只可能发生在准入之后；因此对
  queued 或“准入前暂停”的项目插入 ReviewState 是非法写序。
- UPDATE review_items：`admitted_at` 与 `retired_at` 都是从空值单向写入，
  一经写入不得修改或清除；
- reference 的 KP 不得有 active 卡：INSERT / UPDATE review_items 以及
  UPDATE knowledge_points.default_retention 三条写路径全部拒绝（§9 不变量 3）。

合法首次准入（P5，同一事务内只写准入标记）：
`UPDATE review_items SET status='active', admitted_at=...`。准入不构造 S/D、
不创建 ReviewState（§7.1“准入不构造 S/D，也不创建 ReviewState”）。首次评分
时再于同一事务内插入 ReviewState 与首条 ReviewEvent（P5）；此后无论项目停在
active 还是 paused，已建立的 ReviewState 都保留。

已退役触发器：早期 P0 轮次曾安装
`trg_review_items_no_direct_active_insert` 与
`trg_review_items_active_requires_state`，前提是“active ⇒ 已有 ReviewState”。
该前提已按 §7.2 废止（ReviewState 在首次评分时建立）。从旧快照或历史副本
恢复的库可能仍携带这两个定义：本安装器只用 `CREATE TRIGGER IF NOT EXISTS`，
不会清除既有触发器，也不会重新安装已退役定义。

`install_invariant_triggers` 是幂等的：目标表尚未建立或仍是旧形状（如空库、
或仍缺少 `admitted_at` 列的 review_items）时静默跳过，等表形状就位后再安装。
"""

from __future__ import annotations

from sqlalchemy import Connection, Engine, text

# §9 不变量 3：default_retention = reference 的 KP 不得存在 active ReviewItem；
# paused 卡（含 reference 场景）合法并保留复习历史。
_REFERENCE_NO_ACTIVE_INSERT = """
CREATE TRIGGER IF NOT EXISTS trg_review_items_valid_requires_srs
BEFORE INSERT ON review_items
WHEN NEW.status = 'active' AND (
    SELECT default_retention FROM knowledge_points WHERE kp_id = NEW.kp_id
) = 'reference'
BEGIN
    SELECT RAISE(ABORT, 'invariant 3: reference KP must not have an active review item');
END;
"""

# 不变量 3 的 UPDATE 侧：status 改回 active，或把 active 卡改挂到
# reference KP，同样制造非法状态，必须拒绝。
_REFERENCE_NO_ACTIVE_UPDATE = """
CREATE TRIGGER IF NOT EXISTS trg_review_items_no_active_update
BEFORE UPDATE OF status, kp_id ON review_items
WHEN NEW.status = 'active' AND (
    SELECT default_retention FROM knowledge_points WHERE kp_id = NEW.kp_id
) = 'reference'
BEGIN
    SELECT RAISE(ABORT, 'invariant 3: reference KP must not have an active review item');
END;
"""

# 不变量 3 的 KP 侧：切到 reference 时仍存在 active 卡 → 拒绝；
# 写方先暂停卡片再切换（§7.1「非退役卡片均 paused」）。
_REFERENCE_SWITCH_GUARD = """
CREATE TRIGGER IF NOT EXISTS trg_knowledge_points_reference_switch_guard
BEFORE UPDATE OF default_retention ON knowledge_points
WHEN NEW.default_retention = 'reference'
  AND OLD.default_retention != 'reference'
  AND EXISTS (
    SELECT 1 FROM review_items
    WHERE kp_id = NEW.kp_id AND status = 'active'
  )
BEGIN
    SELECT RAISE(ABORT, 'invariant 3: pause active review items before switching KP to reference');
END;
"""

# §7.2：ReviewState 在首次评分时建立，而首次评分只可能发生在准入之后
# （admitted_at 非空）。对 queued 或准入前 paused 的项目插入 ReviewState 是
# 非法写序；准入本身只写 admitted_at，不创建该行。
_REVIEW_STATE_REQUIRES_ADMISSION = """
CREATE TRIGGER IF NOT EXISTS trg_review_states_requires_admission
BEFORE INSERT ON review_states
WHEN NOT EXISTS (
    SELECT 1 FROM review_items
    WHERE id = NEW.review_item_id AND admitted_at IS NOT NULL
)
BEGIN
    SELECT RAISE(ABORT, 'review state requires an admitted review item (admitted_at must be set first)');
END;
"""

# §0 / §7.1：retired_at 只能从空值单向写入，不得修改或清除。
_RETIRED_MONOTONIC = """
CREATE TRIGGER IF NOT EXISTS trg_review_items_retired_at_monotonic
BEFORE UPDATE ON review_items
WHEN OLD.retired_at IS NOT NULL AND (
    NEW.retired_at IS NULL OR NEW.retired_at != OLD.retired_at
)
BEGIN
    SELECT RAISE(ABORT, 'retired_at is write-once: it must not be modified or cleared');
END;
"""

# §7.1：admitted_at 一经分配保留，用于区分 paused 恢复为 queued 或 active。
_ADMITTED_MONOTONIC = """
CREATE TRIGGER IF NOT EXISTS trg_review_items_admitted_at_monotonic
BEFORE UPDATE ON review_items
WHEN OLD.admitted_at IS NOT NULL AND (
    NEW.admitted_at IS NULL OR NEW.admitted_at != OLD.admitted_at
)
BEGIN
    SELECT RAISE(ABORT, 'admitted_at is write-once: it must not be modified or cleared');
END;
"""

# §8.3: a sidecar is a versioned artifact, never a mutable cache.  Rebuilds
# insert a new row and publish it by changing Material.current_sidecar_id.
_SIDECAR_NO_UPDATE = """
CREATE TRIGGER IF NOT EXISTS trg_sidecars_immutable_update
BEFORE UPDATE ON sidecars
BEGIN
    SELECT RAISE(ABORT, 'sidecar is immutable; publish a new generation instead');
END;
"""

_SIDECAR_NO_DELETE = """
CREATE TRIGGER IF NOT EXISTS trg_sidecars_immutable_delete
BEFORE DELETE ON sidecars
BEGIN
    SELECT RAISE(ABORT, 'sidecar is immutable; deletion would break version references');
END;
"""

_TRIGGER_DDL = (
    _REFERENCE_NO_ACTIVE_INSERT,
    _REFERENCE_NO_ACTIVE_UPDATE,
    _REFERENCE_SWITCH_GUARD,
    _REVIEW_STATE_REQUIRES_ADMISSION,
    _RETIRED_MONOTONIC,
    _ADMITTED_MONOTONIC,
    _SIDECAR_NO_UPDATE,
    _SIDECAR_NO_DELETE,
)

# 触发器名清单（迁移与测试据此确认旧定义已替换）。
TRIGGER_NAMES = (
    "trg_review_items_valid_requires_srs",
    "trg_review_items_no_active_update",
    "trg_knowledge_points_reference_switch_guard",
    "trg_review_states_requires_admission",
    "trg_review_items_retired_at_monotonic",
    "trg_review_items_admitted_at_monotonic",
    "trg_sidecars_immutable_update",
    "trg_sidecars_immutable_delete",
)

# 现行契约已废止、但旧快照或历史副本可能仍带着的定义（早期 P0 轮次安装）。
# 安装器只创建当前集合，不做清理。
RETIRED_TRIGGER_NAMES = (
    "trg_review_items_no_direct_active_insert",
    "trg_review_items_active_requires_state",
)


def install_invariant_triggers(target: Engine | Connection) -> None:
    """在目标数据库上创建 §9 不变量兜底触发器（幂等）。"""
    _install(target)


def _install(target: Engine | Connection) -> None:
    if isinstance(target, Connection):
        _install_on_conn(target)
        return
    with target.begin() as conn:
        _install_on_conn(conn)


def _install_on_conn(conn: Connection) -> None:
    tables = {
        row[0]
        for row in conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    if "sidecars" in tables:
        for ddl in (_SIDECAR_NO_UPDATE, _SIDECAR_NO_DELETE):
            conn.execute(text(ddl))
    if not {"review_items", "review_states", "knowledge_points"} <= tables:
        return

    # Do not install current triggers on a legacy review_items shape that
    # lacks status/admitted_at (e.g. a copy restored from an old snapshot): a
    # trigger referring to NEW.status/NEW.admitted_at makes later SQLite table
    # rebuilds fail with "no such column".  This installer only creates the
    # current set on the current shape; retired definitions are never recreated.
    review_item_columns = {
        row[1]
        for row in conn.exec_driver_sql("PRAGMA table_info(review_items)").fetchall()
    }
    if not {"status", "admitted_at"} <= review_item_columns:
        return
    # Same guard for the current knowledge_points shape: invariant 3's switch
    # guard reads NEW.default_retention (ADR-041 rename of `retention`).
    knowledge_point_columns = {
        row[1]
        for row in conn.exec_driver_sql("PRAGMA table_info(knowledge_points)").fetchall()
    }
    if "default_retention" not in knowledge_point_columns:
        return
    for ddl in _TRIGGER_DDL:
        conn.execute(text(ddl))
