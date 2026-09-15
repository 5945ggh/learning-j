from __future__ import annotations

import io
import uuid
import zipfile

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from learningj.api.app import create_app
from learningj.db.base import Base
from learningj.db.models.invariant_triggers import install_invariant_triggers
from learningj.db.models.material import Material
from learningj.db.session import make_engine
from learningj.ingest.epub import compile_epub, project_epub_xhtml


def _book(*, unsafe: bool = False) -> bytes:
    container = """<?xml version='1.0'?><container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'><rootfiles><rootfile full-path='OEBPS/package.opf'/></rootfiles></container>"""
    opf = """<?xml version='1.0'?><package xmlns='http://www.idpf.org/2007/opf'><metadata><dc:title xmlns:dc='http://purl.org/dc/elements/1.1/'>受控テスト</dc:title><dc:creator xmlns:dc='http://purl.org/dc/elements/1.1/'>テスト作者</dc:creator></metadata><manifest><item id='one' href='one.xhtml' media-type='application/xhtml+xml'/><item id='two' href='two.xhtml' media-type='application/xhtml+xml'/><item id='cover' href='images/cover.png' media-type='image/png'/></manifest><spine><itemref idref='one'/><itemref idref='two'/></spine></package>"""
    script = "<script>window.__publicationScript = true</script>" if unsafe else ""
    chapter_one = f"<html><head>{script}<style>body{{display:none}}</style></head><body><p><ruby><rb>𠮟</rb><rt>しか</rt></ruby>られた。</p><p><a href='two.xhtml'>次へ</a><img src='images/cover.png'/><img src='https://example.com/remote.png'/></p><p>literal __LJ_RESOURCE_r1__ __LJ_DISABLED_LINK__ __LJ_CHAPTER_2__</p></body></html>"
    chapter_two = "<html><body><h2>第二章</h2><p>次です！</p></body></html>"
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("META-INF/container.xml", container)
        archive.writestr("OEBPS/package.opf", opf)
        archive.writestr("OEBPS/one.xhtml", chapter_one)
        archive.writestr("OEBPS/two.xhtml", chapter_two)
        archive.writestr("OEBPS/images/cover.png", b"PNG")
    return output.getvalue()


def _client(tmp_path):
    db_path = tmp_path / "reader.db"
    engine = make_engine(db_path)
    Base.metadata.create_all(engine)
    install_invariant_triggers(engine)
    return TestClient(create_app(f"sqlite:///{db_path}", assets_root=tmp_path / "assets"))


def _book_with_cover_spine() -> bytes:
    container = "<container><rootfiles><rootfile full-path='OEBPS/package.opf'/></rootfiles></container>"
    opf = """<package xmlns='http://www.idpf.org/2007/opf'><metadata><title>封面测试</title></metadata><manifest><item id='cover' href='cover.xhtml' media-type='application/xhtml+xml' properties='cover'/><item id='body' href='body.xhtml' media-type='application/xhtml+xml'/><item id='image' href='images/cover.jpg' media-type='image/jpeg'/></manifest><spine><itemref idref='cover'/><itemref idref='body'/></spine></package>"""
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("META-INF/container.xml", container)
        archive.writestr("OEBPS/package.opf", opf)
        archive.writestr("OEBPS/cover.xhtml", "<html><body><img src='images/cover.jpg'/></body></html>")
        archive.writestr("OEBPS/body.xhtml", "<html><body><h1>正文</h1><p>第一章。</p></body></html>")
        archive.writestr("OEBPS/images/cover.jpg", b"JPEG-COVER")
    return output.getvalue()


def _book_with_cover_image_property() -> bytes:
    container = "<container><rootfiles><rootfile full-path='OEBPS/package.opf'/></rootfiles></container>"
    opf = """<package xmlns='http://www.idpf.org/2007/opf'><metadata><title>封面属性测试</title></metadata><manifest><item id='cover-page' href='cover.xhtml' media-type='application/xhtml+xml'/><item id='body' href='body.xhtml' media-type='application/xhtml+xml'/><item id='cover-image' href='images/cover.jpg' media-type='image/jpeg' properties='cover-image'/></manifest><spine><itemref idref='cover-page'/><itemref idref='body'/></spine></package>"""
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("META-INF/container.xml", container)
        archive.writestr("OEBPS/package.opf", opf)
        archive.writestr("OEBPS/cover.xhtml", "<html><body><div><img src='images/cover.jpg'/></div></body></html>")
        archive.writestr("OEBPS/body.xhtml", "<html><body><p>正文。</p></body></html>")
        archive.writestr("OEBPS/images/cover.jpg", b"JPEG-COVER-PROPERTY")
    return output.getvalue()


