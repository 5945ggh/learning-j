"""Material import pipeline for text, subtitle, and EPUB sources.

The importer deliberately normalizes every source into the same ordered
``Sentence`` shape.  Source-specific information is confined to timestamps
and anchor payloads, which keeps the rest of the application source agnostic.
"""

from __future__ import annotations

import io
import hashlib
import posixpath
import re
import uuid
import zipfile
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import PurePosixPath
from typing import Any
from xml.etree import ElementTree

import msgpack
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from learningj.db.models.material import Material, MaterialLexemeCount, Sentence, Sidecar
from learningj.domain import versions as domain_versions
from learningj.domain.enums import MaterialStorageMode
from learningj.db.models.lexeme import Lexeme
from learningj.domain.enums import MaterialKind, SentenceAnchorType
from learningj.domain.lexeme import derive_lexeme_id
from learningj.domain.offsets import normalize_text

SEGMENTER_VERSION = "learningj-segmenter-v1"


@dataclass(frozen=True)
class ParsedSentence:
    text: str
    time_start: int | None
    time_end: int | None
    translation: str | None
    anchor_type: SentenceAnchorType
    anchor_payload: dict[str, Any]
    ruby_hints: tuple[dict[str, Any], ...] = ()


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _is_closing_char(char: str) -> bool:
    return char in '"\'\u201d\u2019）)]】〕〉》」』】〗〙〛】〉》」』」』'


def split_plain_text(text: str) -> list[tuple[str, int, int]]:
    """Split prose at sentence punctuation while respecting closing quotes.

    Returned offsets are code-point offsets into the normalized full text.
    Empty whitespace-only fragments are discarded, but offsets continue to
    refer to the original normalized material.
    """

    normalized = normalize_text(text)
    result: list[tuple[str, int, int]] = []
    start = 0
    i = 0
    length = len(normalized)
    terminal = set("。！？!?．｡")
    while i < length:
        if normalized[i] in terminal:
            end = i + 1
            while end < length and _is_closing_char(normalized[end]):
                end += 1
            # A newline after punctuation is a natural boundary; otherwise
            # keep scanning so inline punctuation does not split abbreviations.
            if end == length or normalized[end].isspace() or end > i + 1 or normalized[i] in terminal:
                raw = normalized[start:end]
                left = len(raw) - len(raw.lstrip())
                right = len(raw.rstrip())
                if left < right:
                    result.append((normalized[start + left : start + right], start + left, start + right))
                start = end
                i = end
                continue
        elif normalized[i] == "\n":
            raw = normalized[start:i]
            if raw.strip():
                left = len(raw) - len(raw.lstrip())
                right = len(raw.rstrip())
                result.append((normalized[start + left : start + right], start + left, start + right))
            start = i + 1
        i += 1
    tail = normalized[start:]
    if tail.strip():
        left = len(tail) - len(tail.lstrip())
        right = len(tail.rstrip())
        result.append((tail[left:right], start + left, start + right))
    return result


_TIME_RE = re.compile(r"(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})")


def _parse_timestamp(value: str) -> int:
    match = _TIME_RE.search(value.strip())
    if not match:
        raise ValueError(f"invalid subtitle timestamp: {value!r}")
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2))
    seconds = int(match.group(3))
    millis = int(match.group(4))
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis


def parse_subtitle(text: str) -> list[ParsedSentence]:
    """Parse SRT or WebVTT cues (one cue becomes one Sentence)."""

    normalized = normalize_text(text).replace("\ufeff", "")
    lines = normalized.split("\n")
    cues: list[ParsedSentence] = []
    i = 0
    cue_index = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line or line.upper() == "WEBVTT" or line.startswith(("NOTE", "STYLE", "REGION")):
            i += 1
            while i < len(lines) and lines[i].strip() and line.startswith(("NOTE", "STYLE", "REGION")):
                i += 1
            continue
        has_inline_timing = "-->" in line
        timing_line = line if has_inline_timing else (lines[i + 1].strip() if i + 1 < len(lines) else "")
        if "-->" not in timing_line:
            i += 1
            continue
        if not has_inline_timing:
            i += 1
        left, right = [part.strip().split(maxsplit=1)[0] for part in timing_line.split("-->", 1)]
        start_ms, end_ms = _parse_timestamp(left), _parse_timestamp(right)
        i += 1
        cue_lines: list[str] = []
        while i < len(lines) and lines[i].strip():
            cue_lines.append(lines[i].strip())
            i += 1
        if not cue_lines:
            continue
        # Bilingual subtitles conventionally put Japanese first and the
        # translation on following lines.  Preserve it as reference data.
        japanese = cue_lines[0]
        translation = "\n".join(cue_lines[1:]) or None
        cues.append(
            ParsedSentence(
                text=normalize_text(japanese),
                time_start=start_ms,
                time_end=end_ms,
                translation=normalize_text(translation) if translation else None,
                anchor_type=SentenceAnchorType.SUBTITLE,
                anchor_payload={"cue_index": cue_index},
            )
        )
        cue_index += 1
    return cues


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0
        self._skip_tags = {"script", "style", "nav", "head", "rt", "rp"}
        self._block_tags = {"p", "div", "section", "blockquote", "li", "h1", "h2", "h3", "h4", "h5", "h6"}
        self._raw_offset = 0
        self._ruby_stack: list[dict[str, Any]] = []
        self._reading_depth = 0
        self.ruby_hints: list[dict[str, Any]] = []

    def _append(self, value: str) -> None:
        if not value:
            return
        self.parts.append(value)
        self._raw_offset += len(value)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "ruby" and not self._skip:
            self._ruby_stack.append({"start": self._raw_offset, "base": [], "reading": []})
        if tag == "rt" and self._ruby_stack:
            self._reading_depth += 1
        if tag in self._skip_tags:
            self._skip += 1
        elif not self._skip and tag in self._block_tags and self.parts and not self.parts[-1].endswith("\n"):
            self._append("\n")
        elif not self._skip and tag in {"br", "img", "image"}:
            self._append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "rt" and self._reading_depth:
            self._reading_depth -= 1
        if tag in self._skip_tags and self._skip:
            self._skip -= 1
        elif not self._skip and tag in self._block_tags:
            self._append("\n")
        if tag == "ruby" and self._ruby_stack:
            ruby = self._ruby_stack.pop()
            base_text = "".join(ruby["base"])
            reading = "".join(ruby["reading"]).strip()
            if base_text and reading:
                self.ruby_hints.append(
                    {
                        "raw_start": ruby["start"],
                        "raw_end": self._raw_offset,
                        "base_text": base_text,
                        "reading": reading,
                        "reading_source": "epub_ruby",
                    }
                )

    def handle_data(self, data: str) -> None:
        if self._reading_depth and self._ruby_stack:
            self._ruby_stack[-1]["reading"].append(data)
        elif not self._skip:
            if self._ruby_stack and not data.strip():
                # Pretty-printed rb/ruby indentation is markup whitespace,
                # not part of the logical base text or its offsets.
                return
            self._append(data)
            if self._ruby_stack:
                self._ruby_stack[-1]["base"].append(data)

    def handle_comment(self, _data: str) -> None:
        return


