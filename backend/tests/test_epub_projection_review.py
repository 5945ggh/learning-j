from __future__ import annotations

import io
import zipfile

import pytest

from learningj.ingest.epub import (
    EPUB_PROJECTION_VERSION,
    EpubPublicationError,
    compile_epub,
    project_epub_xhtml,
)
from learningj.ingest.service import parse_source


def _epub(*, chapters: list[str], images: dict[str, tuple[str, bytes]] | None = None, opf_padding: str = "") -> bytes:
    images = images or {}
    container = "<container><rootfiles><rootfile full-path='OEBPS/package.opf'/></rootfiles></container>"
    items = [
        f"<item id='c{index}' href='c{index}.xhtml' media-type='application/xhtml+xml'/>"
        for index in range(len(chapters))
    ]
    items.extend(
        f"<item id='i{index}' href='{path}' media-type='{media_type}'/>"
        for index, (path, (media_type, _data)) in enumerate(images.items())
    )
    spine = "".join(f"<itemref idref='c{index}'/>" for index in range(len(chapters)))
    opf = (
        f"{opf_padding}<package><metadata><title>projection</title></metadata>"
        f"<manifest>{''.join(items)}</manifest><spine>{spine}</spine></package>"
    )
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("META-INF/container.xml", container)
        archive.writestr("OEBPS/package.opf", opf)
        for index, chapter in enumerate(chapters):
            archive.writestr(f"OEBPS/c{index}.xhtml", chapter)
        for path, (_media_type, data) in images.items():
            archive.writestr(f"OEBPS/{path}", data)
    return output.getvalue()


def test_controlled_svg_raster_and_text_share_the_v3_projection():
    source = """<html><body><p>前</p><svg><text>SVG 内的秘密文字</text><image href='photo.jpg'/></svg><section>後<ruby>漢<rt>かん</rt><rp>(</rp><rt>じ</rt><rp>)</rp></ruby></section></body></html>"""
    blob = _epub(
            chapters=[source],
            images={
                "photo.jpg": (" image/jpeg ; charset=binary ", b"jpeg"),
                "vector.svg": ("image/svg+xml; charset=utf-8", b"<svg/>"),
                "mystery.bin": ("image/x-unknown", b"unknown"),
            },
        )
    publication = compile_epub(blob)

    chapter = publication.spine[0]
    controlled_text, controlled_hints = project_epub_xhtml(chapter.controlled_html)
    assert publication.projection_version == EPUB_PROJECTION_VERSION == "learningj-epub-publication-v4"
    assert controlled_text == chapter.canonical_text
    assert "SVG 内的秘密文字" not in controlled_text
    assert controlled_text == "前\n\n後漢\n"
    assert controlled_hints[0]["base_text"] == "漢"
    assert controlled_hints[0]["reading"] == "かんじ"
    assert [resource.media_type for resource in publication.resources] == ["image/jpeg"]
    assert "SVG 内的秘密文字" not in chapter.controlled_html
    assert chapter.controlled_html.count("<img") == 1
    _kind, _sentences, service_text = parse_source("projection.epub", blob, publication=publication)
    assert service_text == chapter.canonical_text


def test_grouped_section_wrappers_preserve_source_spine_boundaries():
    publication = compile_epub(
        _epub(chapters=["<html><body><section>甲</section></body></html>", "<html><body><section>乙</section></body></html>"])
    )
    # Ordinary source documents remain separate chapters, but each compiler
    # wrapper is projection-neutral; use a direct controlled wrapper fixture
    # to protect the grouping representation's explicit LF contract.
    wrapped = (
        '<section data-learningj-source-spine-index="0"><section>甲</section></section>'
        '<br data-learningj-source-boundary="true">'
        '<section data-learningj-source-spine-index="1"><section>乙</section></section>'
    )
    assert publication.source_spine[0].canonical_text == "甲\n"
    assert project_epub_xhtml(wrapped)[0] == "甲\n\n乙\n"
    assert project_epub_xhtml(wrapped)[0] == "\n".join(item.canonical_text for item in publication.source_spine)


@pytest.mark.parametrize("declaration", ["<!DOCTYPE package []>", "<!ENTITY delayed 'blocked'>"])
def test_xml_declarations_after_padding_are_rejected(declaration: str):
    with pytest.raises(EpubPublicationError, match="DOCTYPE/外部实体"):
        compile_epub(_epub(chapters=["<html><body>safe</body></html>"], opf_padding=(" " * 4097) + declaration))


def test_xhtml_declaration_after_padding_is_rejected():
    source = (" " * 4097) + '<!DOCTYPE html SYSTEM "https://example.invalid/xhtml.dtd"><html><body>safe</body></html>'
    with pytest.raises(EpubPublicationError, match="DOCTYPE/外部实体"):
        compile_epub(_epub(chapters=[source]))


def test_bare_html_doctype_is_allowed_for_real_epub_navigation_style():
    source = (
        "<!DOCTYPE html><html><head><meta charset='UTF-8'/><title>hidden title</title>"
        "<link rel='stylesheet' href='author.css'/></head><body><p>safe</p></body></html>"
    )
    publication = compile_epub(_epub(chapters=[source]))
    assert publication.source_spine[0].canonical_text == "safe\n"


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        (
            "<html><body>A<br hidden>B<img hidden src='missing.png'>C</body></html>",
            "ABC",
        ),
        (
            "<html><body>A<br aria-hidden='true'/>B<img aria-hidden='true'/>C</body></html>",
            "ABC",
        ),
        (
            "<html><body>A<div hidden>discarded</div>B<span hidden/>C</body></html>",
            "ABC",
        ),
        (
            "<html><body>A<svg><image hidden href='ignored.png'/></svg>B</body></html>",
            "AB",
        ),
    ],
)
def test_hidden_void_elements_are_atomic_without_swallowing_following_text(
    source: str, expected: str
):
    publication = compile_epub(_epub(chapters=[source]))
    chapter = publication.spine[0]

    assert chapter.canonical_text == expected
    assert publication.source_spine[0].canonical_text == expected
    assert project_epub_xhtml(chapter.controlled_html)[0] == expected
    assert "missing.png" not in chapter.controlled_html