def test_managed_epub_is_reader_ready_before_sidecar_and_serves_controlled_http(tmp_path):
    client = _client(tmp_path)
    created = client.post(
        "/materials",
        data={"storage_mode": "managed_copy"},
        files={"file": ("book.epub", _book(unsafe=True), "application/epub+zip")},
    )
    assert created.status_code == 201, created.text
    material = created.json()
    assert material["kind"] == "epub"
    assert material["title"] == "受控テスト"
    assert material["author"] == "テスト作者"
    assert material["copy_stored"] is True
    assert material["current_sidecar_id"] is None

    publication = client.get(f"/materials/{material['id']}/publication")
    assert publication.status_code == 200
    assert [chapter["label"] for chapter in publication.json()["spine"]] == ["章节 1", "章节 2"]

    chapter = client.get(f"/materials/{material['id']}/publication/spine/0")
    assert chapter.status_code == 200
    assert chapter.headers["content-security-policy"].startswith("default-src 'none'")
    assert "script" not in chapter.text
    assert "window.__publicationScript" not in chapter.text
    assert "https://example.com" not in chapter.text
    assert "data-learningj-publication=\"1\"" in chapter.text
    assert f"/materials/{material['id']}/publication/resources/r1" in chapter.text
    assert 'data-learningj-cross-chapter-link="true"' in chapter.text
    assert 'aria-disabled="true"' in chapter.text
    assert 'tabindex="-1"' in chapter.text

    resource = client.get(f"/materials/{material['id']}/publication/resources/r1")
    assert resource.status_code == 200
    assert resource.headers["content-type"].startswith("image/png")
    assert resource.content == b"PNG"

    assert client.get(f"/materials/{material['id']}/publication/spine/1").status_code == 200
    assert client.get(f"/materials/{material['id']}/publication/spine/2").status_code == 404


def test_served_publication_rewrites_only_url_attributes(tmp_path):
    client = _client(tmp_path)
    blob = _book()
    created = client.post(
        "/materials",
        data={"storage_mode": "managed_copy"},
        files={"file": ("book.epub", blob, "application/epub+zip")},
    )
    assert created.status_code == 201, created.text
    material_id = created.json()["id"]

    served = client.get(f"/materials/{material_id}/publication/spine/0")
    assert served.status_code == 200
    assert "literal __LJ_RESOURCE_r1__" in served.text
    assert "__LJ_DISABLED_LINK__" in served.text
    assert "__LJ_CHAPTER_2__" in served.text
    assert f"/materials/{material_id}/publication/resources/r1" in served.text
    assert f"/materials/{material_id}/publication/spine/1" in served.text

    publication = compile_epub(blob, "book.epub")
    assert project_epub_xhtml(served.text)[0] == publication.spine[0].canonical_text


def test_publication_reads_cache_full_source_validation_until_file_identity_changes(tmp_path, monkeypatch):
    client = _client(tmp_path)
    created = client.post(
        "/materials",
        data={"storage_mode": "managed_copy"},
        files={"file": ("book.epub", _book(), "application/epub+zip")},
    )
    assert created.status_code == 201
    material = created.json()

    # A fresh application process has no warm cache.  The first read validates
    # checksum + every ZIP member; its sibling endpoints reuse that result.
    db_path = tmp_path / "reader.db"
    reader = TestClient(create_app(f"sqlite:///{db_path}", assets_root=tmp_path / "assets"))
    calls = 0
    original_testzip = zipfile.ZipFile.testzip

    def counted_testzip(archive):
        nonlocal calls
        calls += 1
        return original_testzip(archive)

    monkeypatch.setattr(zipfile.ZipFile, "testzip", counted_testzip)
    assert reader.get(f"/materials/{material['id']}/publication").status_code == 200
    assert reader.get(f"/materials/{material['id']}/publication/spine/0").status_code == 200
    assert reader.get(f"/materials/{material['id']}/publication/resources/r1").status_code == 200
    assert calls == 1

    # A changed stat identity makes the source cheap-cache entry ineligible.
    (tmp_path / "assets" / material["locator"]).touch()
    assert reader.get(f"/materials/{material['id']}/publication").status_code == 200
    assert calls == 2


def test_managed_epub_rejects_path_traversal_before_import(tmp_path):
    client = _client(tmp_path)
    container = "<container><rootfiles><rootfile full-path='../package.opf'/></rootfiles></container>"
    broken = io.BytesIO()
    with zipfile.ZipFile(broken, "w") as archive:
        archive.writestr("META-INF/container.xml", container)
    response = client.post(
        "/materials",
        data={"storage_mode": "managed_copy"},
        files={"file": ("broken.epub", broken.getvalue(), "application/epub+zip")},
    )
    assert response.status_code == 422
    assert "路径" in response.json()["detail"] or "rootfile" in response.json()["detail"]


def test_sidecar_rebuild_projects_ruby_from_reader_manifest(tmp_path):
    client = _client(tmp_path)
    created = client.post(
        "/materials",
        data={"storage_mode": "managed_copy"},
        files={"file": ("book.epub", _book(), "application/epub+zip")},
    )
    assert created.status_code == 201
    material = created.json()
    assert material["current_sidecar_id"] is None

    rebuilt = client.post(f"/materials/{material['id']}/sidecar/rebuild")
    assert rebuilt.status_code == 200, rebuilt.text
    assert rebuilt.json()["payload"]["sentences"][0]["ruby_hints"]


