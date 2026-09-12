"""P0 开发/测试数据集删除重建基线（ADR-042）。

这些测试只操作 pytest 临时目录。它们锁定显式目标边界、可复现素材 fixture、
当前 schema/应用/契约登记，以及失败时不替换原数据库的 P0 保护证据。
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect

from learningj.api.app import create_app
from learningj.db.base import Base
from learningj.db.maintenance import (
    DEVELOPMENT_BASELINE_TABLE,
    DEVELOPMENT_BASELINE_TABLES,
    DEVELOPMENT_CONTRACT_ID,
    DEVELOPMENT_SCHEMA_ID,
    DEVELOPMENT_SUPPORTED_DATABASES,
    inspect_development_baseline,
    rebuild_development_database,
)
from learningj.db.models.invariant_triggers import TRIGGER_NAMES


def test_rebuild_creates_current_schema_baseline_and_fixture(tmp_path: Path) -> None:
    db_path = tmp_path / "learningj-development.db"

    report = rebuild_development_database(db_path)

    assert report["schema_id"] == DEVELOPMENT_SCHEMA_ID
    assert report["contract_id"] == DEVELOPMENT_CONTRACT_ID
    assert report["supported_databases"] == DEVELOPMENT_SUPPORTED_DATABASES
    assert report["app_version"]
    assert inspect_development_baseline(db_path) == report

    conn = sqlite3.connect(db_path)
    try:
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        triggers = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        }
        expected = set(DEVELOPMENT_BASELINE_TABLES) | {DEVELOPMENT_BASELINE_TABLE}
        assert expected <= tables
        # The P1 baseline is deliberately narrower than the global ORM
        # registry. Future-stage tables must be introduced by their owning
        # phase, not by a disposable material rebuild.
        assert tables - {"sqlite_sequence"} <= expected
        assert "alembic_version" not in tables
        # ReviewItem guards are installed only when their owning P5 tables
        # exist; the narrowed baseline must not create those future tables or
        # their triggers.  Sidecar immutability guards do belong to the P1
        # material chain and must be present.
        assert set(TRIGGER_NAMES) & triggers == {
            "trg_sidecars_immutable_update",
            "trg_sidecars_immutable_delete",
        }
        assert conn.execute("SELECT count(*) FROM materials").fetchone()[0] == 2
        assert conn.execute("SELECT count(*) FROM sentences").fetchone()[0] == 5
        assert conn.execute("SELECT count(*) FROM sidecars").fetchone()[0] == 2
        assert conn.execute("SELECT count(*) FROM lexemes").fetchone()[0] > 0
        assert conn.execute("SELECT count(*) FROM material_lexeme_counts").fetchone()[0] > 0
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        conn.close()


def test_rebuilt_target_is_readable_through_real_material_api(tmp_path: Path) -> None:
    """The atomically replaced target remains a live FastAPI fixture database."""
    db_path = tmp_path / "learningj-development.db"
    rebuild_development_database(db_path)

    client = TestClient(create_app(f"sqlite:///{db_path}"))
    materials = client.get("/materials")
    assert materials.status_code == 200
    material_rows = materials.json()
    assert len(material_rows) == 2
    assert {row["kind"] for row in material_rows} == {"text", "subtitle_video"}

    for material in material_rows:
        material_id = material["id"]
        sentences = client.get(f"/materials/{material_id}/sentences")
        sidecar = client.get(f"/materials/{material_id}/sidecar")
        counts = client.get(f"/materials/{material_id}/lexeme-counts")
        assert sentences.status_code == 200
        assert sidecar.status_code == 200
        assert counts.status_code == 200
        assert all(row["material_id"] == material_id for row in sentences.json())
        assert sidecar.json()["material_id"] == material_id
        assert sidecar.json()["content_hash"] == material["content_hash"]
        # The published content index is readable through the same generation
        # pointer the sidecar response carries.
        assert counts.json()["sidecar_generation_id"] == sidecar.json()["sidecar_generation_id"]
        assert counts.json()["counts"]


@pytest.mark.parametrize("name", ("not-a-database.txt", "fixture.db-wal"))
def test_rebuild_requires_an_explicit_database_file(tmp_path: Path, name: str) -> None:
    target = tmp_path / name

    with pytest.raises(ValueError):
        rebuild_development_database(target)

    assert not target.exists()


def test_rebuild_refuses_a_directory(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        rebuild_development_database(tmp_path)


def test_rebuild_refuses_a_symbolic_link(tmp_path: Path) -> None:
    backing = tmp_path / "backing.db"
    backing.write_bytes(b"preserve backing database")
    target = tmp_path / "linked.db"
    target.symlink_to(backing)

    with pytest.raises(ValueError, match="符号链接"):
        rebuild_development_database(target)

    assert backing.read_bytes() == b"preserve backing database"


def test_application_startup_never_resets_an_unknown_database(tmp_path: Path) -> None:
    db_path = tmp_path / "unknown.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute("CREATE TABLE sentinel (value TEXT NOT NULL)")
        conn.execute("INSERT INTO sentinel VALUES ('keep')")

    app = create_app(f"sqlite:///{db_path}")
    with app.state.engine.connect() as conn:
        assert conn.exec_driver_sql("SELECT value FROM sentinel").scalar_one() == "keep"


def test_rebuild_replaces_only_the_explicit_target_database(tmp_path: Path) -> None:
    db_path = tmp_path / "designated-development.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute("CREATE TABLE discarded_development_data (value TEXT NOT NULL)")
        conn.execute("INSERT INTO discarded_development_data VALUES ('replace me')")

    rebuild_development_database(db_path)

    conn = sqlite3.connect(db_path)
    try:
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        assert "discarded_development_data" not in tables
        assert conn.execute("SELECT count(*) FROM materials").fetchone()[0] == 2
    finally:
        conn.close()


def test_rebuild_failure_preserves_existing_database_and_writes_diagnostic(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = tmp_path / "development.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute("CREATE TABLE preserved (value TEXT NOT NULL)")
        conn.execute("INSERT INTO preserved VALUES ('keep')")
    before = db_path.read_bytes()

    def fail_fixture(_: Path) -> dict[str, object]:
        raise RuntimeError("fixture failure")

    monkeypatch.setattr(
        "learningj.fixtures.material_fixture.populate_fixture_database", fail_fixture
    )
    with pytest.raises(RuntimeError, match="fixture failure"):
        rebuild_development_database(db_path)

    assert db_path.read_bytes() == before
    diagnostic = db_path.with_name(db_path.name + ".rebuild-failure.log")
    assert "target preserved" in diagnostic.read_text(encoding="utf-8")


def test_rebuilt_schema_has_no_future_domain_tables(tmp_path: Path) -> None:
    db_path = tmp_path / "development.db"
    rebuild_development_database(db_path)

    table_names = set(
        inspect(create_app(f"sqlite:///{db_path}").state.engine).get_table_names()
    )
    expected = set(DEVELOPMENT_BASELINE_TABLES) | {DEVELOPMENT_BASELINE_TABLE}
    assert table_names == expected
    assert table_names.isdisjoint(
        set(Base.metadata.tables) - set(DEVELOPMENT_BASELINE_TABLES)
    )
