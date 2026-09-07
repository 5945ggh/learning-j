"""FastAPI 应用与路由（ADR-020）。

P0 只要求 app 可实例化；业务端点在 P1–P5 按阶段补齐。
"""

from __future__ import annotations

import uuid

import msgpack
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from learningj.db.session import make_engine, make_session_factory
from learningj.db.models.material import Material, Sentence, Sidecar
from learningj.ingest.service import import_material


def create_app(db_url: str = "sqlite:///./learningj.db") -> FastAPI:
    """构造 FastAPI 应用。

    引擎在应用创建时绑定；P0 阶段没有端点，仅保证生命周期装配正确。
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

    @app.post("/materials", status_code=201)
    async def create_material(
        file: UploadFile = File(...),
        title: str | None = Form(default=None),
        locator: str | None = Form(default=None),
        session: Session = Depends(db_session),
    ) -> dict:
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
            )
        except (ValueError, RuntimeError, KeyError, OSError) as exc:
            session.rollback()
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return _material_response(session, material)

    @app.get("/materials")
    def list_materials(session: Session = Depends(db_session)) -> list[dict]:
        materials = session.scalars(select(Material).order_by(Material.created_at, Material.id)).all()
        return [_material_response(session, material) for material in materials]

    @app.get("/materials/{material_id}/sentences")
    def list_sentences(material_id: str, session: Session = Depends(db_session)) -> list[dict]:
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

    @app.get("/materials/{material_id}/sidecar")
    def get_sidecar(material_id: str, session: Session = Depends(db_session)) -> dict:
        try:
            material_uuid = uuid.UUID(material_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="sidecar 不存在") from exc
        sidecar = session.scalar(
            select(Sidecar).where(Sidecar.material_id == material_uuid).order_by(Sidecar.created_at.desc())
        )
        if sidecar is None:
            raise HTTPException(status_code=404, detail="sidecar 不存在")
        return {
            "material_id": str(sidecar.material_id),
            "content_hash": sidecar.content_hash,
            "segmenter_version": sidecar.segmenter_version,
            "tokenizer_version": sidecar.tokenizer_version,
            "analyzer_dict_version": sidecar.analyzer_dict_version,
            "payload": msgpack.unpackb(sidecar.payload, raw=False),
        }

    return app


def _material_response(session: Session, material: Material) -> dict:
    sentence_count = session.scalar(
        select(func.count()).select_from(Sentence).where(Sentence.material_id == material.id)
    ) or 0
    return {
        "id": str(material.id),
        "title": material.title,
        "content_hash": material.content_hash,
        "locator": material.locator,
        "kind": material.kind.value,
        "copy_stored": material.copy_stored,
        "sentence_count": sentence_count,
    }


def _sentence_response(sentence: Sentence) -> dict:
    return {
        "id": str(sentence.id),
        "material_id": str(sentence.material_id),
        "index": sentence.index,
        "text": sentence.text,
        "time_start": sentence.time_start,
        "time_end": sentence.time_end,
        "translation": sentence.translation,
        "anchor_type": sentence.anchor_type.value,
        "anchor_payload": sentence.anchor_payload,
    }
