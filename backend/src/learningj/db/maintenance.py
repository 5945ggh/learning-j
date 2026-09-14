"""数据库维护工具（`docs/mvp-tech-and-phases.md` §1.6、ADR-042）。

职责：

- 开发基线重建：仅对 CLI 明确指定的开发／测试 SQLite 路径，删除重建当前
  schema、灌入确定性素材 fixture，并登记基线身份；开发阶段不做旧库迁移、
  legacy 回填或兼容分支；
- 全库快照导出：生成一致性 SQLite 快照，附带资源/sidecar 清单 manifest；
  manifest 的 schema／契约版本读自目标库的开发基线登记表（无登记表记
  null，隔离验证时要求一致）；
- 快照验证：在隔离目录打开副本，做 integrity/foreign-key check 并核对
  清单与基线身份。

命令（backend/ 目录下执行）::

    uv run python -m learningj.db.maintenance rebuild-development-db --db /tmp/learningj-dev.db
    uv run python -m learningj.db.maintenance export-snapshot --db learningj.db --out <快照.db>
    uv run python -m learningj.db.maintenance verify-snapshot --snapshot <快照.db>

`rebuild-development-db` 是当前开发期唯一的建库路径：它不读取任何迁移链、
不升级或回填旧库，也绝不由应用启动自动调用。它先在同目录临时库完成建表、
fixture 和检查，成功后才原子替换明确指定的目标；失败保留旧目标并留下诊断。

受支持数据库的版本化升级、升级前备份和隔离恢复检查属于真实数据／对外发布
前登记受支持基线时的工作（ADR-042 §1.6）；本阶段不携带迁移工具链。
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import shutil
import sqlite3
import tempfile
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

MANIFEST_SUFFIX = ".manifest.json"
_SNAPSHOT_MANIFEST_TYPE = "learningj-library-snapshot"
DEVELOPMENT_BASELINE_TABLE = "learningj_development_baseline"
DEVELOPMENT_SCHEMA_ID = "learningj-development-schema-2026-09-14-rf01"
DEVELOPMENT_CONTRACT_ID = "learningj-contract-2026-09-14-rf01"
DEVELOPMENT_SUPPORTED_DATABASES = "designated-development-test-rebuild-only"
# P0 delivered the material browsing chain; P1 owns the content index
# (lexemes + MaterialLexemeCount); P2 owns the reader evidence layer: the
# canonical dictionary tables, KnownEvidence plus decisions/retractions/summary
# projection, and Annotation with its shared spans table (data-model §§2/5,
# §11.1).  Later domain tables (KP, Occurrence, ReviewItem, StudySession, …)
# are still created by their owning phase when first used; they must not leak
# into this baseline merely because they are registered on the global ORM
# metadata.  occurrence_spans / analysis_section_spans stay out because their
# owning tables do not exist yet.
DEVELOPMENT_BASELINE_TABLES = (
    "materials",
    "sentences",
    "sidecars",
    "lexemes",
    "material_lexeme_counts",
    # P2: canonical dictionary model (data-model §2.0)
    "dictionary_sources",
    "dictionary_entries",
    "dictionary_definitions",
    "dictionary_assets",
    "dictionary_import_runs",
    # P2: evidence, decisions, retraction, summary projection (§2.2/§2.5/§11.2)
    "known_evidence",
    "lexeme_knowledge_decisions",
    "known_evidence_retractions",
    "lexeme_evidence_summaries",
    "lexeme_projection_state",
    # P2: Annotation + shared spans (§5, §1; annotation_spans only — the other
    # span link tables reference P4 tables that do not exist in this baseline)
    "annotations",
    "spans",
    "annotation_spans",
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _app_version() -> str:
    try:
        return importlib.metadata.version("backend")
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def _development_baseline_record() -> dict[str, str]:
    return {
        "schema_id": DEVELOPMENT_SCHEMA_ID,
        "app_version": _app_version(),
        "contract_id": DEVELOPMENT_CONTRACT_ID,
        "supported_databases": DEVELOPMENT_SUPPORTED_DATABASES,
    }


def _validate_development_db_path(db_path: Path) -> Path:
    """Accept only an explicit ordinary SQLite database file path.

    The command's deletion authority is deliberately narrow.  A caller must
    name a `.db` file; directories, links and SQLite auxiliary-file names are
    never valid targets.
    """
    requested = db_path.expanduser()
    if requested.is_symlink():
        raise ValueError(f"开发重建目标不得是符号链接: {requested}")
    path = requested.resolve(strict=False)
    if path.suffix != ".db":
        raise ValueError("开发重建目标必须是明确的 .db 文件路径")
    if path.name in {".db", ""} or path.name.endswith(("-wal.db", "-shm.db", "-journal.db")):
        raise ValueError("开发重建目标必须是 SQLite 主数据库文件")
    if path.exists() and (path.is_symlink() or not path.is_file()):
        raise ValueError(f"开发重建目标必须是普通文件: {path}")
    return path


def _remove_sqlite_sidecars(db_path: Path) -> None:
    for suffix in ("-wal", "-shm", "-journal"):
        db_path.with_name(db_path.name + suffix).unlink(missing_ok=True)


def _write_development_baseline(conn: sqlite3.Connection) -> None:
    record = _development_baseline_record()
    conn.execute(
        f"CREATE TABLE {DEVELOPMENT_BASELINE_TABLE} ("
        "schema_id TEXT NOT NULL, "
        "app_version TEXT NOT NULL, "
        "contract_id TEXT NOT NULL, "
        "supported_databases TEXT NOT NULL, "
        "created_at_utc TEXT NOT NULL"
        ")"
    )
    conn.execute(
        f"INSERT INTO {DEVELOPMENT_BASELINE_TABLE} ("
        "schema_id, app_version, contract_id, supported_databases, created_at_utc"
        ") VALUES (?, ?, ?, ?, ?)",
        (*record.values(), _utc_now()),
    )


def inspect_development_baseline(db_path: Path) -> dict[str, str]:
    """Return the current development-baseline record after integrity checks."""
    path = _validate_development_db_path(db_path)
    if not path.exists():
        raise FileNotFoundError(f"开发数据库不存在: {path}")
    conn = sqlite3.connect(path)
    try:
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        fk_state = _foreign_key_state(conn)
        row = conn.execute(
            f"SELECT schema_id, app_version, contract_id, supported_databases "
            f"FROM {DEVELOPMENT_BASELINE_TABLE}"
        ).fetchall()
    finally:
        conn.close()
    if integrity != "ok" or fk_state != "ok":
        raise RuntimeError(
            f"开发基线完整性检查失败: integrity_check={integrity}; foreign_key_check={fk_state}"
        )
    if len(row) != 1:
        raise RuntimeError("开发基线记录必须恰有一条")
    keys = ("schema_id", "app_version", "contract_id", "supported_databases")
    return dict(zip(keys, row[0], strict=True))


def rebuild_development_database(db_path: Path) -> dict[str, str]:
    """Explicitly rebuild one development/test database from the current schema.

    No database discovery, automatic startup hook, migration, legacy read, or
    backfill participates in this operation.  The replacement only occurs
    after the temporary database has the explicit P1+P2 schema (material
    chain, content index, reader evidence layer), baseline metadata, the
    reproducible material fixture, and SQLite integrity checks. Future
    domain triggers are intentionally absent until their owning tables exist.
    """
    from learningj.db.base import Base
    from learningj.db.models.annotation import Annotation
    from learningj.db.models.dictionary import (
        DictionaryAsset,
        DictionaryDefinition,
        DictionaryEntry,
        DictionaryImportRun,
        DictionarySource,
    )
    from learningj.db.models.lexeme import (
        KnownEvidence,
        KnownEvidenceRetraction,
        Lexeme,
        LexemeEvidenceSummary,
        LexemeKnowledgeDecision,
        LexemeProjectionState,
    )
    from learningj.db.models.material import (
        Material,
        MaterialLexemeCount,
        Sentence,
        Sidecar,
    )
    from learningj.db.models.span import Span, annotation_spans
    from learningj.db.models.invariant_triggers import install_invariant_triggers
    from learningj.db.session import make_engine
    from learningj.fixtures.material_fixture import populate_fixture_database

    target = _validate_development_db_path(db_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(tempfile.mkdtemp(prefix=f".{target.stem}-rebuild-", dir=target.parent))
    staging = temp_dir / target.name
    diagnostic = target.with_name(target.name + ".rebuild-failure.log")
    try:
        engine = make_engine(staging)
        try:
            # Do not call Base.metadata.create_all() without an explicit table
            # list: that would materialize P3–P5 tables in the P2 baseline.
            Base.metadata.create_all(
                engine,
                tables=[
                    Material.__table__,
                    Sentence.__table__,
                    Sidecar.__table__,
                    Lexeme.__table__,
                    MaterialLexemeCount.__table__,
                    DictionarySource.__table__,
                    DictionaryEntry.__table__,
                    DictionaryDefinition.__table__,
                    DictionaryAsset.__table__,
                    DictionaryImportRun.__table__,
                    KnownEvidence.__table__,
                    LexemeKnowledgeDecision.__table__,
                    KnownEvidenceRetraction.__table__,
                    LexemeEvidenceSummary.__table__,
                    LexemeProjectionState.__table__,
                    Annotation.__table__,
                    Span.__table__,
                    annotation_spans,
                ],
            )
            install_invariant_triggers(engine)
        finally:
            engine.dispose()
        with sqlite3.connect(staging) as conn:
            _write_development_baseline(conn)
        populate_fixture_database(staging)
        report = inspect_development_baseline(staging)
        os.replace(staging, target)
        _remove_sqlite_sidecars(target)
        diagnostic.unlink(missing_ok=True)
        return report
    except Exception:
        _write_diagnostics(
            diagnostic,
            [
                f"development rebuild failed at {_utc_now()}",
                f"target preserved: {target}",
                f"staging: {staging}",
                "operation: current-schema rebuild with deterministic material fixture",
                "",
                traceback.format_exc(),
            ],
        )
        raise
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _foreign_key_state(conn: sqlite3.Connection) -> str:
    """`PRAGMA foreign_key_check` 的结果："ok" 或违规描述。

    批量写入与快照副本可能携带孤儿引用且不会被即时报错——重建、导出与
    隔离恢复前后必须显式检查。
    """
    violations = conn.execute("PRAGMA foreign_key_check").fetchall()
    if not violations:
        return "ok"
    tables = sorted({row[0] for row in violations})
    return f"{len(violations)} violations (tables: {', '.join(tables)})"


def _write_diagnostics(path: Path, lines: list[str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


@dataclass(frozen=True)
class SnapshotResult:
    snapshot_path: Path
    manifest_path: Path
    schema_id: str | None
    contract_id: str | None


def _baseline_identity(conn: sqlite3.Connection) -> tuple[str | None, str | None]:
    """Read the (schema_id, contract_id) a database declares about itself.

    A rebuilt development database carries exactly one baseline record; any
    other database (or a damaged registry) reports (None, None), and the
    snapshot verification then requires the manifest to agree.
    """
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    if DEVELOPMENT_BASELINE_TABLE not in tables:
        return None, None
    rows = conn.execute(
        f"SELECT schema_id, contract_id FROM {DEVELOPMENT_BASELINE_TABLE}"
    ).fetchall()
    if len(rows) != 1:
        return None, None
    return rows[0][0], rows[0][1]


def _snapshot_inventory(conn: sqlite3.Connection) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """Return only stable resource/sidecar identities, never payload contents."""
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {"materials", "sidecars"} <= tables:
        return [], []
    resources = [
        {"material_id": row[0], "locator": row[1], "storage_mode": row[2], "source_sha256": row[3]}
        for row in conn.execute(
            "SELECT id, locator, storage_mode, source_sha256 FROM materials ORDER BY id"
        ).fetchall()
    ]
    sidecars = [
        {
            "sidecar_generation_id": row[0], "material_id": row[1], "content_hash": row[2],
            "segmenter_version": row[3], "tokenizer_version": row[4],
            "analyzer_dict_version": row[5], "payload_bytes": row[6],
        }
        for row in conn.execute(
            "SELECT id, material_id, content_hash, segmenter_version, tokenizer_version, "
            "analyzer_dict_version, length(payload) FROM sidecars ORDER BY id"
        ).fetchall()
    ]
    return resources, sidecars


def export_snapshot(db_path: Path, out_path: Path) -> SnapshotResult:
    """Write an immutable full-library SQLite snapshot plus an inventory manifest.

    The snapshot is a consistent SQLite backup of the whole database; the
    manifest records the export time, exporter version, the schema/contract
    identity the database itself declares, and the resource/sidecar inventory.
    Verification happens in an isolated copy before the export succeeds.
    """
    source = db_path.resolve()
    destination = out_path.resolve()
    if not source.is_file():
        raise FileNotFoundError(f"数据库不存在: {source}")
    if destination.exists():
        raise FileExistsError(f"快照输出已存在，拒绝覆盖: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        src = sqlite3.connect(source)
        try:
            resources, sidecars = _snapshot_inventory(src)
            schema_id, contract_id = _baseline_identity(src)
            dst = sqlite3.connect(destination)
            try:
                with dst:
                    src.backup(dst)
            finally:
                dst.close()
        finally:
            src.close()
        manifest_path = Path(str(destination) + MANIFEST_SUFFIX)
        manifest_path.write_text(json.dumps({
            "type": _SNAPSHOT_MANIFEST_TYPE,
            "created_at_utc": _utc_now(),
            "app_version": _app_version(),
            "schema_id": schema_id,
            "contract_id": contract_id,
            "resources": resources,
            "sidecars": sidecars,
        }, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        verify_snapshot(destination, manifest_path)
    except Exception:
        destination.unlink(missing_ok=True)
        Path(str(destination) + MANIFEST_SUFFIX).unlink(missing_ok=True)
        raise
    return SnapshotResult(destination, manifest_path, schema_id, contract_id)


def verify_snapshot(snapshot_path: Path, manifest_path: Path | None = None) -> dict[str, str | None]:
    """Open a snapshot in an isolated copy and verify its manifest inventory.

    隔离恢复检查：完整性、外键、资源/sidecar 清单和数据库自报的
    schema／契约身份必须与 manifest 完全一致；身份为 null 也要一致，
    防止清单被替换后仍通过。
    """
    snapshot = snapshot_path.resolve()
    manifest_file = manifest_path or Path(str(snapshot) + MANIFEST_SUFFIX)
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    required = {"type", "created_at_utc", "app_version", "schema_id", "contract_id", "resources", "sidecars"}
    missing = required - set(manifest)
    if manifest.get("type") != _SNAPSHOT_MANIFEST_TYPE or missing:
        raise ValueError(f"快照 manifest 无效，缺少: {sorted(missing)}")
    if not isinstance(manifest["app_version"], str) or not manifest["app_version"]:
        raise ValueError("manifest app_version 无效")
    if not isinstance(manifest["created_at_utc"], str):
        raise ValueError("manifest created_at_utc 无效")
    try:
        created_at = datetime.fromisoformat(manifest["created_at_utc"].replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("manifest created_at_utc 不是有效 ISO-8601 时间") from exc
    if created_at.tzinfo is None:
        raise ValueError("manifest created_at_utc 必须带时区")

    with tempfile.TemporaryDirectory(prefix="lj-snapshot-verify-") as tmp:
        isolated = Path(tmp) / snapshot.name
        shutil.copy(snapshot, isolated)
        conn = sqlite3.connect(isolated)
        try:
            integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
            fk_state = _foreign_key_state(conn)
            resources, sidecars = _snapshot_inventory(conn)
            schema_id, contract_id = _baseline_identity(conn)
        finally:
            conn.close()
    if integrity != "ok" or fk_state != "ok":
        raise RuntimeError(f"隔离恢复检查失败: integrity={integrity}; foreign_keys={fk_state}")
    if resources != manifest["resources"] or sidecars != manifest["sidecars"]:
        raise RuntimeError("快照资源或 sidecar 清单与隔离恢复副本不一致")
    if schema_id != manifest["schema_id"] or contract_id != manifest["contract_id"]:
        raise RuntimeError("快照 schema/契约身份与 manifest 不一致")
    return {
        "integrity_check": integrity,
        "foreign_key_check": fk_state,
        "schema_id": schema_id,
        "contract_id": contract_id,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="learningj.db.maintenance",
        description="LearningJ 数据库维护工具（开发基线重建 + 全库快照导出/验证）",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_rebuild = sub.add_parser(
        "rebuild-development-db",
        help="删除重建明确指定的开发/测试 .db，并灌入当前确定性素材 fixture",
    )
    p_rebuild.add_argument("--db", type=Path, required=True)

    p_snapshot = sub.add_parser("export-snapshot", help="导出全库快照和资源/sidecar 清单")
    p_snapshot.add_argument("--db", type=Path, required=True)
    p_snapshot.add_argument("--out", type=Path, required=True)
    p_verify_snapshot = sub.add_parser("verify-snapshot", help="在隔离副本中验证全库快照")
    p_verify_snapshot.add_argument("--snapshot", type=Path, required=True)
    p_verify_snapshot.add_argument("--manifest", type=Path, default=None)

    args = parser.parse_args(argv)
    if args.command == "rebuild-development-db":
        report = rebuild_development_database(args.db)
        print(f"开发数据库已按当前 schema 重建: {Path(args.db).resolve()}")
        for key, value in report.items():
            print(f"{key}: {value}")
    elif args.command == "export-snapshot":
        result = export_snapshot(args.db, args.out)
        print(f"快照: {result.snapshot_path}")
        print(f"manifest: {result.manifest_path}")
        print(f"schema_id: {result.schema_id or 'none'}")
        print(f"contract_id: {result.contract_id or 'none'}")
    elif args.command == "verify-snapshot":
        report = verify_snapshot(args.snapshot, args.manifest)
        for key, value in report.items():
            print(f"{key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
