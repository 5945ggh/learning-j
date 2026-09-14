from __future__ import annotations

import io
import zipfile

from fastapi.testclient import TestClient

from learningj.api.app import create_app
from learningj.db.base import Base
from learningj.db.models.invariant_triggers import install_invariant_triggers
from learningj.db.session import make_engine
from learningj.ingest.epub import compile_epub


def _book(*, unsafe: bool = False) -> bytes:
    container = """<?xml version='1.0'?><container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'><rootfiles><rootfile full-path='OEBPS/package.opf'/></rootfiles></container>"""
    opf = """<?xml version='1.0'?><package xmlns='http://www.idpf.org/2007/opf'><metadata><dc:title xmlns:dc='http://purl.org/dc/elements/1.1/'>受控テスト</dc:title></metadata><manifest><item id='one' href='one.xhtml' media-type='application/xhtml+xml'/><item id='two' href='two.xhtml' media-type='application/xhtml+xml'/><item id='cover' href='images/cover.png' media-type='image/png'/></manifest><spine><itemref idref='one'/><itemref idref='two'/></spine></package>"""
    script = "<script>window.__publicationScript = true</script>" if unsafe else ""
    chapter_one = f"<html><head>{script}<style>body{{display:none}}</style></head><body><p><ruby><rb>𠮟</rb><rt>しか</rt></ruby>られた。</p><p><img src='images/cover.png'/><img src='https://example.com/remote.png'/></p></body></html>"
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

    resource = client.get(f"/materials/{material['id']}/publication/resources/r1")
    assert resource.status_code == 200
    assert resource.headers["content-type"].startswith("image/png")
    assert resource.content == b"PNG"

    assert client.get(f"/materials/{material['id']}/publication/spine/1").status_code == 200
    assert client.get(f"/materials/{material['id']}/publication/spine/2").status_code == 404


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
