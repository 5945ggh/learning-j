from __future__ import annotations

import io
import zipfile

from sqlalchemy import select
from sqlalchemy.orm import Session

from learningj.db.models.material import Material, Sentence
from learningj.domain.enums import MaterialStorageMode
from learningj.ingest.epub import _safe_href
from learningj.ingest.service import import_material


def _epub(*, chapter_href: str, chapter_member: str, chapter_text: str = "同じ本文です。") -> bytes:
    container = """<container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'><rootfiles><rootfile full-path='OEBPS/package.opf'/></rootfiles></container>"""
    opf = f"""<package xmlns='http://www.idpf.org/2007/opf'><manifest><item id='chapter' href='{chapter_href}' media-type='application/xhtml+xml'/></manifest><spine><itemref idref='chapter'/></spine></package>"""
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w") as archive:
        archive.writestr("META-INF/container.xml", container)
        archive.writestr("OEBPS/package.opf", opf)
        archive.writestr(chapter_member, f"<html><body><p>{chapter_text}</p></body></html>")
    return result.getvalue()


def test_epubs_with_same_canonical_text_but_different_source_sha_are_distinct(migrated_engine):
    first_blob = _epub(chapter_href="first.xhtml", chapter_member="OEBPS/first.xhtml")
    second_blob = _epub(chapter_href="second.xhtml", chapter_member="OEBPS/second.xhtml")

    with Session(migrated_engine) as session:
        first = import_material(
            session,
            filename="first.epub",
            blob=first_blob,
            storage_mode=MaterialStorageMode.MANAGED_COPY,
            prepare_sidecar=False,
        )
        second = import_material(
            session,
            filename="second.epub",
            blob=second_blob,
            storage_mode=MaterialStorageMode.MANAGED_COPY,
            prepare_sidecar=False,
        )

        assert first.content_hash == second.content_hash
        assert first.source_sha256 != second.source_sha256
        assert first.id != second.id
        assert first.publication_manifest != second.publication_manifest
        assert session.scalars(select(Sentence).where(Sentence.material_id == first.id)).all()
        assert session.scalars(select(Sentence).where(Sentence.material_id == second.id)).all()
        assert len(session.scalars(select(Material).where(Material.kind == first.kind)).all()) == 2


def test_percent_encoded_spine_href_imports_from_compiled_source_spine(migrated_engine):
    blob = _epub(
        chapter_href="chapters/%E7%AC%AC%E4%B8%80%E7%AB%A0.xhtml",
        chapter_member="OEBPS/chapters/第一章.xhtml",
        chapter_text="符号化された章です。",
    )

    with Session(migrated_engine) as session:
        material = import_material(
            session,
            filename="encoded.epub",
            blob=blob,
            storage_mode=MaterialStorageMode.MANAGED_COPY,
            prepare_sidecar=False,
        )
        sentence = session.scalar(select(Sentence).where(Sentence.material_id == material.id))

        assert sentence is not None
        assert sentence.text == "符号化された章です。"
        assert sentence.anchor_payload == {"spine_index": 0, "char_start": 0, "char_end": 10}
        assert material.publication_manifest is not None
        assert material.publication_manifest["source_spine"][0]["member_path"] == "OEBPS/chapters/第一章.xhtml"


def test_percent_encoded_reserved_characters_stay_in_href_path(migrated_engine):
    cases = [
        ("chap%23one.xhtml", "OEBPS/chap#one.xhtml"),
        ("chap%3Fone.xhtml", "OEBPS/chap?one.xhtml"),
    ]

    with Session(migrated_engine) as session:
        for index, (href, member) in enumerate(cases):
            material = import_material(
                session,
                filename=f"reserved-{index}.epub",
                blob=_epub(
                    chapter_href=href,
                    chapter_member=member,
                    chapter_text=f"保留文字 {index}",
                ),
                storage_mode=MaterialStorageMode.MANAGED_COPY,
                prepare_sidecar=False,
            )

            assert material.publication_manifest is not None
            assert material.publication_manifest["source_spine"][0]["member_path"] == member

    assert _safe_href("OEBPS/chapter.xhtml", "other.xhtml#section") == (
        "OEBPS/other.xhtml",
        "section",
    )
