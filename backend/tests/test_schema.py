"""P0 验收：对 schema 做空库检查，确认全部表和关键唯一约束存在。

空库 = `alembic upgrade head` 之后的数据库。migration 文件位置由
`ALEMBIC_INI` 环境变量或仓库默认路径决定。
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from sqlalchemy import inspect
from sqlalchemy.engine import Engine

BACKEND_DIR = Path(__file__).resolve().parents[1]

EXPECTED_TABLES = {
    "materials",
    "sentences",
    "sidecars",
    "spans",
    "occurrence_spans",
    "analysis_section_spans",
    "annotation_spans",
    "dictionary_sources",
    "dictionary_entries",
    "dictionary_definitions",
    "dictionary_assets",
    "dictionary_import_runs",
    "lexemes",
    "known_evidence",
    "knowledge_points",
    "aliases",
    "occurrences",
    "analyses",
    "extraction_runs",
    "analysis_sections",
    "analysis_messages",
    "annotations",
    "material_notes",
    "learner_profile_notes",
    "review_items",
    "review_states",
}


@pytest.fixture(scope="module")
def upgraded_db(tmp_path_factory) -> Path:
    """在空 SQLite 文件上执行 `alembic upgrade head`，返回数据库路径。"""
    db_path = tmp_path_factory.mktemp("schema") / "upgraded.db"
    subprocess.run(
        [
            "uv",
            "run",
            "alembic",
            "-x",
            f"db_url=sqlite:///{db_path}",
            "upgrade",
            "head",
        ],
        cwd=BACKEND_DIR,
        check=True,
        capture_output=True,
        text=True,
    )
    return db_path


@pytest.fixture(scope="module")
def upgraded_engine(upgraded_db: Path) -> Engine:
    from learningj.db.session import make_engine

    return make_engine(upgraded_db)


def test_upgrade_head_creates_all_tables(upgraded_engine: Engine) -> None:
    tables = set(inspect(upgraded_engine).get_table_names())
    missing = EXPECTED_TABLES - tables
    assert not missing, f"upgrade head 后缺少表: {sorted(missing)}"


def test_no_polymorphic_owner_columns(upgraded_engine: Engine) -> None:
    """§1：禁止 owner_type/owner_id 多态外键，必须使用真实外键关联表。"""
    inspector = inspect(upgraded_engine)
    for table in EXPECTED_TABLES:
        columns = {c["name"] for c in inspector.get_columns(table)}
        assert "owner_type" not in columns, f"{table} 不应有 owner_type"
        assert "owner_id" not in columns, f"{table} 不应有 owner_id"


def test_span_link_tables_use_real_foreign_keys(upgraded_engine: Engine) -> None:
    inspector = inspect(upgraded_engine)
    fks = {
        table: {(fk["referred_table"], fk["constrained_columns"][0]) for fk in fks}
        for table, fks in (
            ("occurrence_spans", inspector.get_foreign_keys("occurrence_spans")),
            (
                "analysis_section_spans",
                inspector.get_foreign_keys("analysis_section_spans"),
            ),
            ("annotation_spans", inspector.get_foreign_keys("annotation_spans")),
        )
    }
    assert ("spans", "span_id") in fks["occurrence_spans"]
    assert ("occurrences", "occurrence_id") in fks["occurrence_spans"]
    assert ("spans", "span_id") in fks["analysis_section_spans"]
    assert ("spans", "span_id") in fks["annotation_spans"]


def test_key_unique_constraints(upgraded_engine: Engine) -> None:
    inspector = inspect(upgraded_engine)

    def unique_sets(table: str) -> set[frozenset[str]]:
        return {
            frozenset(u["column_names"])
            for u in inspector.get_unique_constraints(table)
        }

    # §3.1 约束 6：anchor 唯一（§9 不变量 11 的数据层保证）。
    assert frozenset({"anchor"}) in unique_sets("knowledge_points")
    # §4.3 版本约束：(section_id, revision) 唯一。
    assert frozenset({"section_id", "revision"}) in unique_sets("analysis_sections")
    # Lexeme 三元组自然键唯一。
    assert frozenset({"normalized_form", "pos", "reading_form"}) in unique_sets(
        "lexemes"
    )
    # Sentence 材料内序号唯一。
    assert frozenset({"material_id", "index"}) in unique_sets("sentences")
    # Span 关联表的顺序约束。
    assert frozenset({"annotation_id", "ordinal"}) in unique_sets("annotation_spans")
    assert frozenset({"section_version_id", "ordinal"}) in unique_sets(
        "analysis_section_spans"
    )
    # §4.2：重跑保序，运行表主键自签发即可；ExtractionRun 的 retry 链不允许
    # 指向自身的数据层检查由 CHECK 承载（此处检查列存在）。
    extraction_cols = {c["name"] for c in inspector.get_columns("extraction_runs")}
    assert {"retry_of", "failure_reason", "unresolved_surfaces"} <= extraction_cols


def test_invariant_triggers_installed(upgraded_engine: Engine) -> None:
    from sqlalchemy import text

    with upgraded_engine.connect() as conn:
        triggers = {
            row[0]
            for row in conn.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='trigger'"
            ).fetchall()
        }
    assert "trg_review_items_valid_requires_srs" in triggers
    assert "trg_review_items_retired_at_monotonic" in triggers


def test_spans_is_standalone_table(upgraded_engine: Engine) -> None:
    """§1：spans 是独立表，有自己的 span_id 主键与 sentence 外键。"""
    inspector = inspect(upgraded_engine)
    cols = {c["name"]: c for c in inspector.get_columns("spans")}
    assert cols["span_id"]["primary_key"] == 1
    assert {"sentence_id", "surface", "char_start", "char_end", "alignment_status"} <= (
        set(cols)
    )
    pk_cols = [c["name"] for c in inspector.get_columns("spans") if c["primary_key"]]
    assert pk_cols == ["span_id"]
