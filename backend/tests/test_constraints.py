"""数据层行为测试：写入路径上的约束实际生效。

这部分是 P0 能落库的最小行为证明：不放行业务逻辑，只验证模型约束。
ReviewItem 语义按 ADR-041 / `data-model.md` §7.1 重写：status 为
queued/active/paused/retired，`admitted_at` 与 `retired_at` 单向写入。
"""

from __future__ import annotations

import uuid

import pytest
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
            " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                ids["analysis"], ids["sentence"], ids["material"], "model", "v1",
                "[]", "[]", "[]", 0, TS, TS,
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


def _insert_review_item(
    engine: Engine,
    item_id: str,
    kp_id: str,
    occurrence_id: str,
    status: str,
    *,
    admitted_at: str | None = None,
    retired_at: str | None = None,
) -> None:
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "INSERT INTO review_items (id, kp_id, occurrence_id, status, admitted_at,"
            " retired_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (item_id, kp_id, occurrence_id, status, admitted_at, retired_at, TS, TS),
        )


def _insert_review_state(conn, item_id: str) -> None:
    conn.exec_driver_sql(
        "INSERT INTO review_states (review_item_id, state, stability, difficulty,"
        " reps, lapses, history, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (item_id, 0, 0.0, 0.0, 0, 0, "[]", TS, TS),
    )


def _admit(engine: Engine, item_id: str, *, admitted_at: str = TS) -> None:
    """合法首次准入：同一事务内 paused(admitted_at) → ReviewState → active。

    ReviewState 通过外键依赖 ReviewItem 行，不能先于行存在；因此 active 只能
    是 UPDATE 的目标。`paused` 是同一事务内的中间态（§7.1 允许 admitted_at
    非空的 paused），对外不可见。
    """
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "UPDATE review_items SET status = 'paused', admitted_at = ? WHERE id = ?",
            (admitted_at, item_id),
        )
        _insert_review_state(conn, item_id)
        conn.exec_driver_sql(
            "UPDATE review_items SET status = 'active' WHERE id = ?", (item_id,)
        )


# ---------------------------------------------------------------------------
# 非 ReviewItem 约束
# ---------------------------------------------------------------------------


def test_anchor_unique_convergence(migrated_engine: Engine) -> None:
    """§9 不变量 11 的数据层保证：同一 anchor 的第二次插入被唯一约束拒绝。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    with pytest.raises(Exception, match="UNIQUE"):
        _insert_kp(migrated_engine, str(uuid.uuid4()), "〜てしまう", "srs")


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


# ---------------------------------------------------------------------------
# ReviewItem §7.1：queued / active / paused / retired
# ---------------------------------------------------------------------------


def test_queued_item_has_no_admission_marker(migrated_engine: Engine) -> None:
    """§7.1：queued 的 admitted_at 与 retired_at 均为空。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    _insert_review_item(
        migrated_engine, str(uuid.uuid4()), ids["kp"], ids["occurrence"], "queued"
    )


def test_queued_rejects_admitted_at(migrated_engine: Engine) -> None:
    """§7.1：queued 的 admitted_at 必须为空（CHECK）。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    with pytest.raises(Exception, match="admitted_at_semantics"):
        _insert_review_item(
            migrated_engine, str(uuid.uuid4()), ids["kp"], ids["occurrence"],
            "queued", admitted_at=TS,
        )


def test_queued_rejects_retired_at(migrated_engine: Engine) -> None:
    """§7.1：queued/active/paused 不得携带 retired_at（CHECK）。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    with pytest.raises(Exception, match="status_retired_at_equivalent"):
        _insert_review_item(
            migrated_engine, str(uuid.uuid4()), ids["kp"], ids["occurrence"],
            "queued", retired_at=TS,
        )


