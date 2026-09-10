"""Alembic 迁移环境。

从 `learningj.db.models` 取完整 metadata（P0 一次建全表）。
数据库 URL 优先级：`-x db_url=` > 环境变量 `LEARNINGJ_DB_URL` >
`alembic.ini` 的 `sqlalchemy.url`。
"""

from __future__ import annotations

import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from alembic.script import ScriptDirectory
from sqlalchemy import engine_from_config, pool
from sqlalchemy.engine import make_url

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


def _sqlite_file_path() -> Path | None:
    """本次升级目标若是已存在的 SQLite 文件库，返回其路径，否则 None。"""
    cfg = config.get_section(config.config_ini_section, {})
    url = _db_url() or cfg.get("sqlalchemy.url")
    if not url or not url.startswith("sqlite"):
        return None
    database = make_url(url).database
    if not database or database == ":memory:":
        return None
    path = Path(database)
    if not path.exists() or path.stat().st_size == 0:
        return None
    return path


def _has_pending_migration(path: Path) -> bool:
    """已有 schema 且版本不是当前 head 时才需要迁移前备份。"""
    import sqlite3

    conn = sqlite3.connect(path)
    try:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
                " AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
        }
        stamped = (
            conn.execute("SELECT version_num FROM alembic_version").fetchall()
            if "alembic_version" in tables
            else []
        )
    finally:
        conn.close()
    if not tables:
        return False
    head = ScriptDirectory.from_config(config).get_current_head()
    return not (stamped and stamped[0][0] == head)


def _ensure_pre_migration_backup() -> None:
    """`mvp-tech-and-phases.md` §1.6：非空库前滚前自动生成带版本标记的备份。

    `learningj.db.maintenance.forward_upgrade()` 已经生成并隔离校验过备份时，
    通过 `LEARNINGJ_MIGRATION_BACKUP_TAKEN` 告知本入口，避免重复备份；因此
    直接执行 `alembic upgrade head` 的开发者/脚本也获得同一保护。空库首次建表
    与已到 head 的 no-op 升级不做备份。
    """
    # `env.py` 由 alembic 在 `learningj` 可导入后执行；maintenance 顶层只依赖
    # 标准库，因此这里的局部导入不引入环。
    from learningj.db.maintenance import BACKUP_TAKEN_ENV, backup_database

    if os.environ.get(BACKUP_TAKEN_ENV):
        return
    path = _sqlite_file_path()
    if path is None or not _has_pending_migration(path):
        return
    result = backup_database(path)
    os.environ[BACKUP_TAKEN_ENV] = str(result.backup_path)
    print(f"[learningj] pre-migration backup: {result.backup_path}")


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


def _sqlite_foreign_key_violations(connection) -> list[tuple]:  # noqa: ANN001
    """Return SQLite's full foreign-key diagnostics for this connection."""
    return list(connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall())


def _assert_sqlite_foreign_keys(connection, phase: str) -> None:  # noqa: ANN001
    violations = _sqlite_foreign_key_violations(connection)
    if not violations:
        return
    details = "; ".join(
        "table={!r}, rowid={!r}, parent={!r}, fk_index={!r}".format(*row)
        for row in violations
    )
    raise RuntimeError(
        f"SQLite foreign_key_check failed {phase}: "
        f"{len(violations)} violation(s): {details}"
    )


def run_migrations_online() -> None:
    # §1.6 迁移纪律：非空库前滚前先做自动备份（forward_upgrade 已备份则跳过）。
    _ensure_pre_migration_backup()

    cfg = config.get_section(config.config_ini_section, {})
    override = _db_url()
    if override:
        cfg["sqlalchemy.url"] = override

    connectable = engine_from_config(
        cfg,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    if connectable.dialect.name == "sqlite":
        # batch copy 重建需要对被 analysis_messages/occurrences/review_states
        # 引用的表做 DROP/RENAME；FK 强制开启时 DROP TABLE 的隐式 DELETE 会
        # 做引用检查并失败。必须在连接建立时（任何语句/事务之前）关闭，
        # 事务内或语句执行后设置都无效或破坏事务记账；迁移数据完整性由
        # 迁移脚本自身的回填与重建顺序负责。在 base.py 的 connect 钩子
        # （FK=ON）之后注册，后者先执行，此处覆盖为 OFF。
        from sqlalchemy import event

        @event.listens_for(connectable, "connect")
        def _fk_off_for_migration(dbapi_connection, _record):  # noqa: ANN001
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=OFF")
            cursor.close()

    with connectable.connect() as connection:
        if connectable.dialect.name == "sqlite":
            # SQLite table rebuilds deliberately run with FK enforcement off;
            # foreign_key_check remains available in that mode and is the
            # explicit integrity gate for both the source and result schema.
            _assert_sqlite_foreign_keys(connection, "before migration")
            # SQLAlchemy 2.x may autobegin around the diagnostic SELECT.  End
            # that read transaction so Alembic owns and commits its migration
            # transaction (otherwise alembic_version can remain uncommitted).
            connection.commit()

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()

        if connectable.dialect.name == "sqlite":
            _assert_sqlite_foreign_keys(connection, "after migration")

        # 触发器是数据层契约的一部分，在迁移提交、表建好之后安装（幂等）。
        # SQLite 触发器 DDL 不参与 Alembic 的事务回滚，因此放在事务外。
        install_invariant_triggers(_EngineFacade(connection))


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
