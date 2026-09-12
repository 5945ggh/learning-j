"""词典导入与查找服务（`data-model.md` §2.0，ADR-032，ADR-040）。

事务边界（§11.3）：ZIP 解析与资源落盘全部发生在数据库写事务之前；
一次导入的发布是单个短事务（source / import run / entries / definitions /
assets / FTS 索引行同事务提交），失败零行落地。同一 archive hash 的重复
导入幂等：不重复写任何条目，仅记录一次重放运行。

词典导入**不创建 KnowledgePoint**（§2.0 红线）；查找是只读路径，
也不产生 KE（§9 不变量 8）。
"""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from learningj.db.base import utcnow
from learningj.db.models.dictionary import (
    DictionaryAsset,
    DictionaryDefinition,
    DictionaryEntry,
    DictionaryImportRun,
    DictionarySource,
)
from learningj.dictionary.importer import (
    ParsedDictionaryArchive,
    parse_yomitan_archive,
)
from learningj.domain.enums import DictionaryImportRunStatus, DictionarySourceFormat
from learningj.domain.ids import new_uuid7

FTS_TABLE = "dictionary_search_fts"
_LOOKUP_DEFAULT_LIMIT = 50
_LOOKUP_MAX_LIMIT = 200
_SEARCH_DEFAULT_LIMIT = 20
_SEARCH_MAX_LIMIT = 100
_BATCH_SIZE = 2000


class DictionarySearchError(RuntimeError):
    """词典 FTS 派生索引不可用，不能静默降级为不完整结果。"""


def _write_assets(parsed: ParsedDictionaryArchive, assets_root: Path, source_id: uuid.UUID) -> Path | None:
    """把资源写到 {assets_root}/{source_id}/ 下（写事务之外的文件 I/O）。

    无资源档案不创建任何目录。
    """
    if not parsed.assets:
        return None
    assets_root.mkdir(parents=True, exist_ok=True)
    source_dir = assets_root / str(source_id)
    staging_dir = Path(tempfile.mkdtemp(prefix=f".{source_id}.", dir=assets_root))
    try:
        for asset in parsed.assets:
            target = staging_dir / asset.relative_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(asset.content)
        os.replace(staging_dir, source_dir)
        return source_dir
    except Exception:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise


def import_yomitan_archive(
    session: Session, *, blob: bytes, assets_root: Path
) -> tuple[DictionarySource, DictionaryImportRun, bool]:
    """导入一个 Yomitan ZIP；返回 (source, run, idempotent_replay)。

    幂等语义：archive hash 已存在时直接返回既有 source，不重复解析与写
    条目，仅追加一条 done 状态的重放运行记录。
    """
    archive_hash = hashlib.sha256(blob).hexdigest()
    existing = session.scalar(
        select(DictionarySource).where(DictionarySource.archive_hash == archive_hash)
    )
    if existing is not None:
        run = DictionaryImportRun(
            archive_hash=archive_hash,
            status=DictionaryImportRunStatus.DONE,
            finished_at=utcnow(),
            stats={"idempotent_replay": True, "source_id": str(existing.id)},
        )
        session.add(run)
        session.flush()
        return existing, run, True

    parsed = parse_yomitan_archive(blob)
    source_id = new_uuid7()
    assets_dir: Path | None = None
    try:
        assets_dir = _write_assets(parsed, assets_root, source_id)
        source = DictionarySource(
            id=source_id,
            format=DictionarySourceFormat.YOMITAN_ZIP,
            display_name=parsed.display_name,
            source_version=parsed.source_version,
            schema_version=parsed.schema_version,
            archive_hash=parsed.archive_hash,
            license_metadata=parsed.license_metadata,
        )
        session.add(source)
        session.flush()
        _insert_entries(session, source_id=source_id, parsed=parsed)
        _persist_assets(session, source_id=source_id, parsed=parsed)
        _ensure_search_index(session)
        _index_entries_for_search(session, source_id=source_id)
        run = DictionaryImportRun(
            archive_hash=parsed.archive_hash,
            status=DictionaryImportRunStatus.DONE,
            finished_at=utcnow(),
            stats={**parsed.stats, "idempotent_replay": False},
        )
        session.add(run)
        session.flush()
        return source, run, False
    except Exception:
        session.rollback()
        if assets_dir is not None:
            shutil.rmtree(assets_dir, ignore_errors=True)
        raise


