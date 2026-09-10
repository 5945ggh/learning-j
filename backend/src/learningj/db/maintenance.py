"""P0 迁移与备份工具链（`docs/mvp-tech-and-phases.md` §1.6、§3 P0 第 3 条）。

职责：

- 迁移前自动备份：SQLite backup API 生成一致性快照，附带可校验的
  版本标记 manifest（契约/schema 版本、应用版本、时间戳）；
- 备份验证：在隔离目录打开副本，做 integrity/foreign-key check 并核对版本标记；
- 旧库回归样本：在迁移 `1c1fc8f7fc96` 的旧 schema 上构造带数据的
  样本库（当前开发库为空库，样本代表真实历史数据），覆盖旧状态机、
  遗留 KE 来源、retired/active 复习项等迁移路径；
- 前滚升级：备份 → `alembic upgrade head` → 失败保留备份与诊断。

命令（backend/ 目录下执行）::

    uv run python -m learningj.db.maintenance backup --db learningj.db
    uv run python -m learningj.db.maintenance verify-backup --backup <备份文件>
    uv run python -m learningj.db.maintenance build-regression-sample --out <路径.db> [--force]
    uv run python -m learningj.db.maintenance upgrade --db learningj.db

本工具链是 forward-only：不提供回滚，历史回退依赖迁移前备份。
SQLite DDL 并非完全事务性，迁移失败后必须先从备份恢复源库再重试，
不要在原库上直接重跑失败的前滚。

非空库的自动备份由 `alembic/env.py` 在迁移前触发（`forward_upgrade` 已备份时
通过环境变量握手跳过），因此直接执行 `alembic upgrade head` 也受同一保护。
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import traceback
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[3]
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"
LEGACY_REVISION = "1c1fc8f7fc96"
MANIFEST_SUFFIX = ".manifest.json"
_MANIFEST_TYPE = "learningj-pre-migration-backup"
# `forward_upgrade` 已生成备份时置此标记，`alembic/env.py` 据此跳过它自己的
# 自动备份，保证同一次升级只产生一份。进程内调用方（含 `_run_alembic`）必须
# 在退出时还原该标记，否则同进程后续升级别的库会被静默跳过备份。
BACKUP_TAKEN_ENV = "LEARNINGJ_MIGRATION_BACKUP_TAKEN"


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _backup_stamp() -> str:
    """A human-sortable UTC name component with microsecond precision."""
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def _reserve_backup_path(dest_dir: Path, db_stem: str, version_tag: str) -> Path:
    """Reserve a unique backup pathname atomically before SQLite opens it."""
    stamp = _backup_stamp()
    for attempt in range(1000):
        suffix = "" if attempt == 0 else f"-{attempt}"
        candidate = dest_dir / f"{db_stem}-backup-{version_tag}-{stamp}{suffix}.db"
        try:
            fd = os.open(
                candidate,
                os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                0o600,
            )
        except FileExistsError:
            continue
        os.close(fd)
        return candidate
    raise RuntimeError("无法为备份分配不冲突的文件名")


def _app_version() -> str:
    try:
        return importlib.metadata.version("backend")
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def _schema_version(db_path: Path) -> str | None:
    """读取目标库的 alembic 版本戳；空库/无表返回 None。"""
    conn = sqlite3.connect(db_path)
    try:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if "alembic_version" not in tables:
            return None
        rows = conn.execute("SELECT version_num FROM alembic_version").fetchall()
        return rows[0][0] if rows else None
    finally:
        conn.close()


def _foreign_key_state(conn: sqlite3.Connection) -> str:
    """`PRAGMA foreign_key_check` 的结果："ok" 或违规描述。

    迁移以重建表方式执行且迁移连接关闭 FK 强制，孤儿引用不会被即时
    报错——备份、隔离恢复与升级前后必须显式检查（CR-2026-09-10）。
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
class BackupResult:
    backup_path: Path
    manifest_path: Path
    schema_version_before: str | None
    integrity_check: str
    foreign_key_check: str


