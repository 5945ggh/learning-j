"""Lexeme 证据与用户裁定服务（`data-model.md` §2.2、§2.5，ADR-040）。

语义要点：

- 决定追加保存；每个 `(lexeme_id, scope_form_key)` 取最新 decision_seq。
  known 与其引用的 user_asserted KE 同一事务产生；unknown 压过该作用域的
  导入与 SRS 估计，但不伪造负向 KE、不删除历史；clear 清除人工覆盖回到
  其他来源求值，不重新启用旧 user_asserted。
- 来源撤回追加保存；撤回当前 known 引用的 KE 时，同一事务追加该作用域的
  clear（不回退到更旧人工决定）。同键重试返回原结果并说明已撤回。
- 所有变动与受影响作用域的摘要更新、投影 revision 递增同一事务提交；
  用户操作后的读取立即看见该决定（写后读一致，§11.2）。
- Lexeme 级摘要只使用 Lexeme 级证据与裁定；词形裁定不提升为整词结论。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from learningj.db.base import utcnow
from learningj.db.models.lexeme import (
    KnownEvidence,
    KnownEvidenceRetraction,
    Lexeme,
    LexemeEvidenceSummary,
    LexemeKnowledgeDecision,
    LexemeProjectionState,
)
from learningj.domain import versions
from learningj.domain.enums import (
    KnownEvidenceSource,
    KnownObservedAtBasis,
    LexemeDecision,
)
from learningj.domain.scopes import (
    KNOWN_RULE_VERSION,
    LEXEME_SCOPE_KEY,
    SCOPE_RESOLVER_VERSION,
    derive_scope_form_key,
)

_USER_ASSERTED_CONFIDENCE = 1.0
_IMPORT_SOURCES = (KnownEvidenceSource.IMPORT_ANKI, KnownEvidenceSource.IMPORT_JPDB)


class LexemeNotFoundError(LookupError):
    """目标 Lexeme 不存在。"""


class EvidenceNotFoundError(LookupError):
    """目标 KE 不存在。"""


class OperationConflictError(ValueError):
    """同 operation_key 异输入，或目标已被其他操作撤回。"""


@dataclass(frozen=True)
class DecisionResult:
    decision: LexemeKnowledgeDecision
    created: bool


@dataclass(frozen=True)
class RetractionResult:
    retraction: KnownEvidenceRetraction
    created: bool
    appended_clear: bool


def bump_projection_revision(session: Session) -> int:
    """递增持久变更序列（与事实写入同一事务调用）。"""
    state = session.get(LexemeProjectionState, 1)
    if state is None:
        state = LexemeProjectionState(id=1, revision=0)
        session.add(state)
        session.flush()
    state.revision += 1
    session.flush()
    return state.revision


def projection_revision(session: Session) -> int:
    state = session.get(LexemeProjectionState, 1)
    return state.revision if state else 0


def record_decision(
    session: Session,
    *,
    lexeme_id: str,
    decision: LexemeDecision,
    input_surface: str,
    input_reading: str | None = None,
    conjugated_form: str | None = None,
    material_id: uuid.UUID | None = None,
    operation_key: str,
    expected_decision_seq: int,
) -> DecisionResult:
    """记录一次用户裁定；known 同事务创建被引用的 user_asserted KE。"""
    if not input_surface:
        raise ValueError("input_surface 不能为空")
    if not operation_key:
        raise ValueError("operation_key 不能为空")
    if session.get(Lexeme, lexeme_id) is None:
        raise LexemeNotFoundError(f"词元不存在: {lexeme_id}")
    scope_form_key = derive_scope_form_key(conjugated_form)

    existing = session.scalar(
        select(LexemeKnowledgeDecision).where(
            LexemeKnowledgeDecision.operation_key == operation_key
        )
    )
    if existing is not None:
        _ensure_same_operation(
            session,
            existing,
            lexeme_id=lexeme_id,
            scope_form_key=scope_form_key,
            decision=decision,
            input_surface=input_surface,
            input_reading=input_reading,
            conjugated_form=conjugated_form,
            material_id=material_id,
        )
        return DecisionResult(existing, False)

    current_seq = _current_decision_seq(session, lexeme_id, scope_form_key)
    if expected_decision_seq != current_seq:
        raise OperationConflictError(
            f"作用域 {scope_form_key!r} 的裁定序号已变更（expected={expected_decision_seq}, "
            f"current={current_seq}）；请刷新后重试"
        )

    evidence_id: uuid.UUID | None = None
    if decision is LexemeDecision.KNOWN:
        evidence = KnownEvidence(
            lexeme_id=lexeme_id,
            conjugated_form=conjugated_form,
            scope_form_key=scope_form_key,
            source=KnownEvidenceSource.USER_ASSERTED,
            confidence=_USER_ASSERTED_CONFIDENCE,
            observed_at=utcnow(),
            observed_at_basis=KnownObservedAtBasis.USER_ACTION,
            analyzer_dict_version=versions.analyzer_dict_version(),
            resolver_version=SCOPE_RESOLVER_VERSION,
            input_surface=input_surface,
            input_reading=input_reading,
            material_id=material_id,
            operation_key=operation_key,
        )
        session.add(evidence)
        session.flush()
        evidence_id = evidence.id

    next_seq = current_seq + 1
    row = LexemeKnowledgeDecision(
        lexeme_id=lexeme_id,
        conjugated_form=conjugated_form,
        scope_form_key=scope_form_key,
        analyzer_dict_version=versions.analyzer_dict_version(),
        decision=decision,
        evidence_id=evidence_id,
        decision_seq=next_seq,
        operation_key=operation_key,
    )
    session.add(row)
    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        raise OperationConflictError(
            f"作用域 {scope_form_key!r} 的裁定序号已被并发写入；请刷新后重试"
        ) from exc
    except OperationalError as exc:
        if "locked" not in str(exc).lower():
            raise
        session.rollback()
        raise OperationConflictError(
            f"作用域 {scope_form_key!r} 正在被并发写入；请刷新后重试"
        ) from exc
    revision = bump_projection_revision(session)
    recompute_scope_summary(session, lexeme_id, scope_form_key, revision)
    session.flush()
    return DecisionResult(row, True)


def _ensure_same_operation(
    session: Session, existing: LexemeKnowledgeDecision, **expected: Any
) -> None:
    """同键同输入返回原结果，同键异输入拒绝（§2.2 operation_key 语义）。

    input_surface/input_reading 只随 known 的同事务 KE 持久化；其余决定的
    重放一致性按已持久化的裁定目标、作用域与裁定值判定。material_id 对
    known 决定经其引用的 KE 比对（决定本身不携带该字段）。
    """
    actual: dict[str, Any] = {
        "lexeme_id": existing.lexeme_id,
        "scope_form_key": existing.scope_form_key,
        "decision": existing.decision,
        "conjugated_form": existing.conjugated_form,
    }
    if existing.decision is LexemeDecision.KNOWN:
        evidence = session.get(KnownEvidence, existing.evidence_id)
        if evidence is None:
            raise OperationConflictError(
                f"operation_key {existing.operation_key!r} 引用的 user_asserted KE 不存在"
            )
        actual["input_surface"] = evidence.input_surface
        actual["input_reading"] = evidence.input_reading
        actual["material_id"] = evidence.material_id
    else:
        expected = {
            key: value
            for key, value in expected.items()
            if key not in ("input_surface", "input_reading", "material_id")
        }
    for key, value in expected.items():
        if actual.get(key) != value:
            raise OperationConflictError(
                f"operation_key {existing.operation_key!r} 已绑定不同输入（{key} 不一致）"
            )


def _next_decision_seq(session: Session, lexeme_id: str, scope_form_key: str) -> int:
    return _current_decision_seq(session, lexeme_id, scope_form_key) + 1


def _current_decision_seq(session: Session, lexeme_id: str, scope_form_key: str) -> int:
    current = session.scalar(
        select(func.max(LexemeKnowledgeDecision.decision_seq)).where(
            LexemeKnowledgeDecision.lexeme_id == lexeme_id,
            LexemeKnowledgeDecision.scope_form_key == scope_form_key,
        )
    )
    return current or 0


def retract_evidence(
    session: Session, *, evidence_id: uuid.UUID, reason: str | None = None, operation_key: str
) -> RetractionResult:
    """撤回一条 KE；撤回当前 known 引用的 KE 时同事务追加该作用域 clear。"""
    if not operation_key:
        raise ValueError("operation_key 不能为空")
    evidence = session.get(KnownEvidence, evidence_id)
    if evidence is None:
        raise EvidenceNotFoundError(f"证据不存在: {evidence_id}")

    existing = session.scalar(
        select(KnownEvidenceRetraction).where(
            KnownEvidenceRetraction.operation_key == operation_key
        )
    )
    if existing is not None:
        if existing.evidence_id != evidence_id:
            raise OperationConflictError(
                f"operation_key {operation_key!r} 已绑定不同输入（evidence_id 不一致）"
            )
        if existing.reason != reason:
            raise OperationConflictError(
                f"operation_key {operation_key!r} 已绑定不同输入（reason 不一致）"
            )
        return RetractionResult(existing, False, False)
    already = session.scalar(
        select(KnownEvidenceRetraction).where(KnownEvidenceRetraction.evidence_id == evidence_id)
    )
    if already is not None:
        raise OperationConflictError(
            f"证据 {evidence_id} 已被操作 {already.operation_key!r} 撤回；恢复需建立新断言"
        )

    retraction = KnownEvidenceRetraction(
        evidence_id=evidence_id, reason=reason, operation_key=operation_key
    )
    session.add(retraction)
    try:
        # Materialize the retraction before deriving the internal clear key;
        # this also turns a concurrent duplicate target/key into a stable 409
        # domain conflict rather than leaking an IntegrityError.
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        raise OperationConflictError(
            f"证据 {evidence_id} 的撤回已被并发写入；请刷新后重试"
        ) from exc
    except OperationalError as exc:
        if "locked" not in str(exc).lower():
            raise
        session.rollback()
        raise OperationConflictError(
            f"证据 {evidence_id} 正在被并发撤回；请刷新后重试"
        ) from exc

    appended_clear = False
    current = _current_decision(session, evidence.lexeme_id, evidence.scope_form_key)
    if (
        current is not None
        and current.decision is LexemeDecision.KNOWN
        and current.evidence_id == evidence_id
    ):
        clear_operation_key = _new_internal_operation_key(session, "retraction-clear")
        clear = LexemeKnowledgeDecision(
            lexeme_id=evidence.lexeme_id,
            conjugated_form=evidence.conjugated_form,
            scope_form_key=evidence.scope_form_key,
            analyzer_dict_version=versions.analyzer_dict_version(),
            decision=LexemeDecision.CLEAR,
            evidence_id=None,
            decision_seq=_next_decision_seq(session, evidence.lexeme_id, evidence.scope_form_key),
            operation_key=clear_operation_key,
        )
        session.add(clear)
        appended_clear = True

    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        raise OperationConflictError(
            f"证据 {evidence_id} 的撤回附加裁定发生并发冲突；请刷新后重试"
        ) from exc
    except OperationalError as exc:
        if "locked" not in str(exc).lower():
            raise
        session.rollback()
        raise OperationConflictError(
            f"证据 {evidence_id} 的撤回附加裁定发生并发冲突；请刷新后重试"
        ) from exc
    revision = bump_projection_revision(session)
    recompute_scope_summary(session, evidence.lexeme_id, evidence.scope_form_key, revision)
    session.flush()
    return RetractionResult(retraction, True, appended_clear)


def _new_internal_operation_key(session: Session, namespace: str) -> str:
    """Generate an operation key outside the caller-controlled key space."""
    while True:
        key = f"__learningj_internal__:{namespace}:{uuid.uuid4().hex}"
        if session.scalar(
            select(LexemeKnowledgeDecision.id).where(
                LexemeKnowledgeDecision.operation_key == key
            )
        ) is None:
            return key


def _current_decision(
    session: Session, lexeme_id: str, scope_form_key: str
) -> LexemeKnowledgeDecision | None:
    return session.scalar(
        select(LexemeKnowledgeDecision)
        .where(
            LexemeKnowledgeDecision.lexeme_id == lexeme_id,
            LexemeKnowledgeDecision.scope_form_key == scope_form_key,
        )
        .order_by(LexemeKnowledgeDecision.decision_seq.desc())
        .limit(1)
    )


def recompute_scope_summary(
    session: Session, lexeme_id: str, scope_form_key: str, revision: int
) -> LexemeEvidenceSummary:
    """从事实表重算一个作用域的摘要（可重建投影；撤回/clear 后效果保持）。"""
    latest = _current_decision(session, lexeme_id, scope_form_key)
    valid_rows = session.execute(
        select(KnownEvidence.source, func.count())
        .outerjoin(KnownEvidenceRetraction, KnownEvidenceRetraction.evidence_id == KnownEvidence.id)
        .where(
            KnownEvidence.lexeme_id == lexeme_id,
            KnownEvidence.scope_form_key == scope_form_key,
            KnownEvidenceRetraction.id.is_(None),
        )
        .group_by(KnownEvidence.source)
    ).all()
    counts = {source.value: count for source, count in valid_rows}

    summary = session.get(LexemeEvidenceSummary, (lexeme_id, scope_form_key))
    if summary is None:
        summary = LexemeEvidenceSummary(
            lexeme_id=lexeme_id,
            scope_form_key=scope_form_key,
        )
        session.add(summary)
    summary.current_decision = latest.decision if latest else None
    summary.current_decision_id = latest.id if latest else None
    summary.current_decision_seq = latest.decision_seq if latest else None
    summary.known_evidence_id = (
        latest.evidence_id if latest is not None and latest.decision is LexemeDecision.KNOWN else None
    )
    summary.valid_source_counts = counts
    summary.input_revision = revision
    summary.known_rule_version = KNOWN_RULE_VERSION
    summary.resolver_version = SCOPE_RESOLVER_VERSION
    session.flush()
    return summary


def rebuild_summaries(session: Session, *, lexeme_ids: list[str] | None = None) -> int:
    """从事实表重建摘要投影（缺 scope 行补建），返回作用域行数（§2.5）。"""
    evidence_scope_query = select(
        KnownEvidence.lexeme_id, KnownEvidence.scope_form_key
    )
    decision_scope_query = select(
        LexemeKnowledgeDecision.lexeme_id,
        LexemeKnowledgeDecision.scope_form_key,
    )
    if lexeme_ids is not None:
        # Keep target scoping in SQL.  Filtering the DISTINCT results in Python
        # would still scan unrelated historical facts (11a structural gate).
        wanted = set(lexeme_ids)
        evidence_scope_query = evidence_scope_query.where(KnownEvidence.lexeme_id.in_(wanted))
        decision_scope_query = decision_scope_query.where(
            LexemeKnowledgeDecision.lexeme_id.in_(wanted)
        )
    evidence_scopes = session.execute(evidence_scope_query.distinct()).all()
    decision_scopes = session.execute(decision_scope_query.distinct()).all()
    scopes = sorted(set(evidence_scopes) | set(decision_scopes))
    revision = bump_projection_revision(session)
    for lexeme_id, scope_form_key in scopes:
        recompute_scope_summary(session, lexeme_id, scope_form_key, revision)
    return len(scopes)


def scope_summaries(session: Session, lexeme_id: str) -> list[LexemeEvidenceSummary]:
    """按 scope_form_key 排序返回一个词元的全部摘要行。"""
    return list(
        session.scalars(
            select(LexemeEvidenceSummary)
            .where(LexemeEvidenceSummary.lexeme_id == lexeme_id)
            .order_by(LexemeEvidenceSummary.scope_form_key)
        )
    )


def evidence_rows(
    session: Session, *, lexeme_id: str, limit: int = 100, offset: int = 0
) -> list[tuple[KnownEvidence, uuid.UUID | None]]:
    """分页读取原始证据及其撤回标记（§2.5「原始证据分页读取」）。"""
    rows = session.execute(
        select(KnownEvidence, KnownEvidenceRetraction.id)
        .outerjoin(KnownEvidenceRetraction, KnownEvidenceRetraction.evidence_id == KnownEvidence.id)
        .where(KnownEvidence.lexeme_id == lexeme_id)
        .order_by(KnownEvidence.observed_at, KnownEvidence.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return [(evidence, retraction_id) for evidence, retraction_id in rows]


def _summary_map(session: Session, lexeme_id: str) -> dict[str, LexemeEvidenceSummary]:
    return {summary.scope_form_key: summary for summary in scope_summaries(session, lexeme_id)}


def _summary_maps(
    session: Session, lexeme_ids: list[str]
) -> dict[str, dict[str, LexemeEvidenceSummary]]:
    """批量读取目标词的摘要，避免 known-view batch 的 N+1 查询。"""
    if not lexeme_ids:
        return {}
    rows = session.scalars(
        select(LexemeEvidenceSummary)
        .where(LexemeEvidenceSummary.lexeme_id.in_(set(lexeme_ids)))
        .order_by(LexemeEvidenceSummary.lexeme_id, LexemeEvidenceSummary.scope_form_key)
    ).all()
    grouped: dict[str, dict[str, LexemeEvidenceSummary]] = {}
    for summary in rows:
        grouped.setdefault(summary.lexeme_id, {})[summary.scope_form_key] = summary
    return grouped


def _valid_user_evidence_ids(session: Session, evidence_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """被引用 KE 的有效性核对（防御直写事实表的场景；服务路径恒有效）。"""
    if not evidence_ids:
        return set()
    rows = session.execute(
        select(KnownEvidence.id)
        .outerjoin(KnownEvidenceRetraction, KnownEvidenceRetraction.evidence_id == KnownEvidence.id)
        .where(KnownEvidence.id.in_(evidence_ids), KnownEvidenceRetraction.id.is_(None))
    ).all()
    return {row[0] for row in rows}


def compose_known_view(
    session: Session, *, lexeme_id: str, form: str | None = None
) -> dict[str, Any]:
    """组合一个目标（Lexeme 或具体词形）的已知状态视图（§2.5 LexemeKnownView）。

    作用域规则：词形查询先取该词形的非 clear 裁定，再回退 Lexeme 级裁定；
    clear 只清除所在作用域。无有效人工裁定时回到其他来源：有效导入 KE
    支持 → known（basis=import_evidence）；SRS 分量 P5 落地后并入，本版缺席。
    """
    summaries = _summary_map(session, lexeme_id)
    candidates = _known_view_candidates(summaries, form)
    evidence_ids = [summary.known_evidence_id for summary, _ in candidates if summary.known_evidence_id]
    valid_evidence = _valid_user_evidence_ids(session, evidence_ids)
    return _compose_known_view_payload(
        lexeme_id=lexeme_id,
        form=form,
        summaries=summaries,
        valid_evidence=valid_evidence,
    )


def compose_known_views_batch(
    session: Session, targets: list[tuple[str, str | None]]
) -> list[dict[str, Any]]:
    """批量组合 known views，保留输入顺序与重复目标语义。

    摘要按目标 Lexeme 一次性读取；所有被候选决定引用的 user_asserted
    evidence 也在一次查询中校验，避免目标数线性增加 SQL 次数。
    """
    lexeme_ids = list(dict.fromkeys(lexeme_id for lexeme_id, _ in targets))
    summary_maps = _summary_maps(session, lexeme_ids)
    candidate_rows = [
        candidate
        for lexeme_id, form in targets
        for candidate in _known_view_candidates(summary_maps.get(lexeme_id, {}), form)
    ]
    evidence_ids = list(
        dict.fromkeys(
            summary.known_evidence_id
            for summary, _ in candidate_rows
            if summary.known_evidence_id is not None
        )
    )
    valid_evidence = _valid_user_evidence_ids(session, evidence_ids)
    return [
        _compose_known_view_payload(
            lexeme_id=lexeme_id,
            form=form,
            summaries=summary_maps.get(lexeme_id, {}),
            valid_evidence=valid_evidence,
        )
        for lexeme_id, form in targets
    ]


def _known_view_candidates(
    summaries: dict[str, LexemeEvidenceSummary], form: str | None
) -> list[tuple[LexemeEvidenceSummary, str]]:
    lexeme_scope = summaries.get(LEXEME_SCOPE_KEY)
    form_scope = summaries.get(derive_scope_form_key(form)) if form is not None else None
    candidates: list[tuple[LexemeEvidenceSummary, str]] = []
    if form_scope is not None and form_scope.current_decision is not None:
        candidates.append((form_scope, "form_decision"))
    if lexeme_scope is not None and lexeme_scope.current_decision is not None:
        candidates.append((lexeme_scope, "lexeme_decision"))
    return candidates


def _compose_known_view_payload(
    *,
    lexeme_id: str,
    form: str | None,
    summaries: dict[str, LexemeEvidenceSummary],
    valid_evidence: set[uuid.UUID],
) -> dict[str, Any]:
    lexeme_scope = summaries.get(LEXEME_SCOPE_KEY)
    form_scope = summaries.get(derive_scope_form_key(form)) if form is not None else None

    effective_state: str | None = None
    effective_basis: str | None = None
    effective_decision_id: uuid.UUID | None = None
    effective_evidence_id: uuid.UUID | None = None

    candidates = _known_view_candidates(summaries, form)
    for scope_summary, basis in candidates:
        if scope_summary.current_decision == LexemeDecision.CLEAR:
            continue
        if scope_summary.current_decision is None:
            continue
        referenced = scope_summary.known_evidence_id
        if scope_summary.current_decision == LexemeDecision.KNOWN:
            if referenced not in valid_evidence:
                continue  # 引用的 KE 已失效：该 known 不贡献
        effective_state = scope_summary.current_decision.value
        effective_basis = basis
        effective_decision_id = scope_summary.current_decision_id
        effective_evidence_id = referenced
        break

    if effective_state is None:
        import_support = _import_support_count(lexeme_scope) + (
            _import_support_count(form_scope) if form_scope is not None else 0
        )
        if import_support > 0:
            effective_state = LexemeDecision.KNOWN.value
            effective_basis = "import_evidence"

    return {
        "lexeme_id": lexeme_id,
        "form": form,
        "lexeme_scope": _summary_payload(lexeme_scope),
        "form_scope": _summary_payload(form_scope),
        "effective": {
            "state": effective_state,
            "basis": effective_basis,
            "decision_id": str(effective_decision_id) if effective_decision_id else None,
            "evidence_id": str(effective_evidence_id) if effective_evidence_id else None,
        },
    }


def _import_support_count(scope_summary: LexemeEvidenceSummary | None) -> int:
    if scope_summary is None:
        return 0
    counts = scope_summary.valid_source_counts or {}
    return sum(int(counts.get(source.value, 0)) for source in _IMPORT_SOURCES)


def _summary_payload(summary: LexemeEvidenceSummary | None) -> dict[str, Any] | None:
    if summary is None:
        return None
    return {
        "scope_form_key": summary.scope_form_key,
        "current_decision": summary.current_decision.value if summary.current_decision else None,
        "current_decision_seq": summary.current_decision_seq,
        "current_decision_id": str(summary.current_decision_id) if summary.current_decision_id else None,
        "known_evidence_id": str(summary.known_evidence_id) if summary.known_evidence_id else None,
        "valid_source_counts": summary.valid_source_counts,
        "input_revision": summary.input_revision,
        "known_rule_version": summary.known_rule_version,
        "resolver_version": summary.resolver_version,
    }