def test_image_splash_and_following_body_share_one_toc_chapter():
    container = """<container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'><rootfiles><rootfile full-path='OEBPS/package.opf'/></rootfiles></container>"""
    opf = """<package xmlns='http://www.idpf.org/2007/opf'><metadata><dc:title xmlns:dc='http://purl.org/dc/elements/1.1/'>画像章</dc:title></metadata><manifest><item id='splash' href='Text/splash.xhtml' media-type='application/xhtml+xml'/><item id='body' href='Text/body.xhtml' media-type='application/xhtml+xml'/><item id='nav' href='nav.xhtml' media-type='application/xhtml+xml' properties='nav'/><item id='image' href='Images/splash.jpg' media-type='image/jpeg'/></manifest><spine><itemref idref='splash'/><itemref idref='body'/></spine></package>"""
    nav = """<html xmlns='http://www.w3.org/1999/xhtml' xmlns:epub='http://www.idpf.org/2007/ops'><body><nav epub:type='toc'><ol><li><a href='Text/splash.xhtml'>第一章</a></li></ol></nav></body></html>"""
    splash = "<html><body><p><img src='../Images/splash.jpg' alt='第一章'/></p></body></html>"
    body = "<html><body><p>本文が続く。</p></body></html>"
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("META-INF/container.xml", container)
        archive.writestr("OEBPS/package.opf", opf)
        archive.writestr("OEBPS/nav.xhtml", nav)
        archive.writestr("OEBPS/Text/splash.xhtml", splash)
        archive.writestr("OEBPS/Text/body.xhtml", body)
        archive.writestr("OEBPS/Images/splash.jpg", b"JPEG")

    publication = compile_epub(output.getvalue(), "grouped.epub")
    assert len(publication.source_spine) == 2
    assert len(publication.spine) == 1
    assert publication.spine[0].source_indices == (0, 1)
    assert publication.spine[0].label == "第一章"
    assert publication.spine[0].controlled_html.count("<img") == 1
    assert "本文が続く" in publication.spine[0].controlled_html


def test_cover_is_exposed_as_cover_resource_and_not_reader_chapter(tmp_path):
    blob = _book_with_cover_spine()
    publication = compile_epub(blob, "cover.epub")
    assert publication.cover_resource_id == "r1"
    assert [chapter.label for chapter in publication.spine] == ["章节 2"]
    assert publication.spine[0].source_indices == (1,)

    client = _client(tmp_path)
    created = client.post(
        "/materials",
        data={"storage_mode": "managed_copy"},
        files={"file": ("cover.epub", blob, "application/epub+zip")},
    )
    assert created.status_code == 201, created.text
    material_id = created.json()["id"]
    publication_response = client.get(f"/materials/{material_id}/publication")
    assert publication_response.status_code == 200
    assert [chapter["label"] for chapter in publication_response.json()["spine"]] == ["章节 2"]

    cover = client.get(f"/materials/{material_id}/publication/cover")
    assert cover.status_code == 200
    assert cover.headers["content-type"].startswith("image/jpeg")
    assert cover.content == b"JPEG-COVER"

    chapter = client.get(f"/materials/{material_id}/publication/spine/0")
    assert chapter.status_code == 200
    assert "正文" in chapter.text
    assert "JPEG-COVER" not in chapter.text


def test_cover_image_manifest_property_excludes_unmarked_cover_page():
    publication = compile_epub(_book_with_cover_image_property(), "cover-property.epub")

    assert publication.cover_resource_id == "r1"
    assert [chapter.label for chapter in publication.spine] == ["章节 2"]
    assert publication.spine[0].source_indices == (1,)


def test_resource_endpoint_rechecks_positive_raster_allowlist(tmp_path):
    client = _client(tmp_path)
    created = client.post(
        "/materials",
        data={"storage_mode": "managed_copy"},
        files={"file": ("book.epub", _book(), "application/epub+zip")},
    )
    assert created.status_code == 201
    material_id = created.json()["id"]

    # A persisted manifest is an input boundary too.  Even if an old or
    # manually edited row carries a parameterized SVG MIME, the resource route
    # must not fall back to the historic ``image/*`` prefix check.
    with Session(client.app.state.engine) as session:  # type: ignore[attr-defined]
        material = session.get(Material, uuid.UUID(material_id))
        assert material is not None and material.publication_manifest is not None
        manifest = dict(material.publication_manifest)
        manifest["resources"] = [
            {
                "resource_id": "evil-svg",
                "member_path": "OEBPS/images/cover.png",
                "media_type": "image/svg+xml;charset=utf-8",
            }
        ]
        material.publication_manifest = manifest
        session.commit()

    response = client.get(f"/materials/{material_id}/publication/resources/evil-svg")
    assert response.status_code == 404
