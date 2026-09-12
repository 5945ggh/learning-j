"""FastAPI 应用与路由（ADR-020）。

P0 交付素材端点（materials/sentences/sidecar），响应统一经
`learningj.api.schemas` 的 Pydantic 模型暴露（OpenAPI 可生成）。
P0 不存在任何 Analysis/StudySession/KP 端点；业务端点在 P1–P5 按阶段补齐。
"""

from __future__ import annotations

import uuid

import msgpack
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from learningj.api.schemas import (
    MaterialLexemeCountOut,
    MaterialLexemeCountsOut,
    MaterialOut,
    SentenceOut,
    SidecarOut,
)
from learningj.db.session import make_engine, make_session_factory
from learningj.db.models.material import Material, MaterialLexemeCount, Sentence, Sidecar
from learningj.domain.enums import MaterialStorageMode
from learningj.ingest.service import import_material, retokenize_material


def create_app(db_url: str = "sqlite:///./learningj.db") -> FastAPI:
    """构造 FastAPI 应用。

    引擎在应用创建时绑定；P0 只交付素材链路端点。
    """
    engine = make_engine(db_url)
    session_factory = make_session_factory(engine)

    app = FastAPI(
        title="LearningJ API",
        version="0.1.0",
        description="Local backend for LearningJ (ADR-020).",
    )
    app.state.engine = engine
    app.state.session_factory = session_factory

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
