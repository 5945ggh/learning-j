"""素材、句子与 Sidecar（`data-model.md` §8）。

统一抽象：**素材 = 有序 Sentence 序列 + 可选时间戳 + 可选 locator**。
视频、音频、文本的差异全部落在「时间戳有没有」与「locator 指向什么」上；
上层不得按素材类型分支。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    Index,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from learningj.db.base import Base, Timestamped, UuidPk
from learningj.db.types import json_dict, str_enum
from learningj.domain.enums import MaterialKind, MaterialStorageMode, SentenceAnchorType


class Material(UuidPk, Timestamped, Base):
    __tablename__ = "materials"

    title: Mapped[str] = mapped_column(String(512), nullable=False)
    # 对规范化后的素材文本计算（§0）；不存媒体副本，只存 locator + hash（ADR-010）。
    content_hash: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    # 文件句柄、路径或受控 managed-copy locator。
    locator: Mapped[str] = mapped_column(String(1024), nullable=False)
    kind: Mapped[MaterialKind] = mapped_column(
        str_enum(MaterialKind, name="material_kind"), nullable=False
    )
    copy_stored: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    storage_mode: Mapped[MaterialStorageMode] = mapped_column(
        str_enum(MaterialStorageMode, name="material_storage_mode"),
        nullable=False,
        default=MaterialStorageMode.EXTERNAL_REFERENCE,
    )
    # Raw input identity is deliberately distinct from the normalized-text hash.
    source_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # EPUB reader projection identity/manifest.  These are nullable for the
    # existing text/subtitle paths and for historical external references.
    publication_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    publication_manifest: Mapped[dict[str, Any] | None] = mapped_column(json_dict(), nullable=True)
    # Only a fully-built sidecar generation is published here.  The FK is
    # deliberately nullable while an import is being prepared.
    current_sidecar_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sidecars.id"), nullable=True, index=True
    )


class Sentence(UuidPk, Timestamped, Base):
    __tablename__ = "sentences"
    __table_args__ = (UniqueConstraint("material_id", "index"),)

    material_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("materials.id"), nullable=False, index=True
    )
    # 材料内序号。列名 `index` 在 SQLite 中为关键字，由 SQLAlchemy 负责加引号。
    index: Mapped[int] = mapped_column("index", Integer, nullable=False)
    # 规范文本（NFC、LF）：模型输入、surface 定位与前端展示共用（§0）。
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # 毫秒；仅字幕类素材有值。
    time_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    time_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 随素材附带的译文。作为参考而非标准传入解析。
    translation: Mapped[str | None] = mapped_column(Text, nullable=True)
    anchor_type: Mapped[SentenceAnchorType] = mapped_column(
        str_enum(SentenceAnchorType, name="sentence_anchor_type"), nullable=False
    )
    # 类型特定的位置数据：subtitle{cue_index} / plain_text{char_start,char_end}
    # / epub{spine_index,char_start,char_end}。不使用 CFI。
    anchor_payload: Mapped[dict[str, Any]] = mapped_column(json_dict(), nullable=False)


class Sidecar(UuidPk, Timestamped, Base):
    __tablename__ = "sidecars"

    material_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("materials.id"), nullable=False, index=True
    )
    # 分句/分词所针对的规范化文本的 content_hash，用于检出素材变化导致的过期。
    content_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # 三个版本戳全部不可推迟（§8.3）：analyzer_dict_version（SudachiDict）
    # 与释义词典来源版本属于不同命名空间，不得混用。
    segmenter_version: Mapped[str] = mapped_column(String(255), nullable=False)
    tokenizer_version: Mapped[str] = mapped_column(String(255), nullable=False)
    analyzer_dict_version: Mapped[str] = mapped_column(String(255), nullable=False)
    # 分句／分词结果，messagepack 序列化。
    payload: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)


class MaterialLexemeCount(Base):
    """Current-sidecar token counts, indexed in both material and lexeme order.

    Rows are generation scoped; readers select them through
    ``Material.current_sidecar_id`` so one response never mixes generations.
    """

    __tablename__ = "material_lexeme_counts"
    __table_args__ = (
        CheckConstraint("token_count > 0", name="token_count_positive"),
        Index("ix_material_lexeme_counts_lexeme_material_sidecar", "lexeme_id", "material_id", "sidecar_id"),
    )

    material_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("materials.id"), primary_key=True
    )
    sidecar_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sidecars.id"), primary_key=True
    )
    lexeme_id: Mapped[str] = mapped_column(
        ForeignKey("lexemes.lexeme_id"), primary_key=True
    )
    token_count: Mapped[int] = mapped_column(Integer, nullable=False)