def test_direct_active_insert_is_rejected(migrated_engine: Engine) -> None:
    """§7.1：active 必须已有 ReviewState；ReviewState 不可能先于 ReviewItem 行
    存在，因此直接 INSERT active 一律拒绝（触发器）。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    with pytest.raises(Exception, match="must already have"):
        _insert_review_item(
            migrated_engine, str(uuid.uuid4()), ids["kp"], ids["occurrence"],
            "active", admitted_at=TS,
        )


def test_active_update_requires_review_state(migrated_engine: Engine) -> None:
    """§7.1：转为 active 时必须已有 ReviewState（触发器），先写状态后补状态
    的时序被拒绝。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    item_id = str(uuid.uuid4())
    _insert_review_item(
        migrated_engine, item_id, ids["kp"], ids["occurrence"], "queued"
    )
    with migrated_engine.begin() as conn:
        conn.exec_driver_sql(
            "UPDATE review_items SET status = 'paused', admitted_at = ? WHERE id = ?",
            (TS, item_id),
        )
    with engine_raises_match(migrated_engine, "must already have a ReviewState"):
        with migrated_engine.begin() as conn:
            conn.exec_driver_sql(
                "UPDATE review_items SET status = 'active' WHERE id = ?", (item_id,)
            )


def test_active_requires_admitted_at_check(migrated_engine: Engine) -> None:
    """§7.1：active 必须有 admitted_at（CHECK）。

    触发器同样保护该转换（`test_active_update_requires_review_state`），这里
    单独移除状态守卫，隔离验证 CHECK 本身。
    """
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    item_id = str(uuid.uuid4())
    _insert_review_item(
        migrated_engine, item_id, ids["kp"], ids["occurrence"], "paused"
    )
    with migrated_engine.begin() as conn:
        conn.exec_driver_sql("DROP TRIGGER trg_review_items_active_requires_state")
    with pytest.raises(Exception, match="admitted_at_semantics"):
        with migrated_engine.begin() as conn:
            conn.exec_driver_sql(
                "UPDATE review_items SET status = 'active' WHERE id = ?", (item_id,)
            )


def test_legal_admission_sequence_satisfies_active_contract(
    migrated_engine: Engine,
) -> None:
    """§7.1：合法准入后 active 已有 admitted_at 与 ReviewState，且没有退役标记。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    item_id = str(uuid.uuid4())
    _insert_review_item(
        migrated_engine, item_id, ids["kp"], ids["occurrence"], "queued"
    )
    _admit(migrated_engine, item_id)
    with migrated_engine.connect() as conn:
        row = conn.exec_driver_sql(
            "SELECT status, admitted_at, retired_at FROM review_items WHERE id = ?",
            (item_id,),
        ).fetchone()
        state = conn.exec_driver_sql(
            "SELECT review_item_id FROM review_states WHERE review_item_id = ?",
            (item_id,),
        ).fetchone()
    assert row[0] == "active"
    assert row[1] is not None
    assert row[2] is None
    assert state == (item_id,)


def test_queued_item_has_no_review_state(migrated_engine: Engine) -> None:
    """§7.1/§7.2：queued 不得有 ReviewState（触发器）。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    item_id = str(uuid.uuid4())
    _insert_review_item(
        migrated_engine, item_id, ids["kp"], ids["occurrence"], "queued"
    )
    with engine_raises_match(migrated_engine, "requires an admitted review item"):
        with migrated_engine.begin() as conn:
            _insert_review_state(conn, item_id)