def _epub_sentences(blob: bytes) -> tuple[list[ParsedSentence], str]:
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        container = ElementTree.fromstring(archive.read("META-INF/container.xml"))
        rootfile = next(
            element for element in container.iter() if element.tag.rsplit("}", 1)[-1] == "rootfile"
        ).attrib["full-path"]
        opf = ElementTree.fromstring(archive.read(rootfile))
        manifest = {
            item.attrib["id"]: item.attrib["href"]
            for item in opf.iter()
            if item.tag.rsplit("}", 1)[-1] == "item"
        }
        spine_ids = [
            item.attrib["idref"]
            for item in opf.iter()
            if item.tag.rsplit("}", 1)[-1] == "itemref"
        ]
        base = posixpath.dirname(rootfile)
        out: list[ParsedSentence] = []
        full_text_parts: list[str] = []
        for spine_index, item_id in enumerate(spine_ids):
            href = manifest.get(item_id)
            if not href:
                continue
            path = posixpath.normpath(posixpath.join(base, href.split("#", 1)[0]))
            parser = _TextExtractor()
            parser.feed(archive.read(path).decode("utf-8", errors="replace"))
            raw_spine_text = "".join(parser.parts)
            spine_text = normalize_text(raw_spine_text)
            ruby_hints: list[dict[str, Any]] = []
            for hint in parser.ruby_hints:
                start = len(normalize_text(raw_spine_text[: hint["raw_start"]]))
                end = len(normalize_text(raw_spine_text[: hint["raw_end"]]))
                ruby_hints.append(
                    {
                        "char_start": start,
                        "char_end": end,
                        "base_text": spine_text[start:end],
                        "reading": hint["reading"],
                        "reading_source": hint["reading_source"],
                    }
                )
            full_text_parts.append(spine_text)
            for text, start, end in split_plain_text(spine_text):
                sentence_ruby = tuple(
                    {
                        **hint,
                        "char_start": hint["char_start"] - start,
                        "char_end": hint["char_end"] - start,
                    }
                    for hint in ruby_hints
                    if start <= hint["char_start"] and hint["char_end"] <= end
                )
                out.append(
                    ParsedSentence(
                        text=text,
                        time_start=None,
                        time_end=None,
                        translation=None,
                        anchor_type=SentenceAnchorType.EPUB,
                        anchor_payload={"spine_index": spine_index, "char_start": start, "char_end": end},
                        ruby_hints=sentence_ruby,
                    )
                )
        return out, normalize_text("\n".join(full_text_parts))


def parse_source(filename: str, blob: bytes) -> tuple[MaterialKind, list[ParsedSentence], str]:
    suffix = PurePosixPath(filename).suffix.lower()
    decoded = blob.decode("utf-8-sig", errors="replace")
    if suffix == ".srt" or suffix == ".vtt":
        sentences = parse_subtitle(decoded)
        full_text = normalize_text("\n".join(s.text for s in sentences))
        return MaterialKind.SUBTITLE_VIDEO, sentences, full_text
    if suffix == ".epub":
        sentences, full_text = _epub_sentences(blob)
        return MaterialKind.EPUB, sentences, full_text
    parts = split_plain_text(decoded)
    sentences = [
        ParsedSentence(
            text=text,
            time_start=None,
            time_end=None,
            translation=None,
            anchor_type=SentenceAnchorType.PLAIN_TEXT,
            anchor_payload={"char_start": start, "char_end": end},
        )
        for text, start, end in parts
    ]
    return MaterialKind.TEXT, sentences, normalize_text(decoded)


_MAX_TOKENIZE_INPUT_BYTES = 48_000
_TOKENIZE_BOUNDARY_CHARS = frozenset("\n。！？!?；;：:、，,」』）)]}…")


def _safe_tokenize_chunks(text: str) -> list[tuple[str, int]]:
    """Split oversized Sudachi inputs without changing code-point coordinates."""

    if len(text.encode("utf-8")) <= _MAX_TOKENIZE_INPUT_BYTES:
        return [(text, 0)]
    chunks: list[tuple[str, int]] = []
    start = 0
    while start < len(text):
        byte_count = 0
        hard_end = start
        for index in range(start, len(text)):
            next_count = byte_count + len(text[index].encode("utf-8"))
            if next_count > _MAX_TOKENIZE_INPUT_BYTES:
                break
            byte_count = next_count
            hard_end = index + 1
        if hard_end == len(text):
            chunks.append((text[start:], start))
            break
        boundary = max(
            (index + 1 for index in range(start, hard_end) if text[index] in _TOKENIZE_BOUNDARY_CHARS),
            default=hard_end,
        )
        end = boundary if boundary > start else hard_end
        chunks.append((text[start:end], start))
        start = end
    return chunks