def backup_database(db_path: Path, out_dir: Path | None = None) -> BackupResult:
    """生成一致性备份 + 版本标记 manifest，并就地验证可打开。

    备份是安全网：即使源库已有完整性/外键问题也照常生成，但结果如实
    记录在 manifest；是否放行由 verify_backup 与 forward_upgrade 把关。
    """
    db_path = db_path.resolve()
    if not db_path.exists():
        raise FileNotFoundError(f"目标数据库不存在: {db_path}")
    dest_dir = (out_dir or db_path.parent).resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)

    schema_version = _schema_version(db_path)
    version_tag = schema_version or "none"
    # Microseconds make ordinary names distinct; O_EXCL makes the guarantee
    # hold even when two backup requests race in the same process or host.
    backup_path = _reserve_backup_path(dest_dir, db_path.stem, version_tag)

    try:
        src = sqlite3.connect(db_path)
        try:
            dst = sqlite3.connect(backup_path)
            try:
                with dst:
                    src.backup(dst)
                integrity = dst.execute("PRAGMA integrity_check").fetchone()[0]
                fk_state = _foreign_key_state(dst)
            finally:
                dst.close()
        finally:
            src.close()
    except Exception:
        backup_path.unlink(missing_ok=True)
        raise
    if integrity != "ok":
        backup_path.unlink(missing_ok=True)
        raise RuntimeError(f"备份完整性检查失败（{integrity}），已删除坏备份")

    manifest = {
        "type": _MANIFEST_TYPE,
        "created_at_utc": _utc_now(),
        "app_version": _app_version(),
        "source_db_name": db_path.name,
        "schema_version_before": schema_version,
        "integrity_check": integrity,
        "foreign_key_check": fk_state,
    }
    manifest_path = backup_path.with_suffix(backup_path.suffix + MANIFEST_SUFFIX)
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return BackupResult(
        backup_path=backup_path,
        manifest_path=manifest_path,
        schema_version_before=schema_version,
        integrity_check=integrity,
        foreign_key_check=fk_state,
    )


_REQUIRED_MANIFEST_FIELDS = (
    "type",
    "created_at_utc",
    "app_version",
    "schema_version_before",
    "integrity_check",
    "foreign_key_check",
)


def verify_backup(backup_path: Path, manifest_path: Path | None = None) -> dict[str, str]:
    """隔离恢复检查：在临时目录打开备份副本，校验完整性、外键与版本标记。

    备份副本存在孤儿引用时判定失败——这样的备份不能成为恢复后的状态；
    manifest 本身的必备字段（含 app_version 与时间戳）一并不全即拒绝。
    """
    backup_path = backup_path.resolve()
    if not backup_path.exists():
        raise FileNotFoundError(f"备份不存在: {backup_path}")
    manifest_path = manifest_path or Path(str(backup_path) + MANIFEST_SUFFIX)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("type") != _MANIFEST_TYPE:
        raise ValueError(f"manifest 类型不符: {manifest.get('type')!r}")
    # `schema_version_before: null` is the explicit, valid marker for an
    # existing SQLite file with no Alembic schema yet.  Validate presence of
    # the key rather than truthiness/value so empty-database backups can be
    # verified and then upgraded.
    missing = [field for field in _REQUIRED_MANIFEST_FIELDS if field not in manifest]
    if missing:
        raise ValueError(f"manifest 缺少必备字段: {missing}")
    if not isinstance(manifest["app_version"], str) or not manifest["app_version"]:
        raise ValueError("manifest app_version 无效")
    if not isinstance(manifest["created_at_utc"], str):
        raise ValueError("manifest created_at_utc 无效")
    try:
        created_at = datetime.fromisoformat(
            manifest["created_at_utc"].replace("Z", "+00:00")
        )
    except ValueError as exc:
        raise ValueError("manifest created_at_utc 不是有效 ISO-8601 时间") from exc
    if created_at.tzinfo is None:
        raise ValueError("manifest created_at_utc 必须带时区")

    with tempfile.TemporaryDirectory(prefix="lj-backup-verify-") as tmp:
        isolated_copy = Path(tmp) / backup_path.name
        shutil.copy(backup_path, isolated_copy)
        conn = sqlite3.connect(isolated_copy)
        try:
            integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
            fk_state = _foreign_key_state(conn)
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            stamped = (
                conn.execute("SELECT version_num FROM alembic_version").fetchall()
                if "alembic_version" in tables
                else []
            )
        finally:
            conn.close()

    schema_version = stamped[0][0] if stamped else None
    if integrity != "ok":
        raise RuntimeError(f"备份完整性检查失败（{integrity}）")
    if fk_state != "ok":
        raise RuntimeError(
            f"备份副本外键检查失败（{fk_state}）；manifest 记录: "
            f"{manifest['foreign_key_check']!r}"
        )
    if manifest["integrity_check"] != integrity:
        raise RuntimeError(
            "备份内 integrity_check 与 manifest 不符: "
            f"db={integrity!r} manifest={manifest['integrity_check']!r}"
        )
    if manifest["foreign_key_check"] != fk_state:
        raise RuntimeError(
            "备份内 foreign_key_check 与 manifest 不符: "
            f"db={fk_state!r} manifest={manifest['foreign_key_check']!r}"
        )
    if schema_version != manifest["schema_version_before"]:
        raise RuntimeError(
            "备份内版本戳与 manifest 不符: "
            f"db={schema_version!r} manifest={manifest['schema_version_before']!r}"
        )
    return {
        "integrity_check": integrity,
        "foreign_key_check": fk_state,
        "schema_version": schema_version or "none",
    }


