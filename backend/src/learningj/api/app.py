"""FastAPI 应用与路由（ADR-020）。

P0 交付素材端点（materials/sentences/sidecar），响应统一经
`learningj.api.schemas` 的 Pydantic 模型暴露（OpenAPI 可生成）。
P1 补齐词频索引与代次重建；P2 交付算法 token 视图、词典导入/查找、
Annotation 与 Lexeme 证据入口。业务端点在 P3–P5 按阶段补齐；
路由自身不写 SQL，事务边界由服务层保持（短事务发布，I/O 在事务外）。
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime
from pathlib import Path

import msgpack
from fastapi import Depends, FastAPI, File, Form, HTTPException, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from learningj.annotations import service as annotation_service
from learningj.api.schemas import (
    AlgorithmTokenOut,
    AnnotationCreateIn,
    AnnotationOut,
    AnnotationSpanOut,
    DecisionCreateIn,
    DecisionOut,
    DictionaryDefinitionOut,
    DictionaryImportOut,
    DictionaryLookupOut,
    DictionarySearchOut,
    DictionarySourceOut,
    EffectiveKnownOut,
    EvidenceItemOut,
    EvidenceListOut,
    EvidenceSummaryOut,
    EvidenceSummaryScopeOut,
    KnownViewItemOut,
    KnownViewsBatchIn,
    KnownViewsBatchOut,
    LookupEntryOut,
    MaterialLexemeCountOut,
    MaterialLexemeCountsOut,
    MaterialOut,
    RetractionCreateIn,
    RetractionOut,
    SentenceOut,
    SentenceTokensOut,
    SidecarOut,
    TokenProvenanceOut,
)
from learningj.db.session import make_engine, make_session_factory
from learningj.db.models.lexeme import (
    KnownEvidence,
    Lexeme,
    LexemeEvidenceSummary,
    LexemeKnowledgeDecision,
)
from learningj.db.models.material import Material, MaterialLexemeCount, Sentence, Sidecar
from learningj.dictionary import service as dictionary_service
from learningj.dictionary.importer import DictionaryImportError
from learningj.domain.enums import MaterialStorageMode
from learningj.evidence import service as evidence_service
from learningj.ingest.service import import_material, retokenize_material
from learningj.tokens import service as token_service

_DEFAULT_ASSETS_ROOT = "learningj-assets"


def create_app(
    db_url: str = "sqlite:///./learningj.db",
    assets_root: str | Path | None = None,
) -> FastAPI:
    """构造 FastAPI 应用。

    引擎在应用创建时绑定；词典导入的资源文件写入 ``assets_root``
    （默认环境变量 ``LEARNINGJ_ASSETS_ROOT``，否则工作目录下的
    ``learningj-assets/``）。
    """
    engine = make_engine(db_url)
    session_factory = make_session_factory(engine)

    resolved_assets_root = Path(
        assets_root or os.environ.get("LEARNINGJ_ASSETS_ROOT") or _DEFAULT_ASSETS_ROOT
    )
    app = FastAPI(
        title="LearningJ API",
        version="0.1.0",
        description="Local backend for LearningJ (ADR-020).",
    )
    app.state.engine = engine
    app.state.session_factory = session_factory
    app.state.assets_root = resolved_assets_root

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    def db_session() -> Session:
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    @app.post("/materials", status_code=201, response_model=MaterialOut)
    async def create_material(
        file: UploadFile = File(...),
        title: str | None = Form(default=None),
        locator: str | None = Form(default=None),
        storage_mode: MaterialStorageMode = Form(default=MaterialStorageMode.EXTERNAL_REFERENCE),
        session: Session = Depends(db_session),
    ) -> MaterialOut:
        """Import txt, srt, vtt, or epub content and return its stable id."""
        filename = file.filename or "material.txt"
        suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if suffix not in {"txt", "srt", "vtt", "epub"}:
            raise HTTPException(status_code=415, detail="仅支持 .txt、.srt、.vtt、.epub")
        blob = await file.read()
        try:
            material = import_material(
                session,
                filename=filename,
                blob=blob,
                locator=locator or filename,
                title=title,
                storage_mode=storage_mode,
            )
        except (ValueError, RuntimeError, KeyError, OSError) as exc:
            session.rollback()
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return _material_response(session, material)

    @app.get("/materials", response_model=list[MaterialOut])
    def list_materials(session: Session = Depends(db_session)) -> list[MaterialOut]:
        materials = session.scalars(select(Material).order_by(Material.created_at, Material.id)).all()
        return [_material_response(session, material) for material in materials]

    @app.get(
        "/materials/{material_id}/sentences",
        response_model=list[SentenceOut],
    )
    def list_sentences(material_id: str, session: Session = Depends(db_session)) -> list[SentenceOut]:
        try:
            material_uuid = uuid.UUID(material_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="素材不存在") from exc
        material = session.get(Material, material_uuid)
        if material is None:
            raise HTTPException(status_code=404, detail="素材不存在")
        sentences = session.scalars(
            select(Sentence).where(Sentence.material_id == material_uuid).order_by(Sentence.index)
        ).all()
        return [_sentence_response(sentence) for sentence in sentences]

    @app.get("/materials/{material_id}/sidecar", response_model=SidecarOut)
    def get_sidecar(material_id: str, session: Session = Depends(db_session)) -> SidecarOut:
        try:
            material_uuid = uuid.UUID(material_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="sidecar 不存在") from exc
        material = session.get(Material, material_uuid)
        sidecar = session.get(Sidecar, material.current_sidecar_id) if material and material.current_sidecar_id else None
        if sidecar is None:
            raise HTTPException(status_code=404, detail="sidecar 不存在")
        return _sidecar_response(sidecar)

    @app.post(
        "/materials/{material_id}/sidecar/rebuild",
        response_model=SidecarOut,
    )
    def rebuild_sidecar(material_id: str, session: Session = Depends(db_session)) -> SidecarOut:
        """Re-derive the material's tokens as a new immutable generation.

        Re-runs with an unchanged analyzer identity return the current
        generation unchanged; a changed candidate is published with its
        complete MaterialLexemeCount set and the pointer switch in one
        transaction, so the referenced payload is never overwritten.
        """
        try:
            material_uuid = uuid.UUID(material_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="素材不存在") from exc
        try:
            retokenize_material(session, material_id=material_uuid)
        except LookupError as exc:
            session.rollback()
            raise HTTPException(status_code=404, detail="素材不存在") from exc
        except (ValueError, RuntimeError, KeyError, OSError) as exc:
            session.rollback()
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        material = session.get(Material, material_uuid)
        sidecar = (
            session.get(Sidecar, material.current_sidecar_id)
            if material and material.current_sidecar_id
            else None
        )
        if sidecar is None:
            raise HTTPException(status_code=404, detail="sidecar 不存在")
        return _sidecar_response(sidecar)

    @app.get(
        "/materials/{material_id}/lexeme-counts",
        response_model=MaterialLexemeCountsOut,
    )
    def get_material_lexeme_counts(
        material_id: str, session: Session = Depends(db_session)
    ) -> MaterialLexemeCountsOut:
        try:
            material_uuid = uuid.UUID(material_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="素材不存在") from exc
        material = session.get(Material, material_uuid)
        if material is None or material.current_sidecar_id is None:
            raise HTTPException(status_code=404, detail="素材词频尚未发布")
        rows = session.scalars(
            select(MaterialLexemeCount)
            .where(
                MaterialLexemeCount.material_id == material.id,
                MaterialLexemeCount.sidecar_id == material.current_sidecar_id,
            )
            .order_by(MaterialLexemeCount.lexeme_id)
        ).all()
        return MaterialLexemeCountsOut(
            material_id=str(material.id),
            sidecar_generation_id=str(material.current_sidecar_id),
            counts=[
                MaterialLexemeCountOut(lexeme_id=row.lexeme_id, token_count=row.token_count)
                for row in rows
            ],
        )

    # ------------------------------------------------------------------
    # P2 算法 token 视图（plan P2 第 1 条，§8.3）
    # ------------------------------------------------------------------

    @app.get("/sentences/{sentence_id}/tokens", response_model=SentenceTokensOut)
    def get_sentence_tokens(
        sentence_id: str, session: Session = Depends(db_session)
    ) -> SentenceTokensOut:
        """当前已发布 sidecar 代次的句子 token 表（算法阅读器数据面）。

        只读：token 表层/偏移/lexeme_id 来自不可变代次，响应携带完整版本
        来源；词典 provenance 按目标集一次批量查询。
        """
        try:
            sentence_uuid = uuid.UUID(sentence_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="句子不存在") from exc
        try:
            view = token_service.sentence_tokens(session, sentence_id=sentence_uuid)
        except token_service.SentenceNotFoundError as exc:
            raise HTTPException(status_code=404, detail="句子不存在") from exc
        except token_service.SidecarNotPublishedError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except token_service.PayloadIntegrityError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return SentenceTokensOut(
            sentence_id=str(view.sentence_id),
            material_id=str(view.material_id),
            sidecar_generation_id=str(view.sidecar_generation_id),
            segmenter_version=view.segmenter_version,
            tokenizer_version=view.tokenizer_version,
            analyzer_dict_version=view.analyzer_dict_version,
            dictionary_sources=[
                TokenProvenanceOut(**source) for source in view.dictionary_sources
            ],
            tokens=[
                AlgorithmTokenOut(
                    surface=token.surface,
                    normalized_form=token.normalized_form,
                    pos=token.pos,
                    reading_form=token.reading_form,
                    reading_source=token.reading_source,
                    lexeme_id=token.lexeme_id,
                    char_start=token.char_start,
                    char_end=token.char_end,
                    dictionary_source_ids=token.dictionary_source_ids,
                )
                for token in view.tokens
            ],
        )

    # ------------------------------------------------------------------
    # P2 词典（§2.0，ADR-032）：安全导入、archive hash 幂等、精确查找/FTS5
    # ------------------------------------------------------------------

    @app.post("/dictionaries/import", response_model=DictionaryImportOut, status_code=201)
    async def import_dictionary(
        response: Response,
        file: UploadFile = File(...),
        session: Session = Depends(db_session),
    ) -> DictionaryImportOut:
        """导入 Yomitan ZIP：解析与资源落盘在事务外，发布是单个短事务。

        同一 archive hash 的重复导入幂等：不重复写条目，仅记录重放运行
        （此时返回 200 而非 201）。
        """
        blob = await file.read()
        try:
            source, run, replay = dictionary_service.import_yomitan_archive(
                session, blob=blob, assets_root=app.state.assets_root
            )
        except DictionaryImportError as exc:
            session.rollback()
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except (OSError, RuntimeError, ValueError, KeyError) as exc:
            session.rollback()
            raise HTTPException(status_code=422, detail=f"词典导入失败: {exc}") from exc
        session.commit()
        if replay:
            response.status_code = 200
        return _dictionary_import_response(source, run, replay)

    @app.get("/dictionaries", response_model=list[DictionarySourceOut])
    def list_dictionaries(session: Session = Depends(db_session)) -> list[DictionarySourceOut]:
        return [
            _dictionary_source_response(source)
            for source in dictionary_service.list_sources(session)
        ]

    @app.get("/dictionaries/lookup", response_model=DictionaryLookupOut)
    def lookup_dictionary(
        expression: str,
        reading: str | None = None,
        limit: int = 50,
        session: Session = Depends(db_session),
    ) -> DictionaryLookupOut:
        """精确查找：expression 相等；带 reading 时限定该读音或空读音。

        只读路径：查词不产生 KE（§9 不变量 8），无命中返回空 entries。
        """
        entries = dictionary_service.lookup(
            session, expression=expression, reading=reading, limit=limit
        )
        return _lookup_response(expression, reading, entries, session)

    @app.get("/dictionaries/search", response_model=DictionarySearchOut)
    def search_dictionary(
        query: str,
        limit: int = 20,
        session: Session = Depends(db_session),
    ) -> DictionarySearchOut:
        """搜索框路径：精确匹配优先，FTS5 前缀匹配随后（派生投影，可重建）。"""
        try:
            entries = dictionary_service.search(session, query=query, limit=limit)
        except dictionary_service.DictionarySearchError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return _lookup_response(query, None, entries, session, wrapper="search")

    # ------------------------------------------------------------------
    # P2 Annotation（§5，ADR-030）：独立 Span 保存，不产生 KP/KE
    # ------------------------------------------------------------------

    @app.post(
        "/materials/{material_id}/annotations",
        response_model=AnnotationOut,
        status_code=201,
    )
    def create_annotation(
        material_id: str,
        payload: AnnotationCreateIn,
        session: Session = Depends(db_session),
    ) -> AnnotationOut:
        try:
            material_uuid = uuid.UUID(material_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="素材不存在") from exc
        if session.get(Material, material_uuid) is None:
            raise HTTPException(status_code=404, detail="素材不存在")
        try:
            result = annotation_service.create_annotation(
                session,
                material_id=material_uuid,
                spans=[
                    annotation_service.SpanInput(
                        sentence_id=uuid.UUID(span.sentence_id), surface=span.surface
                    )
                    for span in payload.spans
                ],
                note=payload.note,
                color=payload.color,
            )
        except annotation_service.SentenceNotFoundError as exc:
            session.rollback()
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except (annotation_service.AnnotationInputError, ValueError) as exc:
            session.rollback()
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        session.commit()
        return _annotation_response(result.annotation, result.spans)

    @app.get("/materials/{material_id}/annotations", response_model=list[AnnotationOut])
    def list_annotations(
        material_id: str,
        q: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 100,
        offset: int = 0,
        session: Session = Depends(db_session),
    ) -> list[AnnotationOut]:
        """列表检索：按文本（note/surface 子串）与时间筛选；spans 即跳回
        原文所需的定位数据。"""
        try:
            material_uuid = uuid.UUID(material_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="素材不存在") from exc
        if session.get(Material, material_uuid) is None:
            raise HTTPException(status_code=404, detail="素材不存在")
        results = annotation_service.list_annotations(
            session,
            material_id=material_uuid,
            query=q,
            since=since,
            until=until,
            limit=max(1, min(limit, 500)),
            offset=max(0, offset),
        )
        return [_annotation_response(annotation, spans) for annotation, spans in results]

    @app.delete("/annotations/{annotation_id}", status_code=204)
    def delete_annotation(annotation_id: str, session: Session = Depends(db_session)) -> None:
        """删除个人批注数据（§0.1）：移除关联行并清理不再被引用的 Span。"""
        try:
            annotation_uuid = uuid.UUID(annotation_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="划线不存在") from exc
        deleted = annotation_service.delete_annotation(session, annotation_id=annotation_uuid)
        if not deleted:
            session.rollback()
            raise HTTPException(status_code=404, detail="划线不存在")
        session.commit()

    # ------------------------------------------------------------------
    # P2 Lexeme 证据与用户裁定（§2.2/§2.5，ADR-040）
    # ------------------------------------------------------------------

    @app.post("/lexemes/{lexeme_id}/decisions", response_model=DecisionOut, status_code=201)
    def create_decision(
        response: Response,
        lexeme_id: str,
        payload: DecisionCreateIn,
        session: Session = Depends(db_session),
    ) -> DecisionOut:
        """记录 known/unknown/clear 裁定；known 与其引用的 user_asserted KE
        同事务产生。同 operation_key 同输入幂等返回（200），异输入 409。"""
        material_uuid = _optional_uuid(payload.material_id, "material_id")
        try:
            result = evidence_service.record_decision(
                session,
                lexeme_id=lexeme_id,
                decision=evidence_service.LexemeDecision(payload.decision),
                input_surface=payload.input_surface,
                input_reading=payload.input_reading,
                conjugated_form=payload.conjugated_form,
                material_id=material_uuid,
                operation_key=payload.operation_key,
                expected_decision_seq=payload.expected_decision_seq,
            )
        except evidence_service.LexemeNotFoundError as exc:
            session.rollback()
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except evidence_service.OperationConflictError as exc:
            session.rollback()
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            session.rollback()
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        session.commit()
        if not result.created:
            response.status_code = 200
        return _decision_response(result.decision, result.created)

    @app.post(
        "/known-evidence/{evidence_id}/retractions",
        response_model=RetractionOut,
        status_code=201,
    )
    def retract_evidence(
        response: Response,
        evidence_id: str,
        payload: RetractionCreateIn,
        session: Session = Depends(db_session),
    ) -> RetractionOut:
        """撤回一条 KE（误点撤回）：追加保存来源历史；若撤回的是当前 known
        引用的 KE，同事务追加该作用域 clear。同键重试返回原结果（200）。"""
        try:
            evidence_uuid = uuid.UUID(evidence_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="证据不存在") from exc
        try:
            result = evidence_service.retract_evidence(
                session, evidence_id=evidence_uuid, reason=payload.reason, operation_key=payload.operation_key
            )
        except evidence_service.EvidenceNotFoundError as exc:
            session.rollback()
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except evidence_service.OperationConflictError as exc:
            session.rollback()
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            session.rollback()
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        session.commit()
        if not result.created:
            response.status_code = 200
        return _retraction_response(result.retraction, result.appended_clear, result.created)

    @app.get("/lexemes/{lexeme_id}/evidence", response_model=EvidenceListOut)
    def list_evidence(
        lexeme_id: str,
        limit: int = 100,
        offset: int = 0,
        session: Session = Depends(db_session),
    ) -> EvidenceListOut:
        """原始证据分页读取（§2.5）；撤回标记一并返回。"""
        if session.get(Lexeme, lexeme_id) is None:
            raise HTTPException(status_code=404, detail="词元不存在")
        rows = evidence_service.evidence_rows(
            session, lexeme_id=lexeme_id, limit=max(1, min(limit, 500)), offset=max(0, offset)
        )
        return EvidenceListOut(
            lexeme_id=lexeme_id,
            items=[
                _evidence_item_response(evidence, retraction_id)
                for evidence, retraction_id in rows
            ],
        )

    @app.get("/lexemes/{lexeme_id}/evidence-summary", response_model=EvidenceSummaryOut)
    def get_evidence_summary(
        lexeme_id: str, session: Session = Depends(db_session)
    ) -> EvidenceSummaryOut:
        """按词证据摘要（投影与写事务同步更新；写后读一致）。"""
        if session.get(Lexeme, lexeme_id) is None:
            raise HTTPException(status_code=404, detail="词元不存在")
        summaries = evidence_service.scope_summaries(session, lexeme_id)
        return EvidenceSummaryOut(
            lexeme_id=lexeme_id,
            projection_revision=evidence_service.projection_revision(session),
            scopes=[_summary_scope_response(summary) for summary in summaries],
        )

    @app.post("/lexemes/known-views/batch", response_model=KnownViewsBatchOut)
    def batch_known_views(
        payload: KnownViewsBatchIn, session: Session = Depends(db_session)
    ) -> KnownViewsBatchOut:
        """阅读器目标集合批量读取（§11.1）：一次请求返回每个目标的作用域
        摘要与有效已知状态组合。unknown 压过导入；clear 回退其他来源。"""
        if len(payload.items) > 500:
            raise HTTPException(status_code=422, detail="批量目标集合超过 500 项上限")
        for item in payload.items:
            if item.form is not None and not item.form:
                raise HTTPException(status_code=422, detail="空具体词形不能派生词形作用域键")
        items = [
            evidence_service.compose_known_view(session, lexeme_id=item.lexeme_id, form=item.form)
            for item in payload.items
        ]
        return KnownViewsBatchOut(
            known_rule_version=evidence_service.KNOWN_RULE_VERSION,
            items=[
                KnownViewItemOut(
                    lexeme_id=item["lexeme_id"],
                    form=item["form"],
                    lexeme_scope=_summary_scope_value(item["lexeme_scope"]),
                    form_scope=_summary_scope_value(item["form_scope"]),
                    effective=EffectiveKnownOut(**item["effective"]),
                )
                for item in items
            ],
        )

    return app


def _sidecar_response(sidecar: Sidecar) -> SidecarOut:
    return SidecarOut(
        material_id=str(sidecar.material_id),
        sidecar_generation_id=str(sidecar.id),
        content_hash=sidecar.content_hash,
        segmenter_version=sidecar.segmenter_version,
        tokenizer_version=sidecar.tokenizer_version,
        analyzer_dict_version=sidecar.analyzer_dict_version,
        payload=msgpack.unpackb(sidecar.payload, raw=False),
    )


def _material_response(session: Session, material: Material) -> MaterialOut:
    sentence_count = session.scalar(
        select(func.count()).select_from(Sentence).where(Sentence.material_id == material.id)
    ) or 0
    return MaterialOut(
        id=str(material.id),
        title=material.title,
        content_hash=material.content_hash,
        locator=material.locator,
        kind=material.kind.value,
        copy_stored=material.copy_stored,
        storage_mode=material.storage_mode.value,
        source_sha256=material.source_sha256,
        current_sidecar_id=str(material.current_sidecar_id) if material.current_sidecar_id else None,
        sentence_count=sentence_count,
    )


def _sentence_response(sentence: Sentence) -> SentenceOut:
    return SentenceOut(
        id=str(sentence.id),
        material_id=str(sentence.material_id),
        index=sentence.index,
        text=sentence.text,
        time_start=sentence.time_start,
        time_end=sentence.time_end,
        translation=sentence.translation,
        anchor_type=sentence.anchor_type.value,
        anchor_payload=sentence.anchor_payload,
    )


# ---------------------------------------------------------------------------
# P2 响应装配辅助
# ---------------------------------------------------------------------------


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        return value.isoformat() + "Z"
    return value.isoformat()


def _optional_uuid(value: str | None, field: str) -> uuid.UUID | None:
    if value is None:
        return None
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{field} 不是有效 UUID") from exc


def _dictionary_source_response(source) -> DictionarySourceOut:  # noqa: ANN001
    return DictionarySourceOut(
        id=str(source.id),
        format=source.format.value,
        display_name=source.display_name,
        source_version=source.source_version,
        schema_version=source.schema_version,
        archive_hash=source.archive_hash,
        license_metadata=source.license_metadata,
        imported_at=_iso(source.imported_at),
    )


def _dictionary_import_response(source, run, replay: bool) -> DictionaryImportOut:  # noqa: ANN001
    return DictionaryImportOut(
        source=_dictionary_source_response(source),
        run_id=str(run.id),
        status=run.status.value,
        stats=run.stats or {},
        idempotent_replay=replay,
    )


def _lookup_response(
    expression: str,
    reading: str | None,
    entries: list,
    session: Session,
    wrapper: str = "lookup",
):  # noqa: ANN201
    definitions_by_entry = dictionary_service.definitions_for_entries(
        session, [entry.id for entry in entries]
    )
    sources = dictionary_service.entry_sources(
        session, list({entry.source_id for entry in entries})
    )

    def entry_response(entry) -> LookupEntryOut:  # noqa: ANN001
        source = sources[entry.source_id]
        return LookupEntryOut(
            source_id=str(entry.source_id),
            display_name=source.display_name,
            source_version=source.source_version,
            source_local_id=entry.source_local_id,
            expression=entry.expression,
            reading=entry.reading,
            tags=list(entry.tags),
            score=entry.score,
            sequence=entry.sequence,
            definitions=[
                DictionaryDefinitionOut(
                    ordinal=definition.ordinal,
                    plain_text=definition.plain_text,
                    structured_content=definition.structured_content,
                )
                for definition in definitions_by_entry.get(entry.id, [])
            ],
        )

    if wrapper == "search":
        return DictionarySearchOut(query=expression, entries=[entry_response(entry) for entry in entries])
    return DictionaryLookupOut(
        expression=expression, reading=reading, entries=[entry_response(entry) for entry in entries]
    )


def _annotation_response(annotation, spans) -> AnnotationOut:  # noqa: ANN001
    return AnnotationOut(
        id=str(annotation.id),
        material_id=str(annotation.material_id),
        note=annotation.note,
        color=annotation.color,
        created_at=_iso(annotation.created_at),
        spans=[
            AnnotationSpanOut(
                span_id=str(span.span_id),
                sentence_id=str(span.sentence_id),
                surface=span.surface,
                char_start=span.char_start,
                char_end=span.char_end,
                token_start=span.token_start,
                token_end=span.token_end,
                alignment_status=span.alignment_status.value,
                alignment_sidecar_id=str(span.alignment_sidecar_id)
                if span.alignment_sidecar_id
                else None,
            )
            for span in spans
        ],
    )


def _decision_response(decision: LexemeKnowledgeDecision, created: bool) -> DecisionOut:
    return DecisionOut(
        decision_id=str(decision.id),
        lexeme_id=decision.lexeme_id,
        conjugated_form=decision.conjugated_form,
        scope_form_key=decision.scope_form_key,
        decision=decision.decision.value,
        decision_seq=decision.decision_seq,
        evidence_id=str(decision.evidence_id) if decision.evidence_id else None,
        operation_key=decision.operation_key,
        created_at=_iso(decision.created_at),
        created=created,
    )


def _retraction_response(retraction, appended_clear: bool, created: bool) -> RetractionOut:  # noqa: ANN001
    return RetractionOut(
        retraction_id=str(retraction.id),
        evidence_id=str(retraction.evidence_id),
        reason=retraction.reason,
        operation_key=retraction.operation_key,
        appended_clear=appended_clear,
        created=created,
        created_at=_iso(retraction.created_at),
    )


def _evidence_item_response(evidence: KnownEvidence, retraction_id: uuid.UUID | None) -> EvidenceItemOut:
    return EvidenceItemOut(
        evidence_id=str(evidence.id),
        source=evidence.source.value,
        confidence=evidence.confidence,
        observed_at=_iso(evidence.observed_at),
        observed_at_basis=evidence.observed_at_basis.value,
        analyzer_dict_version=evidence.analyzer_dict_version,
        resolver_version=evidence.resolver_version,
        conjugated_form=evidence.conjugated_form,
        scope_form_key=evidence.scope_form_key,
        input_surface=evidence.input_surface,
        input_reading=evidence.input_reading,
        material_id=str(evidence.material_id) if evidence.material_id else None,
        retracted=retraction_id is not None,
        retraction_id=str(retraction_id) if retraction_id else None,
    )


def _summary_scope_response(summary: LexemeEvidenceSummary) -> EvidenceSummaryScopeOut:
    return EvidenceSummaryScopeOut(
        scope_form_key=summary.scope_form_key,
        current_decision=summary.current_decision.value if summary.current_decision else None,
        current_decision_seq=summary.current_decision_seq,
        current_decision_id=str(summary.current_decision_id) if summary.current_decision_id else None,
        known_evidence_id=str(summary.known_evidence_id) if summary.known_evidence_id else None,
        valid_source_counts={
            key: int(value) for key, value in (summary.valid_source_counts or {}).items()
        },
        input_revision=summary.input_revision,
        known_rule_version=summary.known_rule_version,
        resolver_version=summary.resolver_version,
    )


def _summary_scope_value(payload: dict | None) -> EvidenceSummaryScopeOut | None:  # noqa: ANN001
    if payload is None:
        return None
    return EvidenceSummaryScopeOut(**payload)