def _insert_entries(session: Session, *, source_id: uuid.UUID, parsed: ParsedDictionaryArchive) -> None:
    """有界批次写入条目与义项（§11.3），全程在发布事务内。"""
    entry_rows: list[DictionaryEntry] = []
    definition_rows: list[tuple[str, DictionaryDefinition]] = []

    def flush_batch() -> None:
        if not entry_rows:
            return
        session.add_all(entry_rows)
        session.flush()
        ids_by_local_id = {row.source_local_id: row.id for row in entry_rows}
        for local_id, definition in definition_rows:
            definition.entry_id = ids_by_local_id[local_id]
        session.add_all(definition for _, definition in definition_rows)
        session.flush()
        entry_rows.clear()
        definition_rows.clear()

    for parsed_entry in parsed.entries:
        row = DictionaryEntry(
            source_id=source_id,
            expression=parsed_entry.expression,
            reading=parsed_entry.reading,
            tags=parsed_entry.tags,
            score=parsed_entry.score,
            sequence=parsed_entry.sequence,
            source_local_id=parsed_entry.source_local_id,
        )
        entry_rows.append(row)
        for definition in parsed_entry.definitions:
            definition_rows.append(
                (
                    parsed_entry.source_local_id,
                    DictionaryDefinition(
                        entry_id=row.id,  # flush 后重写为真实 id
                        ordinal=definition.ordinal,
                        plain_text=definition.plain_text,
                        structured_content=definition.structured_content,
                    ),
                )
            )
        if len(entry_rows) >= _BATCH_SIZE:
            flush_batch()
    flush_batch()


def _persist_assets(session: Session, *, source_id: uuid.UUID, parsed: ParsedDictionaryArchive) -> None:
    for asset in parsed.assets:
        session.add(
            DictionaryAsset(
                source_id=source_id,
                relative_path=asset.relative_path,
                mime_type=asset.mime_type,
                content_hash=asset.content_hash,
                storage_path=f"{source_id}/{asset.relative_path}",
            )
        )


def _ensure_search_index(session: Session) -> None:
    """FTS5 是词典查找的派生投影（可由 dictionary_entries 完整重建）。"""
    session.execute(
        text(
            f"CREATE VIRTUAL TABLE IF NOT EXISTS {FTS_TABLE} USING fts5("
            "expression, reading, source_id UNINDEXED, entry_id UNINDEXED)"
        )
    )


def _fts_insert(session: Session, rows: list[dict[str, Any]]) -> None:
    statement = (
        f"INSERT INTO {FTS_TABLE} (expression, reading, source_id, entry_id) "
        "VALUES (:expression, :reading, :source_id, :entry_id)"
    )
    session.execute(
        text(statement),
        [
            {
                "expression": row["expression"],
                "reading": row["reading"],
                "source_id": row["source_id"],
                "entry_id": row.get("entry_id"),
            }
            for row in rows
        ],
    )


def _index_entries_for_search(session: Session, *, source_id: uuid.UUID) -> None:
    """条目 flush 后从库内回读真实 id 建立索引（有界批次）。"""
    statement = (
        select(DictionaryEntry.id, DictionaryEntry.expression, DictionaryEntry.reading)
        .where(DictionaryEntry.source_id == source_id)
        .order_by(DictionaryEntry.id)
    )
    buffer: list[dict[str, Any]] = []
    for entry_id, expression, reading in session.execute(statement).yield_per(_BATCH_SIZE):
        buffer.append(
            {
                "expression": expression,
                "reading": reading or "",
                "source_id": str(source_id),
                "entry_id": str(entry_id),
            }
        )
        if len(buffer) >= _BATCH_SIZE:
            _fts_insert(session, buffer)
            buffer.clear()
    if buffer:
        _fts_insert(session, buffer)


def rebuild_search_index(session: Session) -> int:
    """从 dictionary_entries 重建 FTS 投影，返回行数（§2.5 可重建性）。"""
    _ensure_search_index(session)
    session.execute(text(f"DELETE FROM {FTS_TABLE}"))
    entries = session.execute(
        select(
            DictionaryEntry.id,
            DictionaryEntry.expression,
            DictionaryEntry.reading,
            DictionaryEntry.source_id,
        )
    ).all()
    count = 0
    buffer: list[dict[str, Any]] = []
    for entry_id, expression, reading, source_id in entries:
        buffer.append(
            {
                "expression": expression,
                "reading": reading or "",
                "source_id": str(source_id),
                "entry_id": str(entry_id),
            }
        )
        count += 1
        if len(buffer) >= _BATCH_SIZE:
            _fts_insert(session, buffer)
            buffer.clear()
    if buffer:
        _fts_insert(session, buffer)
    return count


def search_index_exists(session: Session) -> bool:
    row = session.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name = :name"),
        {"name": FTS_TABLE},
    ).first()
    return row is not None


