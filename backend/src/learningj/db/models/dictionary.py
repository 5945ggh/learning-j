"""词典层：canonical dictionary model（`data-model.md` §2.0，ADR-032）。

Yomitan ZIP 是 MVP 的第一等**交换格式**，不是内部业务模型；导入后落为
下列 canonical 实体。定义同时保留纯文本投影与可选 structured content，
原始 payload 不在导入时抹平。

版本命名空间：`DictionarySource.source_version`（释义词典来源版本）与
Sudachi 的 `analyzer_dict_version` 属于不同命名空间，不得复用或混用。
词典条目、义项、词频 metadata 与导入词表均**不得自动创建 KnowledgePoint**。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from learningj.db.base import Base, Timestamped, UuidPk, utcnow
from learningj.db.types import json_dict, json_list, str_enum
from learningj.domain.enums import DictionaryImportRunStatus, DictionarySourceFormat


class DictionarySource(UuidPk, Timestamped, Base):
    __tablename__ = "dictionary_sources"

    format: Mapped[DictionarySourceFormat] = mapped_column(
        str_enum(DictionarySourceFormat, name="dictionary_source_format"),
        nullable=False,
    )
    display_name: Mapped[str] = mapped_column(String(512), nullable=False)
    # 释义词典来源版本（独立命名空间，见模块 docstring）。
    source_version: Mapped[str] = mapped_column(String(255), nullable=False)
    # 交换格式 schema 版本（如 Yomitan term bank version）。
    schema_version: Mapped[str] = mapped_column(String(255), nullable=False)
    # 同一 archive hash 的重复导入必须幂等，来源身份按 hash 收敛。
    archive_hash: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    # 许可元数据（许可名、链接、声明等），结构由导入 adapter 决定。
    license_metadata: Mapped[dict[str, Any] | None] = mapped_column(json_dict(), nullable=True)


class DictionaryEntry(UuidPk, Timestamped, Base):
    __tablename__ = "dictionary_entries"
    __table_args__ = (
        UniqueConstraint("source_id", "source_local_id"),
        Index("ix_dictionary_entries_source_expression", "source_id", "expression"),
        # 跨来源按 expression（及读音）精确查找的访问路径（§2.0「查询结果
        # 必须带 source/version provenance」的读面）。
        Index("ix_dictionary_entries_expression", "expression"),
        Index("ix_dictionary_entries_reading", "reading"),
    )

    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("dictionary_sources.id"), nullable=False, index=True
    )
    expression: Mapped[str] = mapped_column(String(512), nullable=False)
    reading: Mapped[str | None] = mapped_column(String(512), nullable=True)
    tags: Mapped[list[str]] = mapped_column(json_list(), nullable=False, default=list)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Yomitan 的 sequence number；缺省时为空。
    sequence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # source-local id：在来源词典内部的稳定标识。
    source_local_id: Mapped[str] = mapped_column(String(255), nullable=False)


class DictionaryDefinition(UuidPk, Timestamped, Base):
    __tablename__ = "dictionary_definitions"
    __table_args__ = (UniqueConstraint("entry_id", "ordinal"),)

    entry_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("dictionary_entries.id"), nullable=False, index=True
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    # 纯文本投影：降级显示路径使用，资源缺失时定义仍可读。
    plain_text: Mapped[str] = mapped_column(Text, nullable=False)
    # 可选 structured content：保留原始富文本 payload。
    structured_content: Mapped[dict[str, Any] | None] = mapped_column(json_dict(), nullable=True)


class DictionaryAsset(UuidPk, Timestamped, Base):
    __tablename__ = "dictionary_assets"
    __table_args__ = (UniqueConstraint("source_id", "relative_path"),)

    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("dictionary_sources.id"), nullable=False, index=True
    )
    relative_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # 存储位置（本地文件路径或句柄）。
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)


class DictionaryImportRun(UuidPk, Timestamped, Base):
    __tablename__ = "dictionary_import_runs"

    archive_hash: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    status: Mapped[DictionaryImportRunStatus] = mapped_column(
        str_enum(DictionaryImportRunStatus, name="dictionary_import_run_status"),
        nullable=False,
        default=DictionaryImportRunStatus.RUNNING,
    )
    error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 导入统计（条目数、义项数、资源数等）。
    stats: Mapped[dict[str, Any] | None] = mapped_column(json_dict(), nullable=True)
