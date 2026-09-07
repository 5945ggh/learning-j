"""声明式基类、命名约定与公共列。

全局约定（`data-model.md` §0）：

- 所有实体带 `id`（UUIDv7）与 `created_at` / `updated_at`；
  个别实体的主键另有自然名（`lexeme_id`、`kp_id`、`section_version_id`、
  `span_id`、`review_item_id`），以契约中的名称命名；
- 所有时间为 UTC；
- SQLite 打开 WAL 与外键强制（见 `db/session.py`）。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, MetaData, Uuid, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from learningj.domain.ids import new_uuid7

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


@event.listens_for(Engine, "connect")
def _sqlite_pragmas(dbapi_connection, _record) -> None:  # noqa: ANN001
    """所有 SQLite 连接启用外键强制（WAL 在 session.py 里对文件库设置，
    内存库无意义）。挂在模块级：import 本模块即注册，任何入口都生效。"""
    import sqlite3

    if isinstance(dbapi_connection, sqlite3.Connection):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.close()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UuidPk:
    """UUIDv7 自签发主键，列名 `id`。"""

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=new_uuid7)


class Timestamped:
    """`created_at` / `updated_at`（UTC）。"""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