def _run_alembic(target: str, db_path: Path) -> None:
    """在进程内执行 `alembic upgrade <target>`（URL 经环境变量传入 env.py）。

    `env.py` 可能为本库自动备份并置上 `BACKUP_TAKEN_ENV`；该标记只对本次升级
    有效，退出时必须还原，否则同进程的下一次升级会误以为已备份而跳过兜底。
    """
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option(
        "prepend_sys_path", str(BACKEND_DIR / "src")
    )
    previous_url = os.environ.get("LEARNINGJ_DB_URL")
    previous_backup_marker = os.environ.get(BACKUP_TAKEN_ENV)
    os.environ["LEARNINGJ_DB_URL"] = f"sqlite:///{db_path.resolve()}"
    try:
        command.upgrade(cfg, target)
    finally:
        if previous_url is None:
            os.environ.pop("LEARNINGJ_DB_URL", None)
        else:
            os.environ["LEARNINGJ_DB_URL"] = previous_url
        if previous_backup_marker is None:
            os.environ.pop(BACKUP_TAKEN_ENV, None)
        else:
            os.environ[BACKUP_TAKEN_ENV] = previous_backup_marker


def forward_upgrade(db_path: Path, backup_dir: Path | None = None) -> BackupResult:
    """前滚升级：先备份，再 `alembic upgrade head`；失败保留备份与诊断。

    备份完成后设置 `LEARNINGJ_MIGRATION_BACKUP_TAKEN`，env.py 据此跳过它自己的
    自动备份，避免同一次升级生成两份；退出时恢复原值。
    """
    db_path = Path(db_path)
    result = backup_database(db_path, backup_dir)
    previous_backup_marker = os.environ.get(BACKUP_TAKEN_ENV)
    os.environ[BACKUP_TAKEN_ENV] = str(result.backup_path)
    try:
        # Validate the exact snapshot in an isolated copy before touching the
        # source database.  In particular, an existing orphan reference must
        # stop the upgrade while retaining the backup and a diagnostic.
        verify_backup(result.backup_path, result.manifest_path)
        if result.foreign_key_check != "ok":
            raise RuntimeError(
                f"源数据库外键检查失败（{result.foreign_key_check}），拒绝迁移"
            )
        _run_alembic("head", db_path)
    except Exception:
        diagnostics = result.backup_path.with_suffix(".upgrade-failure.log")
        diagnostics.write_text(
            "\n".join(
                [
                    f"upgrade failed at {_utc_now()}",
                    f"database: {db_path}",
                    f"backup kept: {result.backup_path}",
                    f"manifest: {result.manifest_path}",
                    "recovery: restore the source database from the backup "
                    "before retrying; SQLite DDL is not fully transactional, so "
                    "do not rerun the failed upgrade in place",
                    "",
                    traceback.format_exc(),
                ]
            ),
            encoding="utf-8",
        )
        print(
            f"升级失败。备份已保留: {result.backup_path}\n诊断已写入: {diagnostics}",
            file=sys.stderr,
        )
        raise
    finally:
        if previous_backup_marker is None:
            os.environ.pop(BACKUP_TAKEN_ENV, None)
        else:
            os.environ[BACKUP_TAKEN_ENV] = previous_backup_marker
    return result


def _u(n: int) -> str:
    """确定性 32 位 hex id（SQLAlchemy Uuid 在 SQLite 存 CHAR(32) 无连字符）。"""
    return uuid.UUID(int=n).hex


# 迁移 1c1fc8f7fc96 时代的触发器定义（不变量 3 按 retired_at IS NULL 判断）。
# 回归样本代表"迁移前的历史库"，必须与历史库一致；env.py 升级到旧版本后
# 装的是现行定义（按 NEW.status 判断），在旧 schema 上是错的，这里替换。
_LEGACY_TRIGGER_INVARIANT_3 = """
CREATE TRIGGER trg_review_items_valid_requires_srs
BEFORE INSERT ON review_items
WHEN NEW.retired_at IS NULL AND (
    SELECT retention FROM knowledge_points WHERE kp_id = NEW.kp_id
) = 'reference'
BEGIN
    SELECT RAISE(ABORT, 'invariant 3: reference KP must not have an active review item');
END;
"""

