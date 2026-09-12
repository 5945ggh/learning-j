"""Annotation 服务：阅读器划线与批注（`data-model.md` §5，ADR-030，ADR-009）。

边界：

- Annotation 是叶子实体，与 KnowledgePoint 之间没有边；创建/读取/删除
  **不产生 KP、ReviewItem 或 KE**（§9 不变量 8 的生产行为面）。
- 用户选区只给 surface；char_start/char_end 由后端在规范化句文本上
  find_all 定位得出，code point 半开区间（ADR-009，§1）。0 命中对用户
  选区是非法输入（选区必来自句文本），拒绝而非静默跳过；>1 命中按 §1
  为每处命中各产生一个 Span，全部标 ambiguous。
- token 对齐是对当前已发布 sidecar 的派生值：完整覆盖连续 token 区间 →
  aligned；有重叠但边界不落在 token 上 → partial；无 sidecar 或无重叠 →
  unaligned。字符区间始终是权威值。
- 跨句划线 = 有序 Span 数组（annotation_spans.ordinal 保证顺序）。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import msgpack
from sqlalchemy import select
from sqlalchemy.orm import Session

from learningj.db.models.annotation import Annotation
from learningj.db.models.material import Material, Sentence, Sidecar
from learningj.db.models.span import Span, annotation_spans
from learningj.domain.enums import AlignmentStatus
from learningj.domain.ids import new_uuid7
from learningj.domain.offsets import find_all_occurrences, slice_by_code_point


class AnnotationInputError(ValueError):
    """划线输入非法（surface 未命中等）。"""


class SentenceNotFoundError(LookupError):
    """句子不存在或不属于该素材。"""


@dataclass(frozen=True)
class SpanInput:
    sentence_id: uuid.UUID
    surface: str


@dataclass(frozen=True)
class AnnotationResult:
    annotation: Annotation
    spans: list[Span]


def create_annotation(
    session: Session,
    *,
    material_id: uuid.UUID,
    spans: list[SpanInput],
    note: str | None = None,
    color: str | None = None,
) -> AnnotationResult:
    """创建划线：定位每个选区、对齐 token、写入有序 Span 数组（短事务内）。"""
    if not spans:
        raise AnnotationInputError("划线至少需要一个 span")
    for item in spans:
        if not item.surface:
            raise AnnotationInputError("surface 不能为空")

    sidecar_tokens = _sidecar_tokens_by_sentence(session, material_id)
    annotation = Annotation(material_id=material_id, note=note, color=color)
    session.add(annotation)
    session.flush()

    span_rows: list[Span] = []
    for item in spans:
        sentence = session.get(Sentence, item.sentence_id)
        if sentence is None or sentence.material_id != material_id:
            raise SentenceNotFoundError(f"句子不存在或不属于该素材: {item.sentence_id}")
        occurrences = find_all_occurrences(sentence.text, item.surface)
        if not occurrences:
            raise AnnotationInputError(
                f"surface 在句 {item.sentence_id} 中未命中（选区必须来自句文本）: {item.surface!r}"
            )
        tokens = sidecar_tokens.get(sentence.index)
        sidecar_id = _current_sidecar_id(session, material_id)
        # §1：>1 命中为每处各产生一个 Span 并全部标 ambiguous（「不知道指
        # 哪一处」）；单命中才做 token 对齐判定（aligned/partial/unaligned）。
        ambiguous = len(occurrences) > 1
        for char_start, char_end in occurrences:
            if ambiguous:
                token_start: int | None = None
                token_end: int | None = None
                status = AlignmentStatus.AMBIGUOUS
            else:
                token_start, token_end, status = _align_to_tokens(tokens, char_start, char_end)
            span_rows.append(
                Span(
                    span_id=new_uuid7(),
                    sentence_id=sentence.id,
                    surface=item.surface,
                    char_start=char_start,
                    char_end=char_end,
                    alignment_sidecar_id=sidecar_id
                    if status in (AlignmentStatus.ALIGNED, AlignmentStatus.PARTIAL)
                    else None,
                    token_start=token_start,
                    token_end=token_end,
                    alignment_status=status,
                )
            )
    session.add_all(span_rows)
    session.flush()
    for ordinal, span in enumerate(span_rows):
        session.execute(
            annotation_spans.insert().values(annotation_id=annotation.id, span_id=span.span_id, ordinal=ordinal)
        )
    session.flush()
    return AnnotationResult(annotation, span_rows)


def _current_sidecar_id(session: Session, material_id: uuid.UUID) -> uuid.UUID | None:
    material = session.get(Material, material_id)
    return material.current_sidecar_id if material else None


def _sidecar_tokens_by_sentence(session: Session, material_id: uuid.UUID) -> dict[int, list[dict[str, Any]]]:
    """读取当前已发布 sidecar 的 token 序列（按 sentence_index）。"""
    sidecar_id = _current_sidecar_id(session, material_id)
    if sidecar_id is None:
        return {}
    sidecar = session.get(Sidecar, sidecar_id)
    if sidecar is None:
        return {}
    payload = msgpack.unpackb(sidecar.payload, raw=False)
    tokens_by_index: dict[int, list[dict[str, Any]]] = {}
    for group in payload.get("sentences", []):
        index = group.get("sentence_index")
        tokens = group.get("tokens")
        if isinstance(index, int) and isinstance(tokens, list):
            tokens_by_index[index] = tokens
    return tokens_by_index


def _align_to_tokens(
    tokens: list[dict[str, Any]] | None, char_start: int, char_end: int
) -> tuple[int | None, int | None, AlignmentStatus]:
    """把字符区间对齐到 token 序列（§1：token 区间是派生值）。

    返回 (token_start, token_end, status)；token 区间仅对 aligned 给出。
    """
    if not tokens:
        return None, None, AlignmentStatus.UNALIGNED
    overlapping = [
        index
        for index, token in enumerate(tokens)
        if token.get("char_end", 0) > char_start and token.get("char_start", 0) < char_end
    ]
    if not overlapping:
        return None, None, AlignmentStatus.UNALIGNED
    first, last = overlapping[0], overlapping[-1]
    # token 序列铺满整句；两端恰好落在 token 边界即视为完整对齐。
    if tokens[first].get("char_start") == char_start and tokens[last].get("char_end") == char_end:
        return first, last + 1, AlignmentStatus.ALIGNED
    return None, None, AlignmentStatus.PARTIAL


def get_annotation(
    session: Session, *, annotation_id: uuid.UUID
) -> tuple[Annotation, list[Span]] | None:
    annotation = session.get(Annotation, annotation_id)
    if annotation is None:
        return None
    return annotation, _ordered_spans(session, annotation.id)


def list_annotations(
    session: Session,
    *,
    material_id: uuid.UUID,
    query: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[tuple[Annotation, list[Span]]]:
    """列表检索；按文本（note 或 span surface 子串）与时间筛选，跳回原文
    所需的位置数据随 span 一起返回。"""
    statement = select(Annotation).where(Annotation.material_id == material_id)
    if query:
        pattern = f"%{query}%"
        matched_annotation_ids = (
            select(annotation_spans.c.annotation_id)
            .join(Span, Span.span_id == annotation_spans.c.span_id)
            .where(Span.surface.like(pattern))
        )
        statement = statement.where(
            Annotation.note.like(pattern) | Annotation.id.in_(matched_annotation_ids)
        )
    if since is not None:
        statement = statement.where(Annotation.created_at >= since)
    if until is not None:
        statement = statement.where(Annotation.created_at < until)
    statement = statement.order_by(Annotation.created_at.desc(), Annotation.id).limit(limit).offset(offset)
    return [
        (annotation, _ordered_spans(session, annotation.id))
        for annotation in session.scalars(statement)
    ]


def delete_annotation(session: Session, *, annotation_id: uuid.UUID) -> bool:
    """删除个人批注数据：移除关联行并清理不再被引用的 Span（§0.1 引用处理）。"""
    annotation = session.get(Annotation, annotation_id)
    if annotation is None:
        return False
    span_ids = [
        row[0]
        for row in session.execute(
            select(annotation_spans.c.span_id).where(
                annotation_spans.c.annotation_id == annotation_id
            )
        ).all()
    ]
    session.execute(
        annotation_spans.delete().where(annotation_spans.c.annotation_id == annotation_id)
    )
    for span_id in span_ids:
        still_referenced = session.execute(
            select(annotation_spans.c.span_id).where(annotation_spans.c.span_id == span_id).limit(1)
        ).first()
        if still_referenced is None:
            span = session.get(Span, span_id)
            if span is not None:
                session.delete(span)
    session.delete(annotation)
    session.flush()
    return True


def _ordered_spans(session: Session, annotation_id: uuid.UUID) -> list[Span]:
    rows = session.execute(
        select(Span, annotation_spans.c.ordinal)
        .join(annotation_spans, annotation_spans.c.span_id == Span.span_id)
        .where(annotation_spans.c.annotation_id == annotation_id)
        .order_by(annotation_spans.c.ordinal)
    ).all()
    return [span for span, _ in rows]


def span_surface_matches(sentence_text: str, span: Span) -> bool:
    """§9 不变量 6 的生产行为断言入口：切片必须等于 surface。"""
    return slice_by_code_point(sentence_text, span.char_start, span.char_end) == span.surface