def test_pre_admission_paused_has_no_review_state(migrated_engine: Engine) -> None:
    """§7.2：准入前暂停的 ReviewItem 同样不得有 ReviewState（触发器）。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    item_id = str(uuid.uuid4())
    _insert_review_item(
        migrated_engine, item_id, ids["kp"], ids["occurrence"], "paused"
    )
    with engine_raises_match(migrated_engine, "requires an admitted review item"):
        with migrated_engine.begin() as conn:
            _insert_review_state(conn, item_id)


def test_post_admission_paused_keeps_state_and_marker(migrated_engine: Engine) -> None:
    """§7.1：准入后暂停保留 admitted_at 与 ReviewState；reference 走 paused。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    item_id = str(uuid.uuid4())
    _insert_review_item(
        migrated_engine, item_id, ids["kp"], ids["occurrence"], "queued"
    )
    _admit(migrated_engine, item_id)
    with migrated_engine.begin() as conn:
        conn.exec_driver_sql(
            "UPDATE review_items SET status = 'paused' WHERE id = ?", (item_id,)
        )
    with migrated_engine.connect() as conn:
        row = conn.exec_driver_sql(
            "SELECT status, admitted_at FROM review_items WHERE id = ?", (item_id,)
        ).fetchone()
        state = conn.exec_driver_sql(
            "SELECT review_item_id FROM review_states WHERE review_item_id = ?",
            (item_id,),
        ).fetchone()
    assert row[0] == "paused"
    assert row[1] is not None
    assert state == (item_id,)


def test_accessory_time_markers_are_write_once(migrated_engine: Engine) -> None:
    """§7.1：admitted_at 与 retired_at 都是从空值单向写入，不得修改或清除。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    item_id = str(uuid.uuid4())
    _insert_review_item(
        migrated_engine, item_id, ids["kp"], ids["occurrence"], "queued"
    )
    _admit(migrated_engine, item_id)
    with engine_raises_match(migrated_engine, "admitted_at is write-once"):
        with migrated_engine.begin() as conn:
            conn.exec_driver_sql(
                "UPDATE review_items SET admitted_at = NULL WHERE id = ?", (item_id,)
            )
    with engine_raises_match(migrated_engine, "admitted_at is write-once"):
        with migrated_engine.begin() as conn:
            conn.exec_driver_sql(
                "UPDATE review_items SET admitted_at = ? WHERE id = ?",
                ("2027-01-01 00:00:00.000000", item_id),
            )

    # retired_at：写入后清除被拒绝；NULL → 非空允许，且与 status 同次提交。
    retired_id = str(uuid.uuid4())
    _insert_review_item(
        migrated_engine, retired_id, ids["kp"], _fresh_occurrence(migrated_engine, ids),
        "retired", retired_at=TS,
    )
    with engine_raises_match(migrated_engine, "retired_at is write-once"):
        with migrated_engine.begin() as conn:
            conn.exec_driver_sql(
                "UPDATE review_items SET retired_at = NULL WHERE id = ?", (retired_id,)
            )
    item2 = str(uuid.uuid4())
    _insert_review_item(
        migrated_engine, item2, ids["kp"], _fresh_occurrence(migrated_engine, ids),
        "queued",
    )
    _admit(migrated_engine, item2)
    with migrated_engine.begin() as conn:
        conn.exec_driver_sql(
            "UPDATE review_items SET status = 'retired', retired_at = ? WHERE id = ?",
            (TS, item2),
        )


def _fresh_occurrence(engine: Engine, ids: dict[str, str]) -> str:
    occurrence_id = str(uuid.uuid4())
    _insert_occurrence(engine, ids, occurrence_id, ids["kp"])
    return occurrence_id


def test_status_retired_at_equivalence_is_enforced(migrated_engine: Engine) -> None:
    """§7.1 / §9 不变量 4 的数据层部分：retired ⇔ retired_at 非空。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    # retired + NULL retired_at：拒绝（INSERT）。
    with pytest.raises(Exception, match="status_retired_at_equivalent"):
        _insert_review_item(
            migrated_engine, str(uuid.uuid4()), ids["kp"], ids["occurrence"],
            "retired",
        )
    # active + 非 NULL retired_at：拒绝（UPDATE 侧，先满足 ReviewState 与
    # admitted_at 前置条件，隔离等价 CHECK）。
    item_id = str(uuid.uuid4())
    _insert_review_item(
        migrated_engine, item_id, ids["kp"], ids["occurrence"], "paused",
        admitted_at=TS,
    )
    with migrated_engine.begin() as conn:
        _insert_review_state(conn, item_id)
    with pytest.raises(Exception, match="status_retired_at_equivalent"):
        with migrated_engine.begin() as conn:
            conn.exec_driver_sql(
                "UPDATE review_items SET status = 'active', retired_at = ? WHERE id = ?",
                (TS, item_id),
            )


