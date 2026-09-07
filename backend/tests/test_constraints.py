"""数据层行为测试：写入路径上的约束实际生效。

这部分是 P0 能落库的最小行为证明：不放行业务逻辑，只验证模型约束。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import insert
from sqlalchemy.engine import Engine

TS = "2026-01-01T00:00:00+00:00"


def _seed_minimal_world(engine: Engine) -> dict[str, str]:
    """material + sentence + analysis + extraction_run，供 Occurrence 引用。"""
    ids = {
        "material": str(uuid.uuid4()),
        "sentence": str(uuid.uuid4()),
        "analysis": str(uuid.uuid4()),
        "run": str(uuid.uuid4()),
        "section_version": str(uuid.uuid4()),
        "section_logical": str(uuid.uuid4()),
        "kp": str(uuid.uuid4()),
        "occurrence": str(uuid.uuid4()),
    }
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "INSERT INTO materials (id, title, content_hash, locator, kind, copy_stored,"
            " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (ids["material"], "t", "hash", "locator", "text", 0, TS, TS),
        )
        conn.exec_driver_sql(
            'INSERT INTO sentences (id, material_id, "index", text, anchor_type,'
            " anchor_payload, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (ids["sentence"], ids["material"], 0, "テスト", "plain_text", "{}", TS, TS),
        )
        conn.exec_driver_sql(
            "INSERT INTO analyses (id, sentence_id, material_id, model, prompt_version,"
            " style_modules, context_kp_ids, context_note_ids, retrieval_enabled,"
            " turn_count, session_closed, status, extraction_status, extraction_trigger,"
            " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                ids["analysis"], ids["sentence"], ids["material"], "model", "v1",
                "[]", "[]", "[]", 0, 1, 0, "ready", "pending", "user", TS, TS,
            ),
        )
        conn.exec_driver_sql(
            "INSERT INTO extraction_runs (id, analysis_id, execution_path, model,"
            " prompt_version, status, unresolved_surfaces, candidate_count, started_at,"
            " finished_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                ids["run"], ids["analysis"], "standalone", "model", "v1", "done",
                "[]", 0, TS, TS, TS, TS,
            ),
        )
        conn.exec_driver_sql(
            "INSERT INTO analysis_sections (section_version_id, section_id,"
            " analysis_id, heading_path, split_strategy, kind, body_md, revision,"
            " origin_turn, superseded_by, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                ids["section_version"], ids["section_logical"], ids["analysis"],
                "[]", "fallback_single", "takeaway", "本文", 1, 1, None, TS, TS,
            ),
        )
    return ids


def _insert_kp(engine: Engine, kp_id: str, anchor: str, retention: str) -> None:
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "INSERT INTO knowledge_points (kp_id, anchor, anchor_shape, anchor_payload,"
            " display_form, tags, retention, retention_set_by, origin, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (kp_id, anchor, "lexical", '{"lexeme_id": "dummy"}', anchor, "[]", retention, "default", "extraction", TS, TS),
        )


def _insert_occurrence(engine: Engine, ids: dict[str, str], occurrence_id: str, kp_id: str) -> None:
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "INSERT INTO occurrences (id, kp_id, sentence_id, material_id, salience,"
            " content_source, section_id, section_revision, source_analysis_id,"
            " extraction_run_id, extractor_model, extractor_prompt_version, brief,"
            " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                occurrence_id, kp_id, ids["sentence"], ids["material"], "primary",
                "analysis_section", ids["section_logical"], 1, ids["analysis"],
                ids["run"], "model", "v1", "要点", TS, TS,
            ),
        )


def test_anchor_unique_convergence(migrated_engine: Engine) -> None:
    """§9 不变量 11 的数据层保证：同一 anchor 的第二次插入被唯一约束拒绝。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    with pytest.raises(Exception, match="UNIQUE"):
        _insert_kp(migrated_engine, str(uuid.uuid4()), "〜てしまう", "srs")


def test_invariant3_reference_kp_rejects_active_review_item(migrated_engine: Engine) -> None:
    """§9 不变量 3：reference KP 不得有 retired_at IS NULL 的有效项（触发器）。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜文化梗", "reference")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    with engine_raises_match(migrated_engine, "invariant 3"):
        with migrated_engine.begin() as conn:
            conn.exec_driver_sql(
                "INSERT INTO review_items (id, kp_id, occurrence_id, created_at,"
                " updated_at) VALUES (?,?,?,?,?)",
                (str(uuid.uuid4()), ids["kp"], ids["occurrence"], TS, TS),
            )


def test_retired_at_is_write_once(migrated_engine: Engine) -> None:
    """§0：retired_at 只能从空值单向写入，不得修改或清除（触发器）。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    item_id = str(uuid.uuid4())
    with migrated_engine.begin() as conn:
        conn.exec_driver_sql(
            "INSERT INTO review_items (id, kp_id, occurrence_id, retired_at,"
            " created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (item_id, ids["kp"], ids["occurrence"], TS, TS, TS),
        )
    with engine_raises_match(migrated_engine, "retired_at"):
        with migrated_engine.begin() as conn:
            conn.exec_driver_sql(
                "UPDATE review_items SET retired_at = NULL WHERE id = ?", (item_id,)
            )
    # 单向写入时间戳允许（从 NULL -> 非空）。
    ids2 = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids2["kp"], "〜別", "srs")
    _insert_occurrence(migrated_engine, ids2, ids2["occurrence"], ids2["kp"])
    item2 = str(uuid.uuid4())
    with migrated_engine.begin() as conn:
        conn.exec_driver_sql(
            "INSERT INTO review_items (id, kp_id, occurrence_id, created_at,"
            " updated_at) VALUES (?,?,?,?,?)",
            (item2, ids2["kp"], ids2["occurrence"], TS, TS),
        )
        conn.exec_driver_sql(
            "UPDATE review_items SET retired_at = ? WHERE id = ?", (TS, item2)
        )


def test_occurrence_requires_existing_section_version(migrated_engine: Engine) -> None:
    """§3.3 约束 2 / §9 不变量 2：内容引用必须是真实存在的 (section_id, revision)。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    with pytest.raises(Exception):
        with migrated_engine.begin() as conn:
            conn.exec_driver_sql(
                "INSERT INTO occurrences (id, kp_id, sentence_id, material_id, salience,"
                " content_source, section_id, section_revision, source_analysis_id,"
                " extraction_run_id, extractor_model, extractor_prompt_version, brief,"
                " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    str(uuid.uuid4()), ids["kp"], ids["sentence"], ids["material"],
                    "primary", "analysis_section", str(uuid.uuid4()), 99,
                    ids["analysis"], ids["run"], "model", "v1", "要点", TS, TS,
                ),
            )


def engine_raises_match(engine: Engine, pattern: str):
    """SQLite 的 IntegrityError 文本包含触发器 RAISE 的消息。"""
    import re

    return pytest.raises(Exception, match=pattern)