def list_sources(session: Session) -> list[DictionarySource]:
    return list(
        session.scalars(
            select(DictionarySource).order_by(DictionarySource.display_name, DictionarySource.id)
        )
    )


def lookup(
    session: Session, *, expression: str, reading: str | None = None, limit: int = _LOOKUP_DEFAULT_LIMIT
) -> list[DictionaryEntry]:
    """精确查找：expression 精确相等；提供 reading 时限定该读音或空读音。"""
    limit = max(1, min(limit, _LOOKUP_MAX_LIMIT))
    statement = select(DictionaryEntry).where(DictionaryEntry.expression == expression)
    if reading is not None:
        statement = statement.where(
            (DictionaryEntry.reading == reading) | (DictionaryEntry.reading.is_(None))
        )
    statement = statement.order_by(DictionaryEntry.score.desc(), DictionaryEntry.id).limit(limit)
    return list(session.scalars(statement))


def search(
    session: Session, *, query: str, limit: int = _SEARCH_DEFAULT_LIMIT
) -> list[DictionaryEntry]:
    """精确匹配优先，随后 FTS5 前缀匹配（日文无词界，按 token 前缀实现）。"""
    limit = max(1, min(limit, _SEARCH_MAX_LIMIT))
    query = query.strip()
    if not query:
        return []
    exact = list(
        session.scalars(
            select(DictionaryEntry)
            .where((DictionaryEntry.expression == query) | (DictionaryEntry.reading == query))
            .order_by(DictionaryEntry.score.desc(), DictionaryEntry.id)
            .limit(limit)
        )
    )
    if len(exact) >= limit:
        return exact
    if not search_index_exists(session):
        # An empty dictionary has no prefix results to lose.  Once canonical
        # entries exist, however, a missing derived index makes the response
        # incomplete and must be visible to the caller for rebuild/retry.
        if session.scalar(select(DictionaryEntry.id).limit(1)) is None:
            return exact
        raise DictionarySearchError(
            "词典搜索索引缺失，请重建 dictionary_search_fts 后重试"
        )
    remaining = limit - len(exact)
    excluded_ids = {entry.id for entry in exact}
    try:
        matched = session.execute(
            text(
                f"SELECT entry_id FROM {FTS_TABLE} WHERE {FTS_TABLE} MATCH :pattern "
                "AND entry_id IS NOT NULL LIMIT :limit"
            ),
            {"pattern": f'"{_escape_fts(query)}"*', "limit": remaining * 4},
        ).all()
    except Exception as exc:
        raise DictionarySearchError(
            "词典搜索索引不可用，请重建 dictionary_search_fts 后重试"
        ) from exc
    candidate_ids: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for (entry_id,) in matched:
        try:
            candidate = uuid.UUID(entry_id)
        except (TypeError, ValueError):
            raise DictionarySearchError(
                "词典搜索索引包含非法条目引用，请重建 dictionary_search_fts 后重试"
            )
        if candidate in excluded_ids or candidate in seen:
            continue
        seen.add(candidate)
        candidate_ids.append(candidate)
    if not candidate_ids:
        return exact
    prefix_rows = session.scalars(
        select(DictionaryEntry).where(DictionaryEntry.id.in_(candidate_ids))
    ).all()
    if len(prefix_rows) != len(candidate_ids):
        raise DictionarySearchError(
            "词典搜索索引包含过期条目引用，请重建 dictionary_search_fts 后重试"
        )
    by_id = {entry.id: entry for entry in prefix_rows}
    ordered = [by_id[cid] for cid in candidate_ids if cid in by_id]
    return exact + ordered[:remaining]


def _escape_fts(query: str) -> str:
    return query.replace('"', '""')


def definitions_for_entries(
    session: Session, entry_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[DictionaryDefinition]]:
    if not entry_ids:
        return {}
    rows = session.scalars(
        select(DictionaryDefinition)
        .where(DictionaryDefinition.entry_id.in_(entry_ids))
        .order_by(DictionaryDefinition.entry_id, DictionaryDefinition.ordinal)
    ).all()
    grouped: dict[uuid.UUID, list[DictionaryDefinition]] = {}
    for row in rows:
        grouped.setdefault(row.entry_id, []).append(row)
    return grouped


def entry_sources(session: Session, source_ids: list[uuid.UUID]) -> dict[uuid.UUID, DictionarySource]:
    if not source_ids:
        return {}
    rows = session.scalars(
        select(DictionarySource).where(DictionarySource.id.in_(source_ids))
    ).all()
    return {source.id: source for source in rows}