# ---------------------------------------------------------------------------
# §9 不变量 3：reference 不得有 active 卡，paused 合法
# ---------------------------------------------------------------------------


def test_reference_kp_allows_paused_review_item(migrated_engine: Engine) -> None:
    """§7.1：reference 的 KP 对应非退役卡片均 paused——插入 paused 卡合法。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜文化梗", "reference")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    _insert_review_item(
        migrated_engine, str(uuid.uuid4()), ids["kp"], ids["occurrence"], "paused"
    )


def test_reference_never_activates_queued_item(migrated_engine: Engine) -> None:
    """ADR-041 / §7.1：reference 意愿绝不激活 queued 项——即使已有配额证据
    （admitted_at + ReviewState），转 active 仍被拒绝。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜文化梗", "reference")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    item_id = str(uuid.uuid4())
    _insert_review_item(
        migrated_engine, item_id, ids["kp"], ids["occurrence"], "queued"
    )
    with engine_raises_match(migrated_engine, "invariant 3"):
        _admit(migrated_engine, item_id)


def test_invariant3_rejects_active_review_item_kp_update_to_reference(
    migrated_engine: Engine,
) -> None:
    """不变量 3：把 active 卡改挂到 reference KP 被拒绝。"""
    ids = _seed_minimal_world(migrated_engine)
    reference_kp = str(uuid.uuid4())
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    _insert_kp(migrated_engine, reference_kp, "〜文化梗", "reference")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    item_id = str(uuid.uuid4())
    _insert_review_item(
        migrated_engine, item_id, ids["kp"], ids["occurrence"], "queued"
    )
    _admit(migrated_engine, item_id)
    with engine_raises_match(migrated_engine, "invariant 3"):
        with migrated_engine.begin() as conn:
            conn.exec_driver_sql(
                "UPDATE review_items SET kp_id = ? WHERE id = ?",
                (reference_kp, item_id),
            )


def test_invariant3_rejects_retention_update_with_active_card(migrated_engine: Engine) -> None:
    """不变量 3 的 KP 侧：切到 reference 时仍有 active 卡 → 拒绝；先暂停再切换。"""
    ids = _seed_minimal_world(migrated_engine)
    _insert_kp(migrated_engine, ids["kp"], "〜てしまう", "srs")
    _insert_occurrence(migrated_engine, ids, ids["occurrence"], ids["kp"])
    item_id = str(uuid.uuid4())
    _insert_review_item(
        migrated_engine, item_id, ids["kp"], ids["occurrence"], "queued"
    )
    _admit(migrated_engine, item_id)
    with engine_raises_match(migrated_engine, "invariant 3"):
        with migrated_engine.begin() as conn:
            conn.exec_driver_sql(
                "UPDATE knowledge_points SET retention = 'reference' WHERE kp_id = ?",
                (ids["kp"],),
            )
    # The legal order is to pause the card first, then switch retention.
    with migrated_engine.begin() as conn:
        conn.exec_driver_sql(
            "UPDATE review_items SET status = 'paused' WHERE id = ?", (item_id,)
        )
        conn.exec_driver_sql(
            "UPDATE knowledge_points SET retention = 'reference' WHERE kp_id = ?",
            (ids["kp"],),
        )


def engine_raises_match(engine: Engine, pattern: str):
    """SQLite 的 IntegrityError 文本包含触发器 RAISE 的消息。"""
    return pytest.raises(Exception, match=pattern)
