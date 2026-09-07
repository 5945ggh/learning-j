"""数据层不变量触发器（§9 不变量 3 与 `retired_at` 单向标记）。

SQLite 的 CHECK 约束无法跨表判断，这两条必须有数据库级兜底；
其余不变量由唯一约束/外键/CHECK 或测试承载。

`install_invariant_triggers` 是幂等的：目标表尚未建立时（如空库上运行
`alembic revision --autogenerate`）静默跳过，等下一次 upgrade 再安装。
"""

from __future__ import annotations

import sqlite3
from typing import TYPE_CHECKING

from sqlalchemy import Connection, Engine, text

if TYPE_CHECKING:  # pragma: no cover
    pass

# §9 不变量 3：retention = reference 的 KP 不得存在 retired_at IS NULL 的
# 有效 ReviewItem。
_RETIRED_INVARIANT = """
CREATE TRIGGER IF NOT EXISTS trg_review_items_valid_requires_srs
BEFORE INSERT ON review_items
WHEN NEW.retired_at IS NULL AND (
    SELECT retention FROM knowledge_points WHERE kp_id = NEW.kp_id
) = 'reference'
BEGIN
    SELECT RAISE(ABORT, 'invariant 3: reference KP must not have an active review item');
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
    if not {"review_items", "knowledge_points"} <= tables:
        return
    conn.execute(text(_RETIRED_INVARIANT))
    conn.execute(text(_RETIRED_MONOTONIC))
