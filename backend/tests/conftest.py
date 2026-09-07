"""共享 fixture：临时 SQLite 数据库 + 已迁移的引擎。"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import Engine

from learningj.db.base import Base
import learningj.db.models  # noqa: F401  # 注册全部表
from learningj.db.models.invariant_triggers import install_invariant_triggers


@pytest.fixture()
def migrated_engine(tmp_path) -> Engine:
    """直接 `create_all` 的引擎（schema 检查与触发器行为测试用）。"""
    engine = create_engine(f"sqlite:///{tmp_path}/test.db")
    Base.metadata.create_all(engine)
    install_invariant_triggers(engine)
    return engine


@pytest.fixture()
def any_engine(tmp_path) -> Engine:
    return create_engine(f"sqlite:///{tmp_path}/scratch.db")


__all__ = ["inspect", "Base"]
