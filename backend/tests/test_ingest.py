from __future__ import annotations

import io
import zipfile

import msgpack
from sqlalchemy import select

from learningj.db.models.material import Material, Sentence, Sidecar
from learningj.db.models.lexeme import Lexeme
from learningj.ingest.service import import_material, parse_subtitle, split_plain_text


def test_plain_text_splits_quotes_and_preserves_code_point_offsets(migrated_engine):
    from sqlalchemy.orm import Session

    text = "𠮟られた。『本当に？』\n次です！"
    pieces = split_plain_text(text)
    assert [piece[0] for piece in pieces] == ["𠮟られた。", "『本当に？』", "次です！"]
    assert text[pieces[0][1] : pieces[0][2]] == "𠮟られた。"
    with Session(migrated_engine) as session:
        material = import_material(session, filename="sample.txt", blob=text.encode())
        sentences = session.scalars(select(Sentence).order_by(Sentence.index)).all()
        assert [sentence.text for sentence in sentences] == [piece[0] for piece in pieces]
        assert sentences[0].anchor_payload == {"char_start": 0, "char_end": 5}
        assert sentences[0].text == "𠮟られた。"


def test_srt_and_vtt_one_cue_one_sentence_with_reference_translation():
    srt = "1\n00:00:01,000 --> 00:00:03,500\n𠮟られた。\nI was scolded.\n\n2\n00:00:04,000 --> 00:00:05,000\n次です。\n"
    vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.500\n𠮟られた。\n"
    parsed = parse_subtitle(srt)
    assert parsed[0].text == "𠮟られた。"
    assert parsed[0].translation == "I was scolded."
    assert (parsed[0].time_start, parsed[0].time_end) == (1000, 3500)
    assert parse_subtitle(vtt)[0].time_end == 3500


def test_text_and_subtitle_have_same_sentence_sequence_except_anchors(migrated_engine):
    from sqlalchemy.orm import Session

    plain = "𠮟られた。次です！"
    srt = "1\n00:00:01,000 --> 00:00:02,000\n𠮟られた。\n\n2\n00:00:03,000 --> 00:00:04,000\n次です！\n"
    with Session(migrated_engine) as session:
        text_material = import_material(session, filename="same.txt", blob=plain.encode())
        subtitle_material = import_material(session, filename="same.srt", blob=srt.encode())
        text_sentences = session.scalars(select(Sentence).where(Sentence.material_id == text_material.id).order_by(Sentence.index)).all()
        subtitle_sentences = session.scalars(select(Sentence).where(Sentence.material_id == subtitle_material.id).order_by(Sentence.index)).all()
        assert [row.text for row in text_sentences] == [row.text for row in subtitle_sentences]
        assert all(row.time_start is None for row in text_sentences)
        assert all(row.time_start is not None for row in subtitle_sentences)


def test_import_is_idempotent_and_sidecar_has_nonempty_versions(migrated_engine):
    from sqlalchemy.orm import Session

    text = "𠮟られた。"
    with Session(migrated_engine) as session:
        first = import_material(session, filename="same.txt", blob=text.encode())
        second = import_material(session, filename="same.txt", blob=text.encode())
        assert first.id == second.id
        assert len(session.scalars(select(Material)).all()) == 1
        assert len(session.scalars(select(Sidecar)).all()) == 1
        lexemes = session.scalars(select(Lexeme)).all()
        assert lexemes and all(item.first_seen_analyzer_dict_version for item in lexemes)
        sidecar = session.scalar(select(Sidecar))
        assert sidecar and sidecar.content_hash == first.content_hash
        assert sidecar.segmenter_version and sidecar.tokenizer_version and sidecar.analyzer_dict_version
        payload = msgpack.unpackb(sidecar.payload, raw=False)
        assert payload["sentences"][0]["tokens"]


def test_epub_spine_is_adapted_to_epub_anchors(migrated_engine):
    from sqlalchemy.orm import Session

    container = """<?xml version='1.0'?><container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'><rootfiles><rootfile full-path='OEBPS/content.opf'/></rootfiles></container>"""
    opf = """<?xml version='1.0'?><package xmlns='http://www.idpf.org/2007/opf'><manifest><item id='chapter' href='chapter.xhtml' media-type='application/xhtml+xml'/></manifest><spine><itemref idref='chapter'/></spine></package>"""
    xhtml = "<html><body><p><ruby>\n<rb>𠮟</rb>\n<rt>しか</rt><rp>(しか)</rp>\n</ruby>られた。</p><p>日<img src='illustration.png'/>本。</p><p>次です。</p></body></html>"
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("META-INF/container.xml", container)
        archive.writestr("OEBPS/content.opf", opf)
        archive.writestr("OEBPS/chapter.xhtml", xhtml)
    with Session(migrated_engine) as session:
        material = import_material(session, filename="book.epub", blob=out.getvalue())
        sentences = session.scalars(select(Sentence).order_by(Sentence.index)).all()
        assert material.kind.value == "epub"
        assert [sentence.anchor_type.value for sentence in sentences] == ["epub", "epub", "epub", "epub"]
        assert sentences[0].text == "𠮟られた。"
        assert [sentence.text for sentence in sentences[1:3]] == ["日", "本。"]
        assert sentences[0].anchor_payload["spine_index"] == 0
        sidecar = session.scalar(select(Sidecar).where(Sidecar.material_id == material.id))
        payload = msgpack.unpackb(sidecar.payload, raw=False)
        assert payload["sentences"][0]["ruby_hints"] == [
            {
                "char_start": 0,
                "char_end": 1,
                "base_text": "𠮟",
                "reading": "しか",
                "reading_source": "epub_ruby",
            }
        ]


def test_oversized_sentence_tokenization_preserves_code_point_offsets(migrated_engine):
    from sqlalchemy.orm import Session

    text = ("𠮟られた。" * 9000) + "終わり。"
    with Session(migrated_engine) as session:
        material = import_material(session, filename="long.txt", blob=text.encode())
        sidecar = session.scalar(select(Sidecar).where(Sidecar.material_id == material.id))
        payload = msgpack.unpackb(sidecar.payload, raw=False)
        tokens = payload["sentences"][0]["tokens"]
        assert tokens
        assert max(token["char_end"] for token in tokens) <= len(text)
        assert all(token["char_start"] < token["char_end"] for token in tokens)
