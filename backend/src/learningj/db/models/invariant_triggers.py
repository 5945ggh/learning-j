"""数据层不变量触发器（§9 不变量 3 与 ReviewItem 状态／时间戳语义）。

SQLite 的 CHECK 约束无法跨表判断，这些必须有数据库级兜底；
其余不变量由唯一约束/外键/CHECK 或测试承载。

P0 起 ReviewItem 带 `status` 列（ADR-041，`data-model.md` §7.1）。除了沿用
的“reference 不得有 active 卡”，本模块补齐 §7.1 的跨表与单向语义：

- INSERT review_items：status='active' 直接拒绝。ReviewState 通过
  `review_item_id` 外键依赖 ReviewItem 行，因此 ReviewState 不可能先于
  ReviewItem 存在；直接插入 active 必然违反“active 必须已有 ReviewState”。
  合法准入必须在同一事务内插入 ReviewState，再把状态更新为 active；
- UPDATE review_items(status)：转为 active 时必须已有 ReviewState，且
  `admitted_at` 非空（后者由 CHECK 承担）；
- INSERT review_states：父 ReviewItem 的 `admitted_at` 为空时拒绝。覆盖
  queued 与“准入前暂停”：§7.2 规定首次准入前尚无 ReviewState；
- UPDATE review_items：`admitted_at` 与 `retired_at` 都是从空值单向写入，
  一经写入不得修改或清除；
- reference 的 KP 不得有 active 卡：INSERT / UPDATE review_items 以及
  UPDATE knowledge_points.retention 三条写路径全部拒绝（§9 不变量 3）。

合法首次准入（P5，同一事务内的写序）：先
`UPDATE review_items SET status='paused', admitted_at=...`，再插入
ReviewState，最后 `UPDATE ... SET status='active'`。中间态不对外可见。

`install_invariant_triggers` 是幂等的：目标表尚未建立或仍是旧形状（如空库上
运行 `alembic revision --autogenerate`、或升级到引入 `admitted_at` 之前的
revision）时静默跳过，等表形状就位后再安装。
"""

from __future__ import annotations

from sqlalchemy import Connection, Engine, text

# §9 不变量 3：retention = reference 的 KP 不得存在 active ReviewItem；
# paused 卡（含 reference 场景）合法并保留复习历史。
_REFERENCE_NO_ACTIVE_INSERT = """
CREATE TRIGGER IF NOT EXISTS trg_review_items_valid_requires_srs
BEFORE INSERT ON review_items
WHEN NEW.status = 'active' AND (
    SELECT retention FROM knowledge_points WHERE kp_id = NEW.kp_id
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
    SELECT retention FROM knowledge_points WHERE kp_id = NEW.kp_id
) = 'reference'
BEGIN
    SELECT RAISE(ABORT, 'invariant 3: reference KP must not have an active review item');
END;
"""

# 不变量 3 的 KP 侧：切到 reference 时仍存在 active 卡 → 拒绝；
# 写方先暂停卡片再切换（§7.1「非退役卡片均 paused」）。
_REFERENCE_SWITCH_GUARD = """
CREATE TRIGGER IF NOT EXISTS trg_knowledge_points_reference_switch_guard
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

# §7.1：active 必须已有 ReviewState。ReviewState 的 FK 方向决定了它不可能
# 先于 ReviewItem 行存在，所以 active 只能是 UPDATE 的目标，不能直接插入。
_NO_DIRECT_ACTIVE_INSERT = """
CREATE TRIGGER IF NOT EXISTS trg_review_items_no_direct_active_insert
BEFORE INSERT ON review_items
WHEN NEW.status = 'active'
BEGIN
    SELECT RAISE(ABORT, 'active review item must already have an admitted_at and ReviewState; create it non-active and admit within one transaction');
END;
"""

# §7.1 / §7.2：转为 active 时 ReviewState 必须已经存在（首次准入在同一事务
# 内先写 ReviewState，再更新状态）。
_ACTIVE_REQUIRES_STATE = """
CREATE TRIGGER IF NOT EXISTS trg_review_items_active_requires_state
BEFORE UPDATE OF status ON review_items
WHEN NEW.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM review_states WHERE review_item_id = NEW.id
  )
BEGIN
    SELECT RAISE(ABORT, 'active review item must already have a ReviewState; insert the state before admitting');
END;
"""

# §7.2：首次准入前尚无 ReviewState，包括 queued 及准入前暂停的项目。
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

_TRIGGER_DDL = (
    _REFERENCE_NO_ACTIVE_INSERT,
    _REFERENCE_NO_ACTIVE_UPDATE,
    _REFERENCE_SWITCH_GUARD,
    _NO_DIRECT_ACTIVE_INSERT,
    _ACTIVE_REQUIRES_STATE,
    _REVIEW_STATE_REQUIRES_ADMISSION,
    _RETIRED_MONOTONIC,
    _ADMITTED_MONOTONIC,
)

# 触发器名清单（迁移与测试据此确认旧定义已替换）。
TRIGGER_NAMES = (
    "trg_review_items_valid_requires_srs",
    "trg_review_items_no_active_update",
    "trg_knowledge_points_reference_switch_guard",
    "trg_review_items_no_direct_active_insert",
    "trg_review_items_active_requires_state",
    "trg_review_states_requires_admission",
    "trg_review_items_retired_at_monotonic",
    "trg_review_items_admitted_at_monotonic",
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
    if not {"review_items", "review_states", "knowledge_points"} <= tables:
        return

    # The initial migration creates the tables before the P0 status/admitted_at
    # columns are introduced.  Do not install current triggers on that legacy
    # shape: a trigger referring to NEW.status/NEW.admitted_at makes later
    # SQLite table rebuilds fail with "no such column".  The forward migration
    # drops the stale definitions and this installer runs (post-migration) on
    # the current shape.
    review_item_columns = {
        row[1]
        for row in conn.exec_driver_sql("PRAGMA table_info(review_items)").fetchall()
    }
    if not {"status", "admitted_at"} <= review_item_columns:
        return
    for ddl in _TRIGGER_DDL:
        conn.execute(text(ddl))