_LEGACY_TRIGGER_RETIRED_MONOTONIC = """
CREATE TRIGGER trg_review_items_retired_at_monotonic
BEFORE UPDATE ON review_items
WHEN OLD.retired_at IS NOT NULL AND (
    NEW.retired_at IS NULL OR NEW.retired_at != OLD.retired_at
)
BEGIN
    SELECT RAISE(ABORT, 'retired_at is write-once: it must not be modified or cleared');
END;
"""


def _install_legacy_triggers(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        with conn:
            conn.execute("DROP TRIGGER IF EXISTS trg_review_items_valid_requires_srs")
            conn.execute("DROP TRIGGER IF EXISTS trg_review_items_retired_at_monotonic")
            conn.execute(_LEGACY_TRIGGER_INVARIANT_3)
            conn.execute(_LEGACY_TRIGGER_RETIRED_MONOTONIC)
    finally:
        conn.close()


def build_regression_sample(out_path: Path, *, force: bool = False) -> Path:
    """构造旧库回归样本：迁移 1c1fc8f7fc96 的 schema + 覆盖迁移路径的数据。

    覆盖矩阵（对应 P0-contract 审计的备份夹具要求）：4 类素材中 2 类、
    三种 sentence 锚点、sidecar 版本戳、analyses 第二状态机组合、消息与
    小节（含 superseded 链与 kind 空值）、提取 run 与 retry 链、occurrence
    与 spans（含 BMP 外字符偏移）、review_items 四种回填分支（有 ReviewState
    的 active、无状态的三态 active→queued、reference→paused、retired）、
    review_states 含 history 数组、known_evidence 全部 7 个遗留 source 值、
    dictionary 五表链、两类记忆、annotation。

    安全护栏：目标已存在且非空时拒绝覆盖（`FileExistsError`），必须先显式
    传 `force=True`（CLI `--force`）。该命令是历史/迁移工具链的一部分，绝不
    静默删除既有数据库；覆盖前不会自动生成备份。
    """
    out_path = out_path.resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        if out_path.stat().st_size > 0 and not force:
            raise FileExistsError(
                f"回归样本目标已存在且非空，拒绝覆盖: {out_path}。"
                "确认删除请显式传 force=True 或 --force；本命令不会自动备份。"
            )
        out_path.unlink()
    _run_alembic(LEGACY_REVISION, out_path)

    ts = "2026-01-15 00:00:00.000000"
    material_a, material_b = _u(1), _u(2)
    sent_a1, sent_a2, sent_b1 = _u(10), _u(11), _u(12)
    sidecar_a = _u(20)
    lex1, lex2 = "lex:koushinshin:meishi:koushinshin", "lex:zetsumei:meishi:zetsumei"
    kp_pattern, kp_lexical, kp_reference = _u(30), _u(31), _u(32)
    alias1 = _u(40)
    span1, span2 = _u(50), _u(51)
    analysis1, analysis2, analysis3 = _u(60), _u(61), _u(62)
    msg1, msg2, msg3 = _u(70), _u(71), _u(72)
    sec_s1_v1, sec_s1_v2, sec_s2_v1 = _u(80), _u(81), _u(82)
    sec_s1 = _u(85)
    run1, run2 = _u(90), _u(91)
    occ1, occ2, occ3, occ4 = _u(100), _u(101), _u(102), _u(103)
    item1, item2, item3, item4 = _u(110), _u(111), _u(112), _u(113)

    ke_ids = [_u(130 + i) for i in range(7)]
    anno1 = _u(140)
    note1 = _u(150)
    profile1 = _u(160)
    dsrc, dentry, ddef, dasset, drun = _u(170), _u(171), _u(172), _u(173), _u(174)

    stmts: list[tuple[str, tuple]] = [
        # -- 素材与句子（material A: text, material B: subtitle_video）
        ("INSERT INTO materials (id, title, content_hash, locator, kind, copy_stored,"
         " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
         (material_a, "旧样本文本", "hash-material-a", "sample-a.txt", "text", 0, ts, ts)),
        ("INSERT INTO materials (id, title, content_hash, locator, kind, copy_stored,"
         " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
         (material_b, "旧样本字幕", "hash-material-b", "sample-b.mp4", "subtitle_video", 0, ts, ts)),
        ("INSERT INTO sentences (id, material_id, \"index\", text, time_start, time_end,"
         " translation, anchor_type, anchor_payload, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
         (sent_a1, material_a, 0, "𠮟られた。", None, None, None, "plain_text",
          '{"char_start": 0, "char_end": 5}', ts, ts)),
        ("INSERT INTO sentences (id, material_id, \"index\", text, time_start, time_end,"
         " translation, anchor_type, anchor_payload, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
         (sent_a2, material_a, 1, "次は君の番です！", None, None, None, "plain_text",
          '{"char_start": 5, "char_end": 14}', ts, ts)),
        ("INSERT INTO sentences (id, material_id, \"index\", text, time_start, time_end,"
         " translation, anchor_type, anchor_payload, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
         (sent_b1, material_b, 0, "また寄ってしまった。", 1000, 4200, "又忍不住去了。",
          "subtitle", '{"cue_index": 0}', ts, ts)),
        ("INSERT INTO sidecars (id, material_id, content_hash, segmenter_version,"
         " tokenizer_version, analyzer_dict_version, payload, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?)",
         (sidecar_a, material_a, "hash-material-a", "learningj-segmenter-v1",
          "sudachi-tokenizer-v1", "sudachidict-core-20250129", b"\xc0", ts, ts)),
        # -- Lexeme 与 KnownEvidence（7 个遗留 source 各一行）
        ("INSERT INTO lexemes (lexeme_id, normalized_form, pos, reading_form,"
         " first_seen_analyzer_dict_version, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?)",
         (lex1, "向上心", "名詞,普通名詞", "こうしんしん", "sudachidict-core-20250129", ts, ts)),
        ("INSERT INTO lexemes (lexeme_id, normalized_form, pos, reading_form,"
         " first_seen_analyzer_dict_version, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?)",
         (lex2, "絶命", "名詞,普通名詞", "ぜつめい", "sudachidict-core-20250129", ts, ts)),
    ]
    ke_sources = [
        "reading_inferred", "analysis_marked", "import_anki", "import_jpdb",
        "srs_matured", "listening_native", "listening_tts",
    ]
    for i, source in enumerate(ke_sources):
        stmts.append(
            ("INSERT INTO known_evidence (id, lexeme_id, conjugated_form, source,"
             " confidence, observed_at, analyzer_dict_version, material_id,"
             " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
             (ke_ids[i], lex1 if i % 2 == 0 else lex2, None, source, 0.8, ts,
              "sudachidict-core-20250129", material_a if i == 0 else None, ts, ts)),
        )
    stmts += [
        # -- 知识点（pattern+版本 / lexical srs / lexical reference）
        ("INSERT INTO knowledge_points (kp_id, anchor, anchor_shape, anchor_payload,"
         " pattern_grammar_version, opaque_reason, zero_slot_lexeme_check, display_form,"
         " tags, retention, retention_set_by, canonical_id, lexical_anchors, origin,"
         " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
         (kp_pattern, "N[none].の.ない.N[none]", "pattern",
          '{"elements": [{"type": "slot", "id": "N1", "category": "N", "form": "none"},'
          ' {"type": "literal", "text": "の"}, {"type": "literal", "text": "ない"},'
          ' {"type": "slot", "id": "N2", "category": "N", "form": "none"}]}',
          "0.1", None, None, None, '["grammar"]', "srs", "default", None,
          '["lex:koushinshin:meishi:koushinshin"]', "extraction", ts, ts)),
        ("INSERT INTO knowledge_points (kp_id, anchor, anchor_shape, anchor_payload,"
         " pattern_grammar_version, opaque_reason, zero_slot_lexeme_check, display_form,"
         " tags, retention, retention_set_by, canonical_id, lexical_anchors, origin,"
         " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
         (kp_lexical, "向上心", "lexical", '{"surface": "向上心"}', None, None, None,
          None, '[]', "srs", "default", None, '["lex:koushinshin:meishi:koushinshin"]',
          "extraction", ts, ts)),
        ("INSERT INTO knowledge_points (kp_id, anchor, anchor_shape, anchor_payload,"
         " pattern_grammar_version, opaque_reason, zero_slot_lexeme_check, display_form,"
         " tags, retention, retention_set_by, canonical_id, lexical_anchors, origin,"
         " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
         (kp_reference, "絶命", "lexical", '{"surface": "絶命"}', None, None, None,
          None, '[]', "reference", "user", None, '["lex:zetsumei:meishi:zetsumei"]',
          "extraction", ts, ts)),
        ("INSERT INTO aliases (id, alias_string, kp_id, source, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?)",
         (alias1, "〜のない", kp_pattern, "seed", ts, ts)),
        # -- Spans（"𠮟られた。" code point: 𠮟=0 ら=1 れ=2 た=3 。=4）
        ("INSERT INTO spans (span_id, sentence_id, surface, char_start, char_end,"
         " token_start, token_end, alignment_status, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?,?)",
         (span1, sent_a1, "られた", 1, 3, 0, 1, "aligned", ts, ts)),
        ("INSERT INTO spans (span_id, sentence_id, surface, char_start, char_end,"
         " token_start, token_end, alignment_status, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?,?)",
         (span2, sent_a1, "𠮟", 0, 1, None, None, "unaligned", ts, ts)),
        # -- analyses：三种第二状态机组合（旧形状，含全部旧列）
        ("INSERT INTO analyses (id, sentence_id, material_id, model, prompt_version,"
         " style_modules, style_free_text, user_question, context_kp_ids,"
         " context_note_ids, retrieval_enabled, turn_count, session_closed, status,"
         " extraction_status, extraction_trigger, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
         (analysis1, sent_a1, material_a, "gpt-x", "analysis-v0", '["overview"]', None,
          "为什么用られた？", f'["{kp_lexical}"]', '[]', 0, 3, 1, "ready", "done",
          "user", ts, ts)),
        ("INSERT INTO analyses (id, sentence_id, material_id, model, prompt_version,"
         " style_modules, style_free_text, user_question, context_kp_ids,"
         " context_note_ids, retrieval_enabled, turn_count, session_closed, status,"
         " extraction_status, extraction_trigger, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
         (analysis2, sent_a2, material_a, "gpt-x", "analysis-v0", '[]', None, None,
          '[]', '[]', 0, 1, 0, "generating", "pending", "user", ts, ts)),
        ("INSERT INTO analyses (id, sentence_id, material_id, model, prompt_version,"
         " style_modules, style_free_text, user_question, context_kp_ids,"
         " context_note_ids, retrieval_enabled, turn_count, session_closed, status,"
         " extraction_status, extraction_trigger, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
         (analysis3, sent_b1, material_b, "gpt-x", "analysis-v0", '[]', None, None,
          '[]', '[]', 0, 5, 1, "failed", "failed", "batch", ts, ts)),
        ("INSERT INTO analysis_messages (id, analysis_id, turn_index, role, content)"
         " VALUES (?,?,?,?,?)", (msg1, analysis1, 1, "user", "为什么用られた？")),
        ("INSERT INTO analysis_messages (id, analysis_id, turn_index, role, content)"
         " VALUES (?,?,?,?,?)", (msg2, analysis1, 1, "assistant", "られる表示被动。")),
        ("INSERT INTO analysis_messages (id, analysis_id, turn_index, role, content)"
         " VALUES (?,?,?,?,?)", (msg3, analysis1, 2, "user", "和れない差在哪？")),
        # -- analysis_sections：superseded 链 + kind 空值
        ("INSERT INTO analysis_sections (section_version_id, section_id, analysis_id,"
         " heading_path, split_strategy, kind, body_md, revision, origin_turn,"
         " superseded_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
         (sec_s1_v1, sec_s1, analysis1, '["grammar"]', "heading", "grammar",
          "## 语法\nられる是被动。", 1, 1, sec_s1_v2, ts, ts)),
        ("INSERT INTO analysis_sections (section_version_id, section_id, analysis_id,"
         " heading_path, split_strategy, kind, body_md, revision, origin_turn,"
         " superseded_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
         (sec_s1_v2, sec_s1, analysis1, '["grammar"]', "heading", "grammar",
          "## 语法\nられる是被动，此处为可能态补正。", 2, 2, None, ts, ts)),
        ("INSERT INTO analysis_sections (section_version_id, section_id, analysis_id,"
         " heading_path, split_strategy, kind, body_md, revision, origin_turn,"
         " superseded_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
         (sec_s2_v1, _u(86), analysis1, '[]', "fallback_single", None,
          "未分类小节。", 1, 2, None, ts, ts)),
        ("INSERT INTO analysis_section_spans (section_version_id, span_id, ordinal)"
         " VALUES (?,?,?)", (sec_s1_v1, span1, 0)),
        # -- 提取 run 与 retry 链
        ("INSERT INTO extraction_runs (id, analysis_id, execution_path, model,"
         " prompt_version, status, retry_of, failure_reason, unresolved_surfaces,"
         " candidate_count, started_at, finished_at, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
         (run1, analysis1, "standalone", "gpt-x", "extraction-v0", "done", None,
          None, '[]', 1, ts, ts, ts, ts)),
        ("INSERT INTO extraction_runs (id, analysis_id, execution_path, model,"
         " prompt_version, status, retry_of, failure_reason, unresolved_surfaces,"
         " candidate_count, started_at, finished_at, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
         (run2, analysis1, "continued_turn", "gpt-x", "extraction-v0", "failed",
          run1, "invalid_json", '["見つからない"]', 0, ts, ts, ts, ts)),
        ("INSERT INTO occurrences (id, kp_id, sentence_id, material_id, salience,"
         " content_source, section_id, section_revision, slot_bindings,"
         " source_analysis_id, extraction_run_id, extractor_model,"
         " extractor_prompt_version, brief, user_marked_useful, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
         (occ1, kp_lexical, sent_a1, material_a, "primary", "analysis_section",
          sec_s1, 1, '{}', analysis1, run1, "gpt-x", "extraction-v0",
          "向上心：积极向上的心态。", None, ts, ts)),
        ("INSERT INTO occurrences (id, kp_id, sentence_id, material_id, salience,"
         " content_source, section_id, section_revision, slot_bindings,"
         " source_analysis_id, extraction_run_id, extractor_model,"
         " extractor_prompt_version, brief, user_marked_useful, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (occ2, kp_lexical, sent_a2, material_a, "secondary", "analysis_section",
          sec_s1, 2, '{}', analysis1, run1, "gpt-x", "extraction-v0",
          "向上心在鼓励语境的用法。", None, ts, ts)),
        # 旧库中故意保留一条 reference + 非退役卡：这是旧触发器允许、
        # 但当前迁移必须暂停而不能遗留为 active 的历史状态。
        ("INSERT INTO occurrences (id, kp_id, sentence_id, material_id, salience,"
         " content_source, section_id, section_revision, slot_bindings,"
         " source_analysis_id, extraction_run_id, extractor_model,"
         " extractor_prompt_version, brief, user_marked_useful, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
         (occ3, kp_reference, sent_b1, material_b, "secondary", "analysis_section",
          sec_s1, 1, '{}', analysis1, run1, "gpt-x", "extraction-v0",
          "绝命：旧库 reference 卡迁移样本。", None, ts, ts)),
        # 旧三态模型允许“active 但没有 ReviewState”：当前契约中 active 必须
        # 已有排程状态，因此该行前滚为 queued（等待首次配额），admitted_at 为空。
        ("INSERT INTO occurrences (id, kp_id, sentence_id, material_id, salience,"
         " content_source, section_id, section_revision, slot_bindings,"
         " source_analysis_id, extraction_run_id, extractor_model,"
         " extractor_prompt_version, brief, user_marked_useful, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
         (occ4, kp_lexical, sent_a1, material_a, "secondary", "analysis_section",
          sec_s1, 1, '{}', analysis1, run1, "gpt-x", "extraction-v0",
          "向上心：无排程状态的旧 active 卡迁移样本。", None, ts, ts)),
        ("INSERT INTO occurrence_spans (occurrence_id, span_id, ordinal)"
         " VALUES (?,?,?)", (occ1, span1, 0)),
        # -- ReviewItem：active+ReviewState / retired / reference / 无状态 active
        ("INSERT INTO review_items (id, kp_id, occurrence_id, retired_at,"
         " created_at, updated_at) VALUES (?,?,?,?,?,?)",
         (item1, kp_lexical, occ1, None, ts, ts)),
        ("INSERT INTO review_items (id, kp_id, occurrence_id, retired_at,"
         " created_at, updated_at) VALUES (?,?,?,?,?,?)",
        (item2, kp_lexical, occ2, ts, ts, ts)),
        ("INSERT INTO review_items (id, kp_id, occurrence_id, retired_at,"
         " created_at, updated_at) VALUES (?,?,?,?,?,?)",
         (item3, kp_reference, occ3, None, ts, ts)),
        ("INSERT INTO review_items (id, kp_id, occurrence_id, retired_at,"
         " created_at, updated_at) VALUES (?,?,?,?,?,?)",
         (item4, kp_lexical, occ4, None, ts, ts)),
        ("INSERT INTO review_states (review_item_id, state, stability, difficulty,"
         " due_at, last_review_at, reps, lapses, history, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
         (item1, 1, 5.0, 6.0, ts, ts, 2, 0,
          '[{"rating": 3, "reviewed_at": "2026-01-15T00:00:00Z"}]', ts, ts)),
        # -- Annotation、记忆、词典链
        ("INSERT INTO annotations (id, material_id, note, color, created_at,"
         " updated_at) VALUES (?,?,?,?,?,?)",
         (anno1, material_a, "注意被动与可能的区分。", "#ffcc00", ts, ts)),
        ("INSERT INTO annotation_spans (annotation_id, span_id, ordinal)"
         " VALUES (?,?,?)", (anno1, span2, 0)),
        ("INSERT INTO material_notes (id, material_id, content, source_sentence_id,"
         " last_hit_at, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
         (note1, material_a, "登场人物关系简单。", None, None, "user", ts, ts)),
        ("INSERT INTO learner_profile_notes (id, content, last_hit_at, updated_by,"
         " created_at, updated_at) VALUES (?,?,?,?,?,?)",
         (profile1, "偏好简短讲解。", None, "user", ts, ts)),
        ("INSERT INTO dictionary_import_runs (id, archive_hash, started_at,"
         " finished_at, status, error_summary, stats, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?)",
         (drun, "dict-hash-1", ts, ts, "done", None, '{"entries": 1}', ts, ts)),
        ("INSERT INTO dictionary_sources (id, format, display_name, source_version,"
         " schema_version, archive_hash, imported_at, license_metadata, created_at,"
         " updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
         (dsrc, "yomitan_zip", "明镜日汉双解词典", "2025-01", "3", "dict-hash-1", ts,
          '{"license": "proprietary"}', ts, ts)),
        ("INSERT INTO dictionary_entries (id, source_id, expression, reading, tags,"
         " score, sequence, source_local_id, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?,?,?)",
         (dentry, dsrc, "向上心", "こうしんしん", '[]', 0, 1, "1", ts, ts)),
        ("INSERT INTO dictionary_definitions (id, entry_id, ordinal, plain_text,"
         " structured_content, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
         (ddef, dentry, 0, "积极向上的心态。", None, ts, ts)),
        ("INSERT INTO dictionary_assets (id, source_id, relative_path, mime_type,"
         " content_hash, storage_path, created_at, updated_at)"
         " VALUES (?,?,?,?,?,?,?,?)",
         (dasset, dsrc, "img/icon.png", "image/png", "asset-hash-1", "/assets/icon.png", ts, ts)),
    ]

    conn = sqlite3.connect(out_path)
    try:
        with conn:
            for sql, params in stmts:
                conn.execute(sql, params)
        count = conn.execute("PRAGMA foreign_key_check").fetchall()
        if count:
            raise RuntimeError(f"回归样本外键检查失败: {count}")
    finally:
        conn.close()
    # Install the legacy trigger only after the intentionally-invalid legacy
    # row has been inserted.  The fixture represents a historical database,
    # not a database that could create this row after the trigger existed.
    _install_legacy_triggers(out_path)
    return out_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="learningj.db.maintenance",
        description="P0 迁移与备份工具链（forward-only）",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_backup = sub.add_parser("backup", help="生成迁移前备份 + 版本标记 manifest")
    p_backup.add_argument("--db", type=Path, required=True)
    p_backup.add_argument("--out", type=Path, default=None)

    p_verify = sub.add_parser("verify-backup", help="隔离打开备份副本并核对版本标记")
    p_verify.add_argument("--backup", type=Path, required=True)
    p_verify.add_argument("--manifest", type=Path, default=None)

    p_sample = sub.add_parser(
        "build-regression-sample", help="构造 1c1fc8f7fc96 旧库回归样本（带数据）"
    )
    p_sample.add_argument("--out", type=Path, required=True)
    p_sample.add_argument(
        "--force", action="store_true", help="允许覆盖已存在且非空的输出文件"
    )

    p_upgrade = sub.add_parser(
        "upgrade", help="备份后前滚到 head；失败保留备份与诊断"
    )
    p_upgrade.add_argument("--db", type=Path, required=True)
    p_upgrade.add_argument("--backup-dir", type=Path, default=None)

    args = parser.parse_args(argv)
    if args.command == "backup":
        result = backup_database(args.db, args.out)
        print(f"备份完成: {result.backup_path}")
        print(f"manifest: {result.manifest_path}")
        print(f"schema_version_before: {result.schema_version_before or 'none'}")
        print(f"integrity_check: {result.integrity_check}")
        print(f"foreign_key_check: {result.foreign_key_check}")
    elif args.command == "verify-backup":
        report = verify_backup(args.backup, args.manifest)
        print(f"integrity_check: {report['integrity_check']}")
        print(f"foreign_key_check: {report['foreign_key_check']}")
        print(f"schema_version: {report['schema_version']}")
    elif args.command == "build-regression-sample":
        path = build_regression_sample(args.out, force=args.force)
        print(f"回归样本已生成: {path}")
    elif args.command == "upgrade":
        before = _schema_version(Path(args.db))
        result = forward_upgrade(args.db, args.backup_dir)
        after = _schema_version(Path(args.db))
        print(f"备份: {result.backup_path}")
        print(f"schema_version: {before or 'none'} -> {after or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
