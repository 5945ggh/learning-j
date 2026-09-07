"""引擎与会话管理。

SQLite 单用户本地数据集（`data-model.md` §0）：开启 WAL 与
`PRAGMA foreign_keys = ON`（SQLAlchemy 不会替 SQLite 打开外键强制）。
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from learningj.db.base import _sqlite_pragmas  # noqa: F401  # 注册 PRAGMA 钩子
from learningj.db.models.invariant_triggers import install_invariant_triggers


def make_engine(db_url: str | Path) -> Engine:
    """创建引擎。接受 SQLAlchemy URL 字符串或 SQLite 文件路径。"""
    if isinstance(db_url, Path):
        db_url = f"sqlite:///{db_url}"
    engine = create_engine(db_url)
    if db_url.startswith("sqlite"):
        # 迁移产物之外的数据层兜底（幂等）。
        install_invariant_triggers(engine)
    return engine


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


def iter_session(engine: Engine) -> Iterator[Session]:
    """FastAPI 依赖用的会话生成器。"""
    session = make_session_factory(engine)()
    try:
        yield session
    finally:
        session.close()
