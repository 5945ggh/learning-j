"""P0 迁移工具链测试：前滚升级、备份/恢复检查、回归样本。

迁移是 forward-only；本文件验证：
- 空库与旧库回归样本（1c1fc8f7fc96，带数据）都能前滚到 head；
- analyses 第二状态机列被移除、保留列数据完好；
- review_items.status 回填到 ADR-041 语义：legacy active + ReviewState →
  active（写 admitted_at）、无状态 active → queued、reference → paused、
  retired 保持，并受 queued/active 语义 CHECK 约束；
- extraction_runs.analysis_revision_id 兼容列存在且可空；
- 触发器按 status/admitted_at 语义重建（reference 禁 active、允许 paused、
  active 需 ReviewState、queued 无 ReviewState）；
- 备份可打开、含版本标记，验证在隔离副本执行；
- 升级失败保留备份与诊断。
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from learningj.db.maintenance import (
    BACKUP_TAKEN_ENV,
    _schema_version,
    _run_alembic,
    backup_database,
    build_regression_sample,
    forward_upgrade,
    verify_backup,
)

LEGACY = "1c1fc8f7fc96"
HEAD = "c66997d83060"
LEGACY_TS = "2026-01-15 00:00:00.000000"
DROPPED_COLUMNS = {"status", "extraction_status", "extraction_trigger", "session_closed", "turn_count"}


@pytest.fixture(scope="module")
def regression_sample(tmp_path_factory) -> Path:
    return build_regression_sample(tmp_path_factory.mktemp("regression") / "legacy.db")


@pytest.fixture()
def upgraded_sample(regression_sample: Path, tmp_path: Path) -> Engine:
    """复制回归样本后前滚到 head，返回引擎（不改动共享样本）。"""
    db_path = tmp_path / "upgraded.db"
    shutil.copy(regression_sample, db_path)
    _run_alembic("head", db_path)
    from learningj.db.session import make_engine

    return make_engine(f"sqlite:///{db_path}")


def _table_columns(db_path: Path, table: str) -> list[str]:
    conn = sqlite3.connect(db_path)
    try:
        return [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]
    finally:
        conn.close()


def test_regression_sample_is_at_legacy_revision(regression_sample: Path) -> None:
    conn = sqlite3.connect(regression_sample)
    try:
        version = conn.execute("SELECT version_num FROM alembic_version").fetchall()
        assert version == [(LEGACY,)]
        # 旧形状：第二状态机列仍在，review_items 无 status。
        analyses_cols = [r[1] for r in conn.execute("PRAGMA table_info(analyses)")]
        assert DROPPED_COLUMNS <= set(analyses_cols)
        review_cols = [r[1] for r in conn.execute("PRAGMA table_info(review_items)")]
        assert "status" not in review_cols
        # 遗留 KE 来源（7 个值）都有样本行。
        sources = {r[0] for r in conn.execute("SELECT source FROM known_evidence")}
        assert sources == {
            "reading_inferred", "analysis_marked", "import_anki", "import_jpdb",
            "srs_matured", "listening_native", "listening_tts",
        }
        # 历史触发器按 retired_at 语义（迁移前的世界）。
        triggers = {
            r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='trigger'"
            )
        }
        assert {"trg_review_items_valid_requires_srs", "trg_review_items_retired_at_monotonic"} <= triggers
    finally:
        conn.close()


def test_build_regression_sample_refuses_to_overwrite_nonempty(tmp_path: Path) -> None:
    """历史工具链护栏：非空目标默认拒绝覆盖，必须显式 force。"""
    out = tmp_path / "legacy.db"
    build_regression_sample(out)
    with pytest.raises(FileExistsError, match="拒绝覆盖"):
        build_regression_sample(out)
    build_regression_sample(out, force=True)
    assert out.exists()


def test_direct_alembic_upgrade_takes_pre_migration_backup(
    tmp_path: Path, monkeypatch
) -> None:
    """§1.6：绕开 forward_upgrade、直接 `alembic upgrade` 也必须自动备份。"""
    monkeypatch.delenv("LEARNINGJ_MIGRATION_BACKUP_TAKEN", raising=False)
    db_path = build_regression_sample(tmp_path / "legacy.db")
    before = set(tmp_path.glob("legacy-backup-*.db"))
    _run_alembic("head", db_path)
    after = set(tmp_path.glob("legacy-backup-*.db"))
    assert len(after) == len(before) + 1, sorted(after)
    backup = (after - before).pop()
    assert verify_backup(backup)["schema_version"] == LEGACY


def test_direct_alembic_upgrade_skips_backup_at_head(tmp_path: Path, monkeypatch) -> None:
    """已到 head 的 no-op 升级不再产生备份（避免无意义的历史副本）。"""
    monkeypatch.delenv("LEARNINGJ_MIGRATION_BACKUP_TAKEN", raising=False)
    db_path = tmp_path / "db.db"
    _run_alembic("head", db_path)
    assert list(tmp_path.glob("db-backup-*.db")) == []
    _run_alembic("head", db_path)
    assert list(tmp_path.glob("db-backup-*.db")) == []


def test_upgrade_empty_db_to_head(tmp_path: Path) -> None:
    db_path = tmp_path / "empty.db"
    _run_alembic("head", db_path)
    conn = sqlite3.connect(db_path)
    try:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchall() == [(HEAD,)]
    finally:
        conn.close()


def test_upgrade_removes_second_state_machine_and_keeps_history(
    upgraded_sample: Engine, tmp_path: Path
) -> None:
    db_path = tmp_path / "upgraded.db"
    columns = set(_table_columns(db_path, "analyses"))
    assert not DROPPED_COLUMNS & columns, f"第二状态机列应已删除，仍存在: {sorted(DROPPED_COLUMNS & columns)}"
    # 保留列数据完好。
    with upgraded_sample.connect() as conn:
        rows = conn.execute(
            text("SELECT user_question, style_modules, context_kp_ids FROM analyses ORDER BY id")
        ).fetchall()
        assert len(rows) == 3
        assert any(row[0] == "为什么用られた？" for row in rows)
        assert any(row[0] is None for row in rows)


def test_upgrade_backfills_review_item_status(upgraded_sample: Engine, tmp_path: Path) -> None:
    db_path = tmp_path / "upgraded.db"
    review_cols = set(_table_columns(db_path, "review_items"))
    assert {"status", "admitted_at", "retired_at"} <= review_cols
    assert "analysis_revision_id" in _table_columns(db_path, "extraction_runs")
    with upgraded_sample.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT retired_at, status, admitted_at FROM review_items ORDER BY id"
            )
        ).fetchall()
        assert rows == [
            # legacy active + ReviewState → active，admitted_at 取排程证据。
            (None, "active", LEGACY_TS),
            # retired 保持，未被准入证据标记。
            (LEGACY_TS, "retired", None),
            # reference 的非退役卡 → paused（准入前暂停，admitted_at 为空）。
            (None, "paused", None),
            # legacy active 但没有 ReviewState → queued（等待首次配额）。
            (None, "queued", None),
        ]


def test_upgrade_backfills_review_item_admitted_at_from_state(
    upgraded_sample: Engine,
) -> None:
    """§7.1：只有存在 ReviewState 的项写入 admitted_at，且不晚于排程创建时间。"""
    with upgraded_sample.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT r.status, r.admitted_at, rs.created_at"
                " FROM review_items r LEFT JOIN review_states rs"
                " ON rs.review_item_id = r.id ORDER BY r.id"
            )
        ).fetchall()
    assert rows[0] == ("active", LEGACY_TS, LEGACY_TS)
    assert rows[1][1] is None and rows[1][2] is None
    assert rows[2][1] is None and rows[2][2] is None
    assert rows[3] == ("queued", None, None)


def test_upgraded_constraints_enforce_status_semantics(upgraded_sample: Engine) -> None:
    """ADR-041 / §7.1：queued/active/admitted_at/retired_at 语义 CHECK 实际生效。"""
    with upgraded_sample.begin() as conn:
        kp = conn.execute(
            text("SELECT kp_id FROM knowledge_points WHERE retention = 'srs' LIMIT 1")
        ).fetchone()[0]
        # 插入一条未被任何 ReviewItem 引用的 occurrence，避免撞
        # UNIQUE(kp_id, occurrence_id) 掩盖 CHECK 断言。
        conn.execute(
            text(
                "INSERT INTO occurrences (id, kp_id, sentence_id, material_id,"
                " salience, content_source, section_id, section_revision,"
                " source_analysis_id, extraction_run_id, extractor_model,"
                " extractor_prompt_version, brief, created_at, updated_at)"
                " SELECT :new_occ, :kp, sentence_id, material_id, 'primary',"
                " content_source, section_id, section_revision, source_analysis_id,"
                " extraction_run_id, extractor_model, extractor_prompt_version,"
                " '测试出现', created_at, updated_at FROM occurrences LIMIT 1"
            ),
            {"new_occ": "9" * 32, "kp": kp},
        )

        def _try(bind: dict) -> None:
            conn.execute(
                text(
                    "INSERT INTO review_items (id, kp_id, occurrence_id, status,"
                    " admitted_at, retired_at, created_at, updated_at)"
                    " VALUES (:id, :kp, :occ, :status, :admitted, :retired,"
                    " '2026-01-15 00:00:00', '2026-01-15 00:00:00')"
                ),
                bind,
            )

        ts = "2026-01-15 00:00:00"
        base = {"kp": kp, "occ": "9" * 32, "admitted": None, "retired": None}
        # queued 的 retired_at 必须为空。
        with pytest.raises(Exception, match="status_retired_at_equivalent"):
            _try({**base, "id": "a" * 32, "status": "queued", "retired": ts})
        # retired ⇔ retired_at 非空。
        with pytest.raises(Exception, match="status_retired_at_equivalent"):
            _try({**base, "id": "b" * 32, "status": "retired"})
        # queued 的 admitted_at 必须为空。
        with pytest.raises(Exception, match="admitted_at_semantics"):
            _try({**base, "id": "c" * 32, "status": "queued", "admitted": ts})
        # active 不能直接 INSERT（必须已有 ReviewState）。
        with pytest.raises(Exception, match="must already have"):
            _try({**base, "id": "d" * 32, "status": "active", "admitted": ts})


def test_upgraded_trigger_allows_paused_card_for_reference_kp(upgraded_sample: Engine) -> None:
    """不变量 3：reference 允许 paused，且绝不把 queued 激活。"""
    with upgraded_sample.begin() as conn:
        reference_kp = conn.execute(
            text("SELECT kp_id FROM knowledge_points WHERE retention = 'reference'")
        ).fetchone()[0]
        conn.execute(
            text(
                "INSERT INTO occurrences (id, kp_id, sentence_id, material_id,"
                " salience, content_source, section_id, section_revision,"
                " source_analysis_id, extraction_run_id, extractor_model,"
                " extractor_prompt_version, brief, created_at, updated_at)"
                " SELECT :new_occ, :kp, sentence_id, material_id, 'primary',"
                " content_source, section_id, section_revision, source_analysis_id,"
                " extraction_run_id, extractor_model, extractor_prompt_version,"
                " '测试出现', created_at, updated_at FROM occurrences LIMIT 1"
            ),
            {"new_occ": "e" * 32, "kp": reference_kp},
        )
        conn.execute(
            text(
                "INSERT INTO occurrences (id, kp_id, sentence_id, material_id,"
                " salience, content_source, section_id, section_revision,"
                " source_analysis_id, extraction_run_id, extractor_model,"
                " extractor_prompt_version, brief, created_at, updated_at)"
                " SELECT :new_occ, :kp, sentence_id, material_id, 'primary',"
                " content_source, section_id, section_revision, source_analysis_id,"
                " extraction_run_id, extractor_model, extractor_prompt_version,"
                " '测试出现', created_at, updated_at FROM occurrences LIMIT 1"
            ),
            {"new_occ": "g" * 32, "kp": reference_kp},
        )
        # paused（准入前，admitted_at 为空）合法（§7.1）。
        conn.execute(
            text(
                "INSERT INTO review_items (id, kp_id, occurrence_id, status,"
                " admitted_at, retired_at, created_at, updated_at)"
                " VALUES (:id, :kp, :occ, 'paused', NULL, NULL,"
                " '2026-01-15 00:00:00', '2026-01-15 00:00:00')"
            ),
            {"id": "d" * 32, "kp": reference_kp, "occ": "e" * 32},
        )
        # queued 也合法（用户已明确加入、等待配额），但不允许被激活。
        conn.execute(
            text(
                "INSERT INTO review_items (id, kp_id, occurrence_id, status,"
                " admitted_at, retired_at, created_at, updated_at)"
                " VALUES (:id, :kp, :occ, 'queued', NULL, NULL,"
                " '2026-01-15 00:00:00', '2026-01-15 00:00:00')"
            ),
            {"id": "f" * 32, "kp": reference_kp, "occ": "g" * 32},
        )
    # 准入顺序：paused(admitted_at) → ReviewState → active。
    with upgraded_sample.begin() as conn:
        conn.execute(
            text(
                "UPDATE review_items SET status = 'paused', admitted_at ="
                " '2026-01-15 00:00:00' WHERE id = :id"
            ),
            {"id": "f" * 32},
        )
        conn.execute(
            text(
                "INSERT INTO review_states (review_item_id, state, stability,"
                " difficulty, reps, lapses, history, created_at, updated_at)"
                " VALUES (:item, 0, 0.0, 0.0, 0, 0, '[]',"
                " '2026-01-15 00:00:00', '2026-01-15 00:00:00')"
            ),
            {"item": "f" * 32},
        )
    with pytest.raises(Exception, match="invariant 3"):
        with upgraded_sample.begin() as conn:
            conn.execute(
                text("UPDATE review_items SET status = 'active' WHERE id = :id"),
                {"id": "f" * 32},
            )


def test_upgraded_database_has_current_trigger_set(upgraded_sample: Engine) -> None:
    """前滚后当前触发器集合完整（旧定义已替换，含 admitted_at/ReviewState 守卫）。"""
    from learningj.db.models.invariant_triggers import TRIGGER_NAMES

    with upgraded_sample.connect() as conn:
        triggers = {
            row[0]
            for row in conn.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='trigger'"
            ).fetchall()
        }
    assert set(TRIGGER_NAMES) <= triggers, sorted(set(TRIGGER_NAMES) - triggers)


def test_foreign_keys_survive_table_rebuild(upgraded_sample: Engine) -> None:
    """analyses 重建后，引用它的 FK 仍可用（messages 可新增）。"""
    with upgraded_sample.connect() as conn:
        assert conn.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
        analysis_id = conn.execute(text("SELECT id FROM analyses LIMIT 1")).fetchone()[0]
        conn.execute(
            text(
                "INSERT INTO analysis_messages (id, analysis_id, turn_index, role, content)"
                " VALUES (:id, :aid, 3, 'user', '补一条消息')"
            ),
            {"id": "f" * 32, "aid": analysis_id},
        )


def test_forward_upgrade_produces_exactly_one_backup(tmp_path: Path, monkeypatch) -> None:
    """forward_upgrade 已备份时 env.py 不再重复备份（握手避免双份）。"""
    monkeypatch.delenv("LEARNINGJ_MIGRATION_BACKUP_TAKEN", raising=False)
    db_path = build_regression_sample(tmp_path / "legacy.db")
    result = forward_upgrade(db_path, tmp_path / "backups")
    backups = list((tmp_path / "backups").glob("*.db"))
    assert len(backups) == 1
    assert backups[0] == result.backup_path
    assert list(tmp_path.glob("legacy-backup-*.db")) == []


def test_backup_marker_is_restored_between_in_process_upgrades(
    tmp_path: Path, monkeypatch
) -> None:
    """进程内连续升级两个非空库时，env.py 的自动备份不能被上一次的握手标记跳过。

    `_run_alembic` 只对本次升级置标记，退出即还原；否则第二个库会静默失去
    §1.6 的迁移前备份兜底（CR-2026-09-10 P2）。
    """
    monkeypatch.delenv(BACKUP_TAKEN_ENV, raising=False)
    first = build_regression_sample(tmp_path / "first.db")
    second = build_regression_sample(tmp_path / "second.db")

    _run_alembic("head", first)
    assert BACKUP_TAKEN_ENV not in os.environ, "标记必须只对本次升级有效"
    _run_alembic("head", second)

    assert list(tmp_path.glob("first-backup-*.db")), "第一个库应被自动备份"
    assert list(tmp_path.glob("second-backup-*.db")), "第二个库也应被自动备份"


def test_backup_roundtrip(tmp_path: Path) -> None:
    db_path = tmp_path / "db.db"
    _run_alembic("head", db_path)
    result = backup_database(db_path, tmp_path / "backups")
    assert result.schema_version_before == HEAD
    assert result.integrity_check == "ok"
    report = verify_backup(result.backup_path, result.manifest_path)
    assert report == {
        "integrity_check": "ok",
        "foreign_key_check": "ok",
        "schema_version": HEAD,
    }

    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert manifest["type"] == "learningj-pre-migration-backup"
    assert manifest["schema_version_before"] == HEAD
    assert manifest["app_version"]

    # 篡改 manifest 的版本标记后验证必须失败。
    manifest["schema_version_before"] = "deadbeef"
    result.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(RuntimeError, match="版本戳与 manifest 不符"):
        verify_backup(result.backup_path, result.manifest_path)


def test_empty_database_backup_and_verify_allows_null_schema_version(tmp_path: Path) -> None:
    db_path = tmp_path / "empty.db"
    db_path.touch()
    result = backup_database(db_path, tmp_path / "backups")
    assert result.schema_version_before is None
    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert "schema_version_before" in manifest
    assert manifest["schema_version_before"] is None
    assert verify_backup(result.backup_path, result.manifest_path) == {
        "integrity_check": "ok",
        "foreign_key_check": "ok",
        "schema_version": "none",
    }


def test_forward_upgrade_accepts_existing_empty_database(tmp_path: Path) -> None:
    db_path = tmp_path / "empty.db"
    db_path.touch()
    result = forward_upgrade(db_path, tmp_path / "backups")
    assert result.schema_version_before is None
    assert _schema_version(db_path) == HEAD


def test_failed_upgrade_keeps_backup_and_diagnostics(tmp_path: Path, monkeypatch) -> None:
    db_path = tmp_path / "db.db"
    _run_alembic("head", db_path)

    def _boom(target: str, db: Path) -> None:
        raise RuntimeError("模拟迁移失败")

    monkeypatch.setattr("learningj.db.maintenance._run_alembic", _boom)
    with pytest.raises(RuntimeError, match="模拟迁移失败"):
        forward_upgrade(db_path, tmp_path / "backups")
    backups = list((tmp_path / "backups").glob("*.db"))
    diagnostics = list((tmp_path / "backups").glob("*.upgrade-failure.log"))
    assert len(backups) == 1 and len(diagnostics) == 1
    assert "模拟迁移失败" in diagnostics[0].read_text(encoding="utf-8")


def test_repeated_backups_keep_distinct_files(tmp_path: Path, monkeypatch) -> None:
    """同一数据库同一时间戳的备份也必须通过独占创建保留两份。"""
    from learningj.db import maintenance

    db_path = tmp_path / "db.db"
    _run_alembic("head", db_path)
    monkeypatch.setattr(maintenance, "_backup_stamp", lambda: "same-stamp")
    first = backup_database(db_path, tmp_path / "backups")
    second = backup_database(db_path, tmp_path / "backups")
    assert first.backup_path != second.backup_path
    assert first.backup_path.exists() and second.backup_path.exists()
    assert first.manifest_path.exists() and second.manifest_path.exists()


def _insert_orphan_analysis_message(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute(
            "INSERT INTO analysis_messages (id, analysis_id, turn_index, role, content)"
            " VALUES (?, ?, ?, ?, ?)",
            ("orphan-message", "missing-analysis", 1, "user", "孤儿引用"),
        )
        conn.commit()
    finally:
        conn.close()


def test_verify_backup_rejects_orphan_foreign_key(tmp_path: Path) -> None:
    db_path = tmp_path / "db.db"
    _run_alembic("head", db_path)
    _insert_orphan_analysis_message(db_path)
    result = backup_database(db_path, tmp_path / "backups")
    assert result.foreign_key_check.startswith("1 violations")
    with pytest.raises(RuntimeError, match="备份副本外键检查失败"):
        verify_backup(result.backup_path, result.manifest_path)


def test_migration_rejects_orphan_before_rebuild(tmp_path: Path) -> None:
    db_path = build_regression_sample(tmp_path / "legacy.db")
    _insert_orphan_analysis_message(db_path)
    with pytest.raises(RuntimeError, match="before migration"):
        _run_alembic("head", db_path)


def test_forward_upgrade_rejects_orphan_and_keeps_diagnostic(tmp_path: Path) -> None:
    db_path = tmp_path / "db.db"
    _run_alembic("head", db_path)
    _insert_orphan_analysis_message(db_path)
    with pytest.raises(RuntimeError, match="备份副本外键检查失败"):
        forward_upgrade(db_path, tmp_path / "backups")
    diagnostics = list((tmp_path / "backups").glob("*.upgrade-failure.log"))
    backups = list((tmp_path / "backups").glob("*.db"))
    assert len(backups) == 1 and len(diagnostics) == 1
    assert "analysis_messages" in diagnostics[0].read_text(encoding="utf-8")
    assert _schema_version(db_path) == HEAD