def _tokenize(sentences: list[Sentence], analyzer_dict_version: str | None = None) -> tuple[list[dict[str, Any]], str, str]:
    try:
        import sudachipy
        from sudachipy import Dictionary, SplitMode
    except ImportError as exc:  # pragma: no cover - dependency is part of P1
        raise RuntimeError("SudachiPy is required for material import") from exc
    dictionary = Dictionary()
    tokenizer = dictionary.create()
    mode = SplitMode.A
    dict_version = analyzer_dict_version or domain_versions.analyzer_dict_version()
    tokenizer_version = getattr(sudachipy, "__version__", "sudachipy")
    payload: list[dict[str, Any]] = []
    for sentence in sentences:
        tokens: list[dict[str, Any]] = []
        for chunk, chunk_offset in _safe_tokenize_chunks(sentence.text):
            for morpheme in tokenizer.tokenize(chunk, mode):
                normalized = morpheme.normalized_form()
                pos = ",".join(morpheme.part_of_speech())
                reading = morpheme.reading_form() or ""
                lexeme_id = derive_lexeme_id(normalized, pos, reading)
                tokens.append(
                    {
                        "surface": morpheme.surface(),
                        "normalized_form": normalized,
                        "pos": pos,
                        "reading_form": reading,
                        "reading_source": "sudachi",
                        "lexeme_id": lexeme_id,
                        "char_start": morpheme.begin() + chunk_offset,
                        "char_end": morpheme.end() + chunk_offset,
                    }
                )
        payload.append({"sentence_index": sentence.index, "tokens": tokens})
    return payload, tokenizer_version, dict_version


def import_material(session: Session, *, filename: str, blob: bytes, locator: str | None = None, title: str | None = None, kind: MaterialKind | None = None, storage_mode: MaterialStorageMode = MaterialStorageMode.EXTERNAL_REFERENCE) -> Material:
    """Normalize, segment, tokenize, and persist one material idempotently."""

    detected_kind, parsed, full_text = parse_source(filename, blob)
    material_kind = kind or detected_kind
    content_hash = _content_hash(full_text)
    existing = session.scalar(select(Material).where(Material.content_hash == content_hash, Material.kind == material_kind))
    if existing is not None:
        return existing

    material = Material(
        title=title or PurePosixPath(filename).stem or "Untitled",
        content_hash=content_hash,
        locator=locator or filename,
        kind=material_kind,
        copy_stored=storage_mode is MaterialStorageMode.MANAGED_COPY,
        storage_mode=storage_mode,
        source_sha256=hashlib.sha256(blob).hexdigest(),
    )
    session.add(material)
    session.flush()
    sentence_rows: list[Sentence] = []
    for index, item in enumerate(parsed):
        row = Sentence(
            material_id=material.id,
            index=index,
            text=normalize_text(item.text),
            time_start=item.time_start,
            time_end=item.time_end,
            translation=normalize_text(item.translation) if item.translation else None,
            anchor_type=item.anchor_type,
            anchor_payload=item.anchor_payload,
        )
        sentence_rows.append(row)
        session.add(row)
    session.flush()
    token_payload, tokenizer_version, dict_version = _tokenize(sentence_rows)
    for token_group, parsed_sentence in zip(token_payload, parsed, strict=True):
        token_group["ruby_hints"] = list(parsed_sentence.ruby_hints)
    sidecar = Sidecar(
        material_id=material.id,
        content_hash=content_hash,
        segmenter_version=SEGMENTER_VERSION,
        tokenizer_version=tokenizer_version,
        analyzer_dict_version=dict_version,
        payload=msgpack.packb({"sentences": token_payload}, use_bin_type=True),
    )
    session.add(sidecar)
    session.flush()
    _publish_generation(
        session,
        material=material,
        sidecar=sidecar,
        token_payload=token_payload,
        analyzer_dict_version=dict_version,
    )
    session.commit()
    session.refresh(material)
    return material


def _generation_counts(token_payload: list[dict[str, Any]]) -> tuple[dict[str, int], int]:
    """Aggregate the sparse per-lexeme token counts of one token payload."""
    counts: dict[str, int] = {}
    total = 0
    for token_group in token_payload:
        for token in token_group["tokens"]:
            lexeme_id = token.get("lexeme_id")
            if not lexeme_id:
                raise ValueError("token payload is missing a derived lexeme id")
            counts[lexeme_id] = counts.get(lexeme_id, 0) + 1
            total += 1
    return counts, total


