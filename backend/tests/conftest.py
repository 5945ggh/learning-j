"""共享 fixture：临时 SQLite 数据库 + 已迁移的引擎。"""

from __future__ import annotations

import io
import json
import zipfile

import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import Engine

from learningj.db.base import Base
import learningj.db.models  # noqa: F401  # 注册全部表
from learningj.db.models.invariant_triggers import install_invariant_triggers

_FIXED_ZIP_TIME = (2026, 9, 12, 0, 0, 0)


def build_yomitan_zip(
    entries: list | None = None,
    *,
    index: dict | None = None,
    extra_files: dict[str, bytes] | None = None,
    omit: set[str] | None = None,
) -> bytes:
    """确定性 Yomitan ZIP 构造器（词典/阅读器测试共用）。"""
    entries = [["走る", "はしる", "v5", "", 10, "to run"]] if entries is None else entries
    index = {"title": "テスト辞書", "revision": "2026-09-12"} if index is None else index
    members: dict[str, bytes | str] = {
        "index.json": json.dumps(index, ensure_ascii=False),
        "term_bank_1.json": json.dumps(entries, ensure_ascii=False),
    }
    if extra_files:
        members.update(extra_files)
    for name in omit or set():
        members.pop(name, None)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        for name, content in members.items():
            info = zipfile.ZipInfo(name, date_time=_FIXED_ZIP_TIME)
            archive.writestr(info, content if isinstance(content, bytes) else content.encode("utf-8"))
    return buffer.getvalue()


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


@pytest.fixture()
def dev_reader_environment(tmp_path) -> "TestClient":  # noqa: F821
    """真实重建的开发基线库 + 全量 P2 API 客户端（不变量/跨面测试用）。"""
    from pathlib import Path

    from fastapi.testclient import TestClient

    from learningj.api.app import create_app
    from learningj.db.maintenance import rebuild_development_database

    db_path = tmp_path / "development.db"
    rebuild_development_database(db_path)
    client = TestClient(create_app(f"sqlite:///{db_path}", assets_root=tmp_path / "assets"))
    client.app.state.db_path = db_path  # type: ignore[attr-defined]
    return client


__all__ = ["inspect", "Base", "build_yomitan_zip"]
