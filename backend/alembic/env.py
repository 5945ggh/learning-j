"""Alembic 迁移环境。

从 `learningj.db.models` 取完整 metadata（P0 一次建全表）。
数据库 URL 优先级：`-x db_url=` > 环境变量 `LEARNINGJ_DB_URL` >
`alembic.ini` 的 `sqlalchemy.url`。
"""

from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from learningj.db.base import Base
import learningj.db.models  # noqa: F401  # 注册全部表
from learningj.db.models.invariant_triggers import install_invariant_triggers

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _db_url() -> str | None:
    x_args = context.get_x_argument(as_dictionary=True)
    if x_args.get("db_url"):
        return x_args["db_url"]
    return os.environ.get("LEARNINGJ_DB_URL")


def run_migrations_offline() -> None:
    url = _db_url() or config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


class _EngineFacade:
    """把 Connection 适配成 `install_invariant_triggers` 需要的
    `engine.begin()` 形状（进入时事务已由 Alembic 管理，直接透传 execute）。"""

    def __init__(self, connection) -> None:  # noqa: ANN001
        self._connection = connection

    def begin(self):  # noqa: ANN201
        return _NullContext(self._connection)


class _NullContext:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self._connection = connection

    def __enter__(self):  # noqa: ANN201
        return self._connection

    def __exit__(self, *args) -> None:  # noqa: ANN002
        return None


def run_migrations_online() -> None:
    cfg = config.get_section(config.config_ini_section, {})
    override = _db_url()
    if override:
        cfg["sqlalchemy.url"] = override

    connectable = engine_from_config(
        cfg,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()
        # 触发器是数据层契约的一部分，在迁移提交、表建好之后安装（幂等）。
        # SQLite 触发器 DDL 不参与 Alembic 的事务回滚，因此放在事务外。
        install_invariant_triggers(_EngineFacade(connection))


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