def _persist_lexemes(session: Session, token_payload: list[dict[str, Any]], analyzer_dict_version: str) -> None:
    for token_group in token_payload:
        for token in token_group["tokens"]:
            lexeme = session.get(Lexeme, token["lexeme_id"])
            if lexeme is None:
                session.add(
                    Lexeme(
                        lexeme_id=token["lexeme_id"],
                        normalized_form=token["normalized_form"],
                        pos=token["pos"],
                        reading_form=token["reading_form"],
                        first_seen_analyzer_dict_version=analyzer_dict_version,
                    )
                )


def _publish_generation(
    session: Session,
    *,
    material: Material,
    sidecar: Sidecar,
    token_payload: list[dict[str, Any]],
    analyzer_dict_version: str,
) -> None:
    """Write the complete content index for one sidecar and publish it.

    The sparse counts and the immutable payload are flushed before the
    material pointer moves, and the caller commits them in one short
    transaction, so a reader never mixes generations and a failure leaves the
    previous generation current (data-model §2.5/§8.3, ADR-040).
    """

    counts, total = _generation_counts(token_payload)
    _persist_lexemes(session, token_payload, analyzer_dict_version)
    session.flush()
    for lexeme_id, token_count in counts.items():
        session.add(
            MaterialLexemeCount(
                material_id=material.id,
                sidecar_id=sidecar.id,
                lexeme_id=lexeme_id,
                token_count=token_count,
            )
        )
    session.flush()
    persisted_total = session.scalar(
        select(func.coalesce(func.sum(MaterialLexemeCount.token_count), 0)).where(
            MaterialLexemeCount.sidecar_id == sidecar.id
        )
    )
    if persisted_total != total:
        raise RuntimeError("published counts do not reproduce the token payload")
    # Publication point: the new generation is fully written and validated;
    # switching the pointer is the only remaining step of the same commit.
    material.current_sidecar_id = sidecar.id


def retokenize_material(session: Session, *, material_id: uuid.UUID) -> Material:
    """Re-derive one material's tokens into a new immutable sidecar generation.

    The candidate payload is built from the stored normalized sentences
    outside the write transaction.  Publication reuses the shared gate: the
    new sidecar row, its complete MaterialLexemeCount set, and the
    ``current_sidecar_id`` switch commit together, so re-tokenizing never
    overwrites the referenced payload and a failure keeps the old generation
    current (data-model §8.3).  Re-running with an unchanged analyzer identity
    is idempotent and publishes nothing.
    """

    material = session.get(Material, material_id)
    if material is None:
        raise LookupError(f"素材不存在: {material_id}")
    sentences = session.scalars(
        select(Sentence).where(Sentence.material_id == material.id).order_by(Sentence.index)
    ).all()
    token_payload, tokenizer_version, dict_version = _tokenize(sentences)
    current = (
        session.get(Sidecar, material.current_sidecar_id)
        if material.current_sidecar_id
        else None
    )
    # Ruby hints annotate positions in the normalized sentence text, which
    # re-tokenization does not change; carry the stored ones into the
    # candidate payload instead of dropping them.
    hints_by_index = {
        group.get("sentence_index"): list(group.get("ruby_hints", []))
        for group in (msgpack.unpackb(current.payload, raw=False).get("sentences", []) if current else [])
    }
    for token_group in token_payload:
        token_group["ruby_hints"] = hints_by_index.get(token_group["sentence_index"], [])
    candidate = msgpack.packb({"sentences": token_payload}, use_bin_type=True)
    if (
        current is not None
        and current.payload == candidate
        and current.content_hash == material.content_hash
        and current.segmenter_version == SEGMENTER_VERSION
        and current.tokenizer_version == tokenizer_version
        and current.analyzer_dict_version == dict_version
    ):
        return material
    sidecar = Sidecar(
        material_id=material.id,
        content_hash=material.content_hash,
        segmenter_version=SEGMENTER_VERSION,
        tokenizer_version=tokenizer_version,
        analyzer_dict_version=dict_version,
        payload=candidate,
    )
    session.add(sidecar)
    session.flush()
    _publish_generation(
        session,
        material=material,
        sidecar=sidecar,
        token_payload=token_payload,
        analyzer_dict_version=dict_version,
    )
    session.commit()
    session.refresh(material)
    return material
