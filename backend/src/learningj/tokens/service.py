"""算法 token 视图（plan P2「算法阅读器」第 1 条，§8.3，ADR-009/018）。

句子 token API 的数据源是**当前已发布 sidecar 的不可变 payload**：token
表层、规范化形、POS、reading、code point 半开区间与 lexeme_id 全部来自
分词代次本身，响应携带 `sidecar_generation_id` 与三个版本戳
（segmenter/tokenizer/analyzer_dict）。

读取面对 payload 形状保持开放（§8.3 的 payload 是开放分句/分词结果）：
只按已知键读取 P2 需要的字段，额外键（如 ruby_hints）原样忽略、不冻结
payload 结构。已发布 payload 中缺失 lexeme_id 属发布契约违例——发布闸门
（`ingest._generation_counts`）本应拒绝，读取层显式报错而非返回残缺 token。

词典来源/version provenance（§2.0「查询结果必须带 source/version
provenance」）按 token 的 normalized_form 与已导入词典条目精确匹配，
provenance 明细去重置于响应顶层。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

import msgpack
from sqlalchemy import select
from sqlalchemy.orm import Session

from learningj.db.models.dictionary import DictionaryEntry, DictionarySource
from learningj.db.models.material import Material, Sentence, Sidecar


class SidecarNotPublishedError(LookupError):
    """素材尚未发布分词代次。"""


class SentenceNotFoundError(LookupError):
    """句子不存在。"""


class PayloadIntegrityError(RuntimeError):
    """已发布 payload 缺少发布契约必需的字段（如 lexeme_id）。"""


@dataclass
class TokenView:
    surface: str
    normalized_form: str
    pos: str
    reading_form: str
    reading_source: str
    lexeme_id: str
    char_start: int
    char_end: int
    dictionary_source_ids: list[str]


@dataclass(frozen=True)
class SentenceTokenView:
    sentence_id: uuid.UUID
    material_id: uuid.UUID
    sidecar_generation_id: uuid.UUID
    segmenter_version: str
    tokenizer_version: str
    analyzer_dict_version: str
    tokens: list[TokenView]
    dictionary_sources: list[dict[str, str]]


def sentence_tokens(session: Session, *, sentence_id: uuid.UUID) -> SentenceTokenView:
    sentence = session.get(Sentence, sentence_id)
    if sentence is None:
        raise SentenceNotFoundError(f"句子不存在: {sentence_id}")
    material = session.get(Material, sentence.material_id)
    if material is None or material.current_sidecar_id is None:
        raise SidecarNotPublishedError("素材尚未发布分词代次")
    sidecar = session.get(Sidecar, material.current_sidecar_id)
    if sidecar is None:
        raise SidecarNotPublishedError("素材尚未发布分词代次")

    payload: dict[str, Any] = msgpack.unpackb(sidecar.payload, raw=False)
    group = _group_for_sentence(payload, sentence.index)
    raw_tokens = group.get("tokens")
    if not isinstance(raw_tokens, list):
        raise PayloadIntegrityError("sidecar payload 缺少该句的 tokens")

    tokens: list[TokenView] = []
    for position, raw in enumerate(raw_tokens):
        if not isinstance(raw, dict):
            raise PayloadIntegrityError(f"token #{position} 不是对象")
        lexeme_id = raw.get("lexeme_id")
        surface = raw.get("surface")
        if not isinstance(lexeme_id, str) or not lexeme_id:
            raise PayloadIntegrityError(
                f"token #{position}（{surface!r}）缺少派生 lexeme_id；发布契约要求拒绝缺 id 的 token"
            )
        char_start, char_end = raw.get("char_start"), raw.get("char_end")
        if not isinstance(char_start, int) or not isinstance(char_end, int):
            raise PayloadIntegrityError(f"token #{position} 缺少 code point 区间")
        tokens.append(
            TokenView(
                surface=str(surface),
                normalized_form=str(raw.get("normalized_form", "")),
                pos=str(raw.get("pos", "")),
                reading_form=str(raw.get("reading_form", "")),
                reading_source=str(raw.get("reading_source") or "sudachi"),
                lexeme_id=lexeme_id,
                char_start=char_start,
                char_end=char_end,
                dictionary_source_ids=[],
            )
        )

    provenance = _dictionary_provenance(session, {token.normalized_form for token in tokens})
    for token in tokens:
        token.dictionary_source_ids = provenance["by_form"].get(token.normalized_form, [])
    sources = provenance["sources"]
    return SentenceTokenView(
        sentence_id=sentence.id,
        material_id=material.id,
        sidecar_generation_id=sidecar.id,
        segmenter_version=sidecar.segmenter_version,
        tokenizer_version=sidecar.tokenizer_version,
        analyzer_dict_version=sidecar.analyzer_dict_version,
        tokens=tokens,
        dictionary_sources=sources,
    )


def _group_for_sentence(payload: dict[str, Any], sentence_index: int) -> dict[str, Any]:
    for group in payload.get("sentences", []):
        if isinstance(group, dict) and group.get("sentence_index") == sentence_index:
            return group
    raise PayloadIntegrityError(f"sidecar payload 缺少 sentence_index={sentence_index} 的分词结果")


def _dictionary_provenance(session: Session, normalized_forms: set[str]) -> dict[str, Any]:
    """一次批量查询给出全部命中词形的词典来源 provenance（§11.1 目标集读取）。"""
    by_form: dict[str, list[str]] = {}
    sources: dict[str, dict[str, str]] = {}
    if not normalized_forms:
        return {"by_form": by_form, "sources": []}
    rows = session.execute(
        select(DictionaryEntry.expression, DictionarySource.id, DictionarySource.display_name, DictionarySource.source_version)
        .join(DictionarySource, DictionarySource.id == DictionaryEntry.source_id)
        .where(DictionaryEntry.expression.in_(normalized_forms))
        .order_by(DictionarySource.display_name, DictionarySource.id)
    ).all()
    for expression, source_id, display_name, source_version in rows:
        key = str(source_id)
        by_form.setdefault(expression, [])
        if key not in by_form[expression]:
            by_form[expression].append(key)
        sources.setdefault(
            key,
            {"source_id": key, "display_name": display_name, "source_version": source_version},
        )
    ordered = [sources[key] for key in sorted(sources, key=lambda k: (sources[k]["display_name"], k))]
    return {"by_form": by_form, "sources": ordered}
