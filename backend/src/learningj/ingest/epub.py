"""安全的 EPUB package 解析与受控 reader projection。

这个模块只处理 publication 边界：ZIP/OCF 路径、OPF manifest/spine、图片资源
allowlist 和非脚本 XHTML。EPUB 的 canonical text 与受控 representation 由
本模块的共享投影规则产生，避免 reader representation 偷换 Sentence 坐标；
其他素材类型仍由 ingest.service 的 ``_TextExtractor`` 处理。
"""

from __future__ import annotations

import hashlib
import html
import io
import posixpath
import re
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import PurePosixPath
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree

# This is the persisted coordinate/controlled-DOM contract, not a build
# number.  Keep it stable during pre-release development; bump only when a
# released change alters canonical offsets or controlled projection semantics.
EPUB_PROJECTION_VERSION = "learningj-epub-publication-v4"
MAX_EPUB_ENTRIES = 2_000
MAX_EPUB_ENTRY_BYTES = 16 * 1024 * 1024
MAX_EPUB_TOTAL_BYTES = 128 * 1024 * 1024


class EpubPublicationError(ValueError):
    """A user-provided EPUB cannot be safely represented as a publication."""


@dataclass(frozen=True)
class EpubSourceSpine:
    index: int
    item_id: str
    member_path: str
    label: str
    canonical_text: str
    controlled_html: str
    ruby_hints: tuple[dict[str, object], ...] = ()
    image_only: bool = False
    cover: bool = False


@dataclass(frozen=True)
class EpubSpine:
    """A user-facing chapter, possibly composed from multiple source spine items."""

    index: int
    item_id: str
    member_path: str
    label: str
    canonical_text: str
    controlled_html: str
    source_indices: tuple[int, ...] = ()


@dataclass(frozen=True)
class EpubResource:
    resource_id: str
    member_path: str
    media_type: str


@dataclass(frozen=True)
class EpubPublication:
    title: str
    projection_version: str
    publication_version: str
    spine: tuple[EpubSpine, ...]
    source_spine: tuple[EpubSourceSpine, ...]
    resources: tuple[EpubResource, ...]
    cover_resource_id: str | None = None
    author: str | None = None

    def as_manifest(self, source_sha256: str) -> dict[str, object]:
        return {
            "title": self.title,
            "author": self.author,
            "projection_version": self.projection_version,
            "publication_version": self.publication_version,
            "source_sha256": source_sha256,
            "cover_resource_id": self.cover_resource_id,
            "spine": [
                {
                    "index": item.index,
                    "item_id": item.item_id,
                    "member_path": item.member_path,
                    "label": item.label,
                    "canonical_text": item.canonical_text,
                    "controlled_html": item.controlled_html,
                    "source_indices": list(item.source_indices),
                }
                for item in self.spine
            ],
            # Keep source-spine identity, canonical coordinates and ruby hints
            # for Sentence/sidecar rebuilds; controlled XHTML is stored once
            # in the reader-facing grouped spine below rather than duplicated
            # for every source item.
            "source_spine": [
                {
                    "index": item.index,
                    "item_id": item.item_id,
                    "member_path": item.member_path,
                    "label": item.label,
                    "canonical_text": item.canonical_text,
                    "ruby_hints": list(item.ruby_hints),
                    "image_only": item.image_only,
                    "cover": item.cover,
                }
                for item in self.source_spine
            ],
            "resources": [
                {
                    "resource_id": resource.resource_id,
                    "member_path": resource.member_path,
                    "media_type": resource.media_type,
                }
                for resource in self.resources
            ],
        }


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _safe_member_path(name: str) -> str:
    """Return a normalized publication-local member or reject it."""

    if not name or "\x00" in name or "\\" in name:
        raise EpubPublicationError("EPUB 资源路径无效")
    # ZIP member names are package-local paths, not URI references.  Keep
    # percent signs literal here; callers resolving an EPUB href decode its
    # URI path exactly once before passing the result to this helper.
    decoded = name
    if decoded.startswith("/") or decoded.startswith("//"):
        raise EpubPublicationError("EPUB 资源路径不得是绝对路径")
    parts = decoded.split("/")
    if any(part in {"", "."} for part in parts[:-1]) or ".." in parts:
        raise EpubPublicationError("EPUB 资源路径越界")
    normalized = posixpath.normpath(decoded)
    if normalized in {"", "."} or normalized.startswith("../") or normalized == "..":
        raise EpubPublicationError("EPUB 资源路径越界")
    return normalized


def _safe_href(base_member: str, href: str) -> tuple[str, str | None]:
    """Resolve a package-local href and return (member, fragment)."""

    # Split the raw URI first.  Decoding the whole href before ``urlsplit``
    # would turn encoded reserved characters such as ``%23`` and ``%3F``
    # into fragment/query delimiters instead of valid filename characters.
    parsed = urlsplit(href)
    if parsed.scheme or parsed.netloc:
        raise EpubPublicationError("EPUB 不支持外部 publication 资源")
    target = unquote(parsed.path or "")
    fragment = parsed.fragment or None
    if not target:
        return base_member, fragment
    base_dir = posixpath.dirname(base_member)
    # Relative references such as ``../Images/cover.jpg`` are valid inside an
    # EPUB.  Normalize the joined path first, then reject only a result that
    # escapes the publication root; rejecting every literal ``..`` would make
    # ordinary OCF sibling-directory resources impossible to serve.
    resolved = posixpath.normpath(posixpath.join(base_dir, target))
    if resolved == ".." or resolved.startswith("../") or resolved.startswith("/"):
        raise EpubPublicationError("EPUB 资源路径越界")
    return _safe_member_path(resolved), fragment


def _reject_xml_declarations(blob: bytes, resource: str) -> None:
    # ElementTree does not fetch external entities, but rejecting unsafe DTD
    # declarations explicitly makes the boundary independent of parser
    # implementation.  A bare ``<!DOCTYPE html>`` is common in EPUB3
    # navigation/XHTML documents and carries no external or internal subset,
    # so it is safe to accept; PUBLIC/SYSTEM identifiers and ``[...]`` subsets
    # remain rejected.  Scan the full bounded archive member: declarations
    # after a harmless padding prefix must not get a different policy.
    byte_candidate = blob.upper()
    text_candidates: list[str] = []
    try:
        text_candidates.append(blob.decode("utf-8").upper())
    except UnicodeDecodeError:
        pass
    # UTF-16/32 XML is legal and may contain NUL bytes between the ASCII
    # declaration characters, so the byte check alone would not be fail-closed
    # for those encodings.  Decode only when a BOM or NUL strongly indicates a
    # wide encoding; malformed data will still be rejected by ElementTree.
    wide_bom = (
        b"\xff\xfe",
        b"\xfe\xff",
        b"\xff\xfe\x00\x00",
        b"\x00\x00\xfe\xff",
    )
    if blob.startswith(wide_bom) or b"\x00" in blob[:256]:
        for encoding in (
            "utf-16",
            "utf-16-le",
            "utf-16-be",
            "utf-32",
            "utf-32-le",
            "utf-32-be",
        ):
            try:
                text_candidates.append(blob.decode(encoding).upper())
            except UnicodeDecodeError:
                continue
    if b"<!ENTITY" in byte_candidate:
        raise EpubPublicationError(f"{resource} 不允许 DOCTYPE/外部实体")

    def check_text(candidate: str) -> bool:
        if "<!ENTITY" in candidate:
            return False
        if "<!DOCTYPE" not in candidate:
            return True
        declarations = list(re.finditer(r"<!DOCTYPE\b([^>]*)>", candidate, re.DOTALL))
        if not declarations:
            return False
        return all(re.fullmatch(r"\s*HTML\s*", match.group(1)) for match in declarations)

    if b"<!DOCTYPE" in byte_candidate:
        declarations = list(
            re.finditer(br"<!DOCTYPE\b([^>]*)>", byte_candidate, re.DOTALL)
        )
        if not declarations:
            raise EpubPublicationError(f"{resource} 不允许 DOCTYPE/外部实体")
        for declaration in declarations:
            try:
                body = declaration.group(1).decode("ascii")
            except UnicodeDecodeError:
                raise EpubPublicationError(f"{resource} 不允许 DOCTYPE/外部实体") from None
            if not re.fullmatch(r"\s*HTML\s*", body):
                raise EpubPublicationError(f"{resource} 不允许 DOCTYPE/外部实体")

    if not all(check_text(candidate) for candidate in text_candidates):
        raise EpubPublicationError(f"{resource} 不允许 DOCTYPE/外部实体")


def _parse_xml(blob: bytes, resource: str) -> ElementTree.Element:
    _reject_xml_declarations(blob, resource)
    try:
        return ElementTree.fromstring(blob)
    except ElementTree.ParseError as exc:
        raise EpubPublicationError(f"{resource} XML 无法解析") from exc


def _archive_inventory(archive: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    infos = archive.infolist()
    if len(infos) > MAX_EPUB_ENTRIES:
        raise EpubPublicationError("EPUB 资源数量超过限制")
    inventory: dict[str, zipfile.ZipInfo] = {}
    total = 0
    for info in infos:
        member = _safe_member_path(info.filename)
        if member in inventory:
            raise EpubPublicationError("EPUB 包含重复资源路径")
        if info.file_size > MAX_EPUB_ENTRY_BYTES:
            raise EpubPublicationError("EPUB 单个资源超过大小限制")
        total += info.file_size
        if total > MAX_EPUB_TOTAL_BYTES:
            raise EpubPublicationError("EPUB 解压后总大小超过限制")
        inventory[member] = info
    return inventory


def _read_member(archive: zipfile.ZipFile, inventory: dict[str, zipfile.ZipInfo], member: str) -> bytes:
    info = inventory.get(member)
    if info is None:
        raise EpubPublicationError(f"EPUB 缺少资源: {member}")
    try:
        return archive.read(info)
    except (OSError, RuntimeError, zipfile.BadZipFile) as exc:
        raise EpubPublicationError(f"EPUB 资源读取失败: {member}") from exc


class _NavParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.current_href: str | None = None
        self.current_text: list[str] = []
        self.labels: dict[str, str] = {}
        self.nav_types: list[str] = []
        self.toc_hrefs: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "nav":
            values = {key.lower(): value or "" for key, value in attrs}
            self.nav_types.append(values.get("epub:type", values.get("type", "")).lower())
            return
        if tag.lower() != "a":
            return
        href = dict(attrs).get("href")
        self.current_href = href
        self.current_text = []

    def handle_data(self, data: str) -> None:
        if self.current_href is not None:
            self.current_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "nav" and self.nav_types:
            self.nav_types.pop()
            return
        if tag.lower() != "a" or self.current_href is None:
            return
        label = " ".join("".join(self.current_text).split())
        if label:
            self.labels[self.current_href] = label
            if "toc" in self.nav_types:
                self.toc_hrefs.add(self.current_href)
        self.current_href = None
        self.current_text = []


def _parse_ncx_labels(
    blob: bytes,
    *,
    ncx_member: str,
) -> dict[str, str]:
    """Read EPUB2 NCX labels without exposing the NCX document itself."""

    root = _parse_xml(blob, "toc.ncx")
    labels: dict[str, str] = {}
    for nav_point in root.iter():
        if _local_name(nav_point.tag) != "navpoint":
            continue
        label = next(
            (
                " ".join((text.text or "").split())
                for text in nav_point.iter()
                if _local_name(text.tag) == "text" and (text.text or "").strip()
            ),
            "",
        )
        content = next(
            (
                element.attrib.get("src", "")
                for element in nav_point.iter()
                if _local_name(element.tag) == "content" and element.attrib.get("src")
            ),
            "",
        )
        if not label or not content:
            continue
        try:
            member, _fragment = _safe_href(ncx_member, content)
        except EpubPublicationError:
            continue
        labels[member] = label
    return labels


def _remap_chapter_placeholders(html_text: str, source_to_chapter: dict[int, int]) -> str:
    def rewrite(name: str, value: str) -> str:
        if name.lower() != "href":
            return value

        def replace(match: re.Match[str]) -> str:
            source_index = int(match.group(1))
            chapter_index = source_to_chapter.get(source_index)
            if chapter_index is None:
                # A source item such as a cover may intentionally be excluded
                # from reader chapters.  Keep its link inert instead of
                # falling back to a now-unrelated chapter index.
                return "__LJ_DISABLED_LINK__"
            return f"__LJ_CHAPTER_{chapter_index}__"

        return re.sub(r"__LJ_CHAPTER_([0-9]+)__", replace, value)

    return _rewrite_html_attributes(html_text, rewrite)


_DROP_WITH_CONTENT = {
    "script", "style", "nav", "head", "iframe", "object", "embed", "form",
    "input", "button", "textarea", "select", "option", "video", "audio", "canvas",
}
_TRANSPARENT_TAGS = {"html", "body", "main", "article", "figure", "figcaption", "dl", "dt", "dd", "table", "thead", "tbody", "tr", "td", "th"}
_VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
_ALLOWED_TAGS = {
    "p", "div", "blockquote", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6",
    "span", "em", "strong", "b", "i", "ruby", "rb", "rt", "rp", "br", "img", "image", "a", "section",
}
_RASTER_MEDIA_TYPES = {"image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"}


def _normalized_media_type(value: str) -> str:
    """Return a manifest media type suitable for the controlled endpoint."""

    return value.split(";", 1)[0].strip().lower()


class _ControlledXhtml(HTMLParser):
    def __init__(
        self,
        *,
        chapter_member: str,
        spine_by_member: dict[str, int],
        resources_by_member: dict[str, EpubResource],
    ) -> None:
        super().__init__(convert_charrefs=True)
        self.chapter_member = chapter_member
        self.spine_by_member = spine_by_member
        self.resources_by_member = resources_by_member
        self.parts: list[str] = []
        self.skip_depth = 0
        self.open_tags: list[tuple[str, str]] = []
        self.svg_stack: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if self.skip_depth:
            if tag not in _VOID_TAGS:
                self.skip_depth += 1
            return
        raw_attrs = {key.lower(): value for key, value in attrs}
        if "hidden" in raw_attrs or raw_attrs.get("aria-hidden", "").lower() == "true":
            # Void elements have no end tag to close a skip scope.  Ignore a
            # hidden ``br``/``img`` atomically so following visible content
            # remains in the projection.
            if tag in _VOID_TAGS:
                return
            self.skip_depth = 1
            return
        if self.svg_stack:
            if tag == "image":
                raw_svg = {key.lower(): value for key, value in attrs}
                href = raw_svg.get("xlink:href") or raw_svg.get("href") or ""
                try:
                    member, _fragment = _safe_href(self.chapter_member, href)
                except EpubPublicationError:
                    self.parts.append('<br data-learningj-image-placeholder="true">')
                    return
                resource = self.resources_by_member.get(member)
                if resource is None:
                    self.parts.append('<br data-learningj-image-placeholder="true">')
                else:
                    self.parts.append(
                        f'<img src="__LJ_RESOURCE_{resource.resource_id}__" alt="" loading="lazy">'
                    )
                return
            if tag not in _VOID_TAGS:
                self.svg_stack.append(tag)
            return
        if tag in _DROP_WITH_CONTENT:
            self.skip_depth = 1
            return
        if tag == "svg":
            # SVG itself is never exposed to the browser.  Safe local bitmap
            # descendants are projected to ordinary <img> elements instead.
            self.svg_stack.append(tag)
            return
        if tag in _TRANSPARENT_TAGS:
            return
        if tag not in _ALLOWED_TAGS:
            # Unknown inline/block markup is transparent, but its attributes
            # never cross into the controlled surface.
            return
        raw = raw_attrs
        if tag in {"img", "image"}:
            try:
                href = raw.get("src", "") if tag == "img" else (raw.get("xlink:href") or raw.get("href") or "")
                member, _fragment = _safe_href(self.chapter_member, href)
            except EpubPublicationError:
                self.parts.append('<br data-learningj-image-placeholder="true">')
                return
            resource = self.resources_by_member.get(member)
            if resource is None:
                self.parts.append('<br data-learningj-image-placeholder="true">')
                return
            alt = html.escape(raw.get("alt") or "", quote=True)
            self.parts.append(
                f'<img src="__LJ_RESOURCE_{resource.resource_id}__" alt="{alt}" loading="lazy">'
            )
            return
        if tag == "a":
            href = raw.get("href") or ""
            try:
                member, fragment = _safe_href(self.chapter_member, href)
            except EpubPublicationError:
                self.parts.append("<span>")
                self.open_tags.append((tag, "span"))
                return
            if member in self.spine_by_member:
                target = f"__LJ_CHAPTER_{self.spine_by_member[member]}__"
                if fragment:
                    target += f"#{html.escape(fragment, quote=True)}"
                self.parts.append(f'<a href="{target}">')
                self.open_tags.append((tag, "a"))
            else:
                self.parts.append("<span>")
                self.open_tags.append((tag, "span"))
            return
        self.parts.append(f"<{tag}>")
        self.open_tags.append((tag, tag))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        was_skipping = self.skip_depth > 0
        self.handle_starttag(tag, attrs)
        if was_skipping:
            # A self-closing non-void tag nested inside dropped content still
            # increments the drop depth in ``handle_starttag``; close that
            # nested scope immediately instead of suppressing the rest of the
            # document after ``<title/>``/``<script/>``.
            if tag.lower() not in _VOID_TAGS:
                self.skip_depth -= 1
            return
        if self.skip_depth:
            # The self-closing tag itself opened a dropped scope (for example
            # an SVG ``<image hidden/>``).  Close that scope immediately.
            if tag.lower() not in _VOID_TAGS:
                self.skip_depth -= 1
            return
        if tag.lower() in _VOID_TAGS:
            return
        if tag.lower() == "svg":
            self.handle_endtag(tag)
            return
        if self.svg_stack:
            return
        if tag.lower() not in {"img", "br"}:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self.skip_depth:
            self.skip_depth -= 1
            return
        if self.svg_stack:
            if tag in self.svg_stack:
                for index in range(len(self.svg_stack) - 1, -1, -1):
                    if self.svg_stack[index] == tag:
                        self.svg_stack = self.svg_stack[:index]
                        break
            return
        if tag in _TRANSPARENT_TAGS or tag not in _ALLOWED_TAGS:
            return
        if tag in {"img", "br"}:
            return
        for index in range(len(self.open_tags) - 1, -1, -1):
            source_tag, output_tag = self.open_tags[index]
            if source_tag == tag:
                self.open_tags = self.open_tags[:index]
                self.parts.append(f"</{output_tag}>")
                return

    def handle_data(self, data: str) -> None:
        if not self.skip_depth and not self.svg_stack:
            self.parts.append(html.escape(data, quote=False))

    def handle_comment(self, _data: str) -> None:
        return


class _EpubProjectionExtractor(HTMLParser):
    """The canonical EPUB projection shared by import and controlled DOM checks.

    This intentionally mirrors the historical text extractor's block/ruby
    semantics while making the SVG policy explicit: SVG text is excluded, but
    each SVG raster-image boundary is one LF, matching its controlled ``img``.
    """

    _skip_tags = _DROP_WITH_CONTENT | {"rt", "rp"}
    _block_tags = {"p", "div", "section", "blockquote", "li", "h1", "h2", "h3", "h4", "h5", "h6"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0
        self._hidden_tags: list[str] = []
        self._svg_stack: list[str] = []
        self._section_wrappers: list[bool] = []
        self._raw_offset = 0
        self._ruby_stack: list[dict[str, object]] = []
        self._reading_depth = 0
        self.ruby_hints: list[dict[str, object]] = []

    def _append(self, value: str) -> None:
        if value:
            self.parts.append(value)
            self._raw_offset += len(value)

    @staticmethod
    def _is_controlled_wrapper(tag: str, attrs: dict[str, str | None]) -> bool:
        return tag == "section" and "data-learningj-source-spine-index" in attrs

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attr_map = {key.lower(): value for key, value in attrs}
        if self._skip:
            if tag not in _VOID_TAGS:
                self._skip += 1
            return
        if "hidden" in attr_map or attr_map.get("aria-hidden", "").lower() == "true":
            # A hidden void element is atomic; opening a skip scope would
            # consume all following text because no end tag is emitted.
            if tag in _VOID_TAGS:
                return
            self._skip = 1
            self._hidden_tags.append(tag)
            return
        if tag == "svg":
            self._svg_stack.append(tag)
            return
        if self._svg_stack:
            if tag == "image":
                self._append("\n")
            if tag not in _VOID_TAGS:
                self._svg_stack.append(tag)
            return
        if tag == "ruby":
            self._ruby_stack.append({"start": self._raw_offset, "base": [], "reading": []})
        if tag == "section":
            self._section_wrappers.append(self._is_controlled_wrapper(tag, attr_map))
        if tag == "rt" and self._ruby_stack:
            self._reading_depth += 1
        if tag in self._skip_tags:
            self._skip = 1
        elif tag in self._block_tags and not self._is_controlled_wrapper(tag, attr_map) and self.parts and not self.parts[-1].endswith("\n"):
            self._append("\n")
        elif tag in {"br", "img", "image"}:
            self._append("\n")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Mirror the controlled parser's void/self-closing handling.

        ``HTMLParser``'s default implementation calls ``handle_endtag`` for
        every ``<meta/>``/``<link/>``.  While a dropped ``head``/``script`` is
        active that would incorrectly decrement the drop depth and leak later
        text (notably the title of real EPUB cover documents).
        """

        was_skipping = self._skip > 0
        self.handle_starttag(tag, attrs)
        if was_skipping:
            if tag.lower() not in _VOID_TAGS:
                self.handle_endtag(tag)
            return
        if self._skip:
            self.handle_endtag(tag)
            return
        if tag.lower() in _VOID_TAGS:
            return
        if tag.lower() == "svg" or self._svg_stack:
            return
        self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "rt" and self._reading_depth:
            self._reading_depth -= 1
        if self._skip:
            self._skip -= 1
            if self._hidden_tags and self._hidden_tags[-1] == tag:
                self._hidden_tags.pop()
            return
        if self._svg_stack:
            for index in range(len(self._svg_stack) - 1, -1, -1):
                if self._svg_stack[index] == tag:
                    self._svg_stack = self._svg_stack[:index]
                    break
            return
        if tag in self._skip_tags:
            return
        if tag in self._block_tags:
            # Compiler-created chapter wrappers are structural only; explicit
            # source-spine separators below carry the exact source join rule.
            is_controlled_wrapper = self._section_wrappers.pop() if tag == "section" and self._section_wrappers else False
            if not is_controlled_wrapper:
                self._append("\n")
        if tag == "ruby" and self._ruby_stack:
            ruby = self._ruby_stack.pop()
            base_text = "".join(ruby["base"])
            reading = "".join(ruby["reading"]).strip()
            if base_text and reading:
                self.ruby_hints.append({
                    "raw_start": ruby["start"], "raw_end": self._raw_offset,
                    "base_text": base_text, "reading": reading, "reading_source": "epub_ruby",
                })

    def handle_data(self, data: str) -> None:
        if self._svg_stack:
            return
        if self._reading_depth and self._ruby_stack:
            self._ruby_stack[-1]["reading"].append(data)
        else:
            if self._skip:
                return
            if self._ruby_stack and not data.strip():
                return
            self._append(data)
            if self._ruby_stack:
                self._ruby_stack[-1]["base"].append(data)

    def handle_comment(self, _data: str) -> None:
        return


def project_epub_xhtml(source: str) -> tuple[str, tuple[dict[str, object], ...]]:
    """Return the NFC canonical text and ruby hints for EPUB XHTML.

    ``ingest.service`` should use this function for EPUBs so Sentence anchors,
    controlled publication DOM re-projection, and future reader mapping share
    one versioned rule set.
    """
    from learningj.domain.offsets import normalize_text

    parser = _EpubProjectionExtractor()
    parser.feed(source)
    raw_text = "".join(parser.parts)
    canonical = normalize_text(raw_text)
    hints: list[dict[str, object]] = []
    for hint in parser.ruby_hints:
        start = len(normalize_text(raw_text[: int(hint["raw_start"])]))
        end = len(normalize_text(raw_text[: int(hint["raw_end"])]))
        hints.append(
            {
                "char_start": start,
                "char_end": end,
                "base_text": canonical[start:end],
                "reading": str(hint["reading"]),
                "reading_source": str(hint["reading_source"]),
            }
        )
    return canonical, tuple(hints)


def compile_epub(blob: bytes, filename: str = "book.epub") -> EpubPublication:
    """Parse and compile an EPUB to a persisted, controlled publication manifest."""

    try:
        archive = zipfile.ZipFile(io.BytesIO(blob))
    except (OSError, zipfile.BadZipFile) as exc:
        raise EpubPublicationError("EPUB 不是有效的 ZIP 文件") from exc
    with archive:
        inventory = _archive_inventory(archive)
        try:
            corrupt_member = archive.testzip()
        except (OSError, RuntimeError, zipfile.BadZipFile) as exc:
            raise EpubPublicationError("EPUB ZIP 无法完整校验") from exc
        if corrupt_member is not None:
            raise EpubPublicationError(f"EPUB ZIP 已损坏: {corrupt_member}")
        container = _parse_xml(_read_member(archive, inventory, "META-INF/container.xml"), "container.xml")
        rootfiles = [element for element in container.iter() if _local_name(element.tag) == "rootfile"]
        if not rootfiles:
            raise EpubPublicationError("EPUB 缺少 OPF rootfile")
        rootfile = rootfiles[0].attrib.get("full-path")
        if not rootfile:
            raise EpubPublicationError("EPUB rootfile 路径为空")
        opf_member = _safe_member_path(unquote(rootfile))
        opf = _parse_xml(_read_member(archive, inventory, opf_member), "OPF")
        manifest: dict[str, dict[str, str]] = {}
        for element in opf.iter():
            if _local_name(element.tag) != "item":
                continue
            item_id = element.attrib.get("id")
            href = element.attrib.get("href")
            media_type = _normalized_media_type(element.attrib.get("media-type", ""))
            if not item_id or not href or not media_type:
                raise EpubPublicationError("OPF manifest 项缺少 id/href/media-type")
            member, _fragment = _safe_href(opf_member, href)
            if member not in inventory:
                raise EpubPublicationError(f"OPF manifest 引用不存在资源: {member}")
            manifest[item_id] = {
                "href": href,
                "member": member,
                "media_type": media_type,
                "properties": element.attrib.get("properties", ""),
            }
        spine_ids = [
            element.attrib.get("idref")
            for element in opf.iter()
            if _local_name(element.tag) == "itemref"
        ]
        spine_ids = [item_id for item_id in spine_ids if item_id]
        if not spine_ids:
            raise EpubPublicationError("EPUB spine 为空")
        for item_id in spine_ids:
            item = manifest.get(item_id)
            if item is None:
                raise EpubPublicationError(f"EPUB spine 引用不存在 manifest 项: {item_id}")
            if item["media_type"] not in {"application/xhtml+xml", "text/html", "application/x-dtbook+xml"}:
                raise EpubPublicationError(f"EPUB spine 不支持 media type: {item['media_type']}")

        title = ""
        for element in opf.iter():
            if _local_name(element.tag) == "title" and (element.text or "").strip():
                title = " ".join((element.text or "").split())
                break
        if not title:
            title = PurePosixPath(filename).stem or "Untitled"

        creators: list[str] = []
        for element in opf.iter():
            if _local_name(element.tag) != "creator":
                continue
            value = " ".join((element.text or "").split())
            if value and value not in creators:
                creators.append(value)
        if not creators:
            # A few older packages use a non-Dublin-Core author meta instead
            # of ``dc:creator``.  Treat it as a display fallback only.
            for element in opf.iter():
                if _local_name(element.tag) != "meta":
                    continue
                name = (element.attrib.get("name") or "").strip().lower()
                value = " ".join(
                    (element.attrib.get("content") or element.text or "").split()
                )
                if name in {"author", "creator"} and value:
                    creators.append(value)
        author = " / ".join(creators) or None

        resources: list[EpubResource] = []
        resources_by_member: dict[str, EpubResource] = {}
        resource_index = 1
        for item in manifest.values():
            media_type = item["media_type"]
            if media_type in _RASTER_MEDIA_TYPES:
                resource = EpubResource(f"r{resource_index}", item["member"], media_type)
                resource_index += 1
                resources.append(resource)
                resources_by_member[resource.member_path] = resource

        # EPUB3 identifies the cover bitmap with ``cover-image`` on the
        # manifest item; EPUB2 uses ``<meta name="cover" content="...">`` in
        # the OPF metadata.  Keep both forms as package identity so a cover
        # XHTML document can be excluded from reader chapters even when it
        # has no conventional ``p-cover`` filename or ``epub:type`` marker.
        cover_image_item_ids = {
            item_id
            for item_id, item in manifest.items()
            if "cover-image" in item["properties"].split()
        }
        for element in opf.iter():
            if _local_name(element.tag) != "meta":
                continue
            if (element.attrib.get("name") or "").strip().lower() != "cover":
                continue
            cover_id = (element.attrib.get("content") or "").strip()
            if cover_id in manifest:
                cover_image_item_ids.add(cover_id)
        cover_image_members = {
            manifest[item_id]["member"]
            for item_id in cover_image_item_ids
            if item_id in manifest
            and manifest[item_id]["media_type"] in _RASTER_MEDIA_TYPES
        }

        spine_by_member = {
            manifest[item_id]["member"]: index
            for index, item_id in enumerate(spine_ids)
        }
        labels_by_member: dict[str, str] = {}
        toc_members: set[str] = set()
        # EPUB2 books commonly publish their table of contents as NCX even
        # when the OPF has no EPUB3 nav item.  Prefer an EPUB3 nav when one is
        # present, then fill any gaps from NCX labels.
        ncx_item = next(
            (item for item in manifest.values() if item["media_type"] == "application/x-dtbncx+xml"),
            None,
        )
        if ncx_item is not None:
            ncx_blob = _read_member(archive, inventory, ncx_item["member"])
            # A malformed optional TOC may be ignored, but an explicit DTD or
            # entity declaration is never an ignorable parse failure.
            _reject_xml_declarations(ncx_blob, ncx_item["member"])
            try:
                ncx_labels = _parse_ncx_labels(
                        ncx_blob,
                        ncx_member=ncx_item["member"],
                    )
                labels_by_member.update(ncx_labels)
                toc_members.update(ncx_labels)
            except EpubPublicationError:
                pass
        nav_item = next((item for item in manifest.values() if "nav" in item["properties"].split()), None)
        if nav_item is not None:
            nav_blob = _read_member(archive, inventory, nav_item["member"])
            _reject_xml_declarations(nav_blob, nav_item["member"])
            try:
                nav_parser = _NavParser()
                nav_parser.feed(nav_blob.decode("utf-8"))
                for href, label in nav_parser.labels.items():
                    member, _fragment = _safe_href(nav_item["member"], href)
                    labels_by_member[member] = label
                for href in nav_parser.toc_hrefs:
                    member, _fragment = _safe_href(nav_item["member"], href)
                    toc_members.add(member)
            except (UnicodeDecodeError, EpubPublicationError):
                pass

        source_spine: list[EpubSourceSpine] = []
        for index, item_id in enumerate(spine_ids):
            item = manifest[item_id]
            try:
                source_blob = _read_member(archive, inventory, item["member"])
                _reject_xml_declarations(source_blob, item["member"])
                source = source_blob.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise EpubPublicationError(f"EPUB 章节不是 UTF-8 XHTML: {item['member']}") from exc
            canonical, ruby_hints = project_epub_xhtml(source)
            label = labels_by_member.get(item["member"], f"章节 {index + 1}")
            parser = _ControlledXhtml(
                chapter_member=item["member"],
                spine_by_member=spine_by_member,
                resources_by_member=resources_by_member,
            )
            parser.feed(source)
            parser.close()
            controlled_html = "".join(parser.parts)
            controlled_projection, controlled_hints = project_epub_xhtml(controlled_html)
            if controlled_projection != canonical or controlled_hints != ruby_hints:
                # Persisting a representation whose DOM would map to a
                # different Sentence coordinate space is worse than rejecting
                # an unsupported markup shape.  Keep this fail-closed so a
                # future renderer change cannot silently move anchors.
                raise EpubPublicationError(
                    f"EPUB 章节受控正文与规范投影不一致: {item['member']}"
                )
            source_spine.append(
                EpubSourceSpine(
                    index=index,
                    item_id=item_id,
                    member_path=item["member"],
                    label=label,
                    canonical_text=canonical,
                    controlled_html=controlled_html,
                    ruby_hints=ruby_hints,
                    image_only=not canonical.strip() and "<img" in controlled_html,
                    cover=(
                        "cover" in item["properties"].split()
                        or "p-cover" in item["member"]
                        or bool(re.search(r"(?:[A-Za-z_][\w.-]*:)?type\s*=\s*['\"]cover['\"]", source, re.IGNORECASE))
                        or (
                            not canonical.strip()
                            and any(
                                resource.member_path in cover_image_members
                                and f"__LJ_RESOURCE_{resource.resource_id}__" in controlled_html
                                for resource in resources
                            )
                        )
                    ),
                )
            )

        # A number of commercial EPUBs encode a chapter splash image as one
        # spine document followed immediately by its text body.  Keep the
        # package-level resources separate, but present that pair (and runs of
        # unlabelled front-matter image pages) as one reader chapter.  This
        # avoids a 24-item navigation for a book whose semantic TOC has seven
        # chapters while retaining source indices for future location mapping.
        groups: list[tuple[int, ...]] = []
        cursor = 0
        while cursor < len(source_spine):
            current = source_spine[cursor]
            if current.cover:
                cursor += 1
                continue
            if current.image_only:
                end = cursor + 1
                while end < len(source_spine) and source_spine[end].image_only and not source_spine[end].cover:
                    end += 1
                if current.member_path in toc_members and end < len(source_spine):
                    next_source = source_spine[end]
                    if not next_source.image_only and not next_source.cover:
                        end += 1
                groups.append(tuple(range(cursor, end)))
                cursor = end
                continue
            groups.append((cursor,))
            cursor += 1

        # A cover-only package is still useful as a publication resource, but
        # the current reader API requires at least one chapter.  Keep that
        # exceptional source item visible rather than returning an unusable
        # empty publication.
        if not groups and source_spine:
            groups.append((0,))

        source_to_chapter = {
            source_index: chapter_index
            for chapter_index, group in enumerate(groups)
            for source_index in group
        }
        chapters: list[EpubSpine] = []
        for chapter_index, group in enumerate(groups):
            first = source_spine[group[0]]
            label = first.label
            if label.startswith("章节 ") and first.item_id.startswith("p-fmatter"):
                label = "本編"
            fragments: list[str] = []
            for group_position, source_index in enumerate(group):
                if group_position:
                    # ``canonical_text`` joins source spine projections with
                    # one LF.  Keep this explicit rather than giving compiler
                    # wrappers accidental block semantics.
                    fragments.append('<br data-learningj-source-boundary="true">')
                fragments.append(
                    f'<section data-learningj-source-spine-index="{source_index}">'
                    f'{_remap_chapter_placeholders(source_spine[source_index].controlled_html, source_to_chapter)}'
                    "</section>"
                )
            chapters.append(
                EpubSpine(
                    index=chapter_index,
                    item_id=first.item_id,
                    member_path=first.member_path,
                    label=label,
                    canonical_text="\n".join(source_spine[index].canonical_text for index in group),
                    controlled_html="".join(fragments),
                    source_indices=tuple(group),
                )
            )

        identity = hashlib.sha256(blob + b"\x00" + EPUB_PROJECTION_VERSION.encode("utf-8")).hexdigest()
        return EpubPublication(
            title=title,
            projection_version=EPUB_PROJECTION_VERSION,
            publication_version=identity,
            spine=tuple(chapters),
            source_spine=tuple(source_spine),
            resources=tuple(resources),
            cover_resource_id=next(
                (
                    resource.resource_id
                    for resource in resources
                    if resource.member_path in cover_image_members
                ),
                next(
                    (
                        match.group(1)
                        for source in source_spine
                        if source.cover
                        for match in [re.search(r"__LJ_RESOURCE_(r[0-9]+)__", source.controlled_html)]
                        if match is not None
                    ),
                    None,
                ),
            ),
            author=author,
        )


_URL_ATTRIBUTE_RE = re.compile(
    r"(?P<name>(?<![\w:-])(?:src|href))(?P<equals>\s*=\s*)"
    r"(?P<quote>[\"'])(?P<value>.*?)(?P=quote)",
    re.IGNORECASE | re.DOTALL,
)


def _rewrite_start_tag_attributes(
    start_tag: str, rewrite: Callable[[str, str], str]
) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group("name")
        return (
            f"{name}{match.group('equals')}{match.group('quote')}"
            f"{rewrite(name, match.group('value'))}{match.group('quote')}"
        )

    return _URL_ATTRIBUTE_RE.sub(replace, start_tag)


class _HtmlAttributeRewriter(HTMLParser):
    """Rewrite selected start-tag attributes while preserving text nodes."""

    def __init__(self, rewrite: Callable[[str, str], str]) -> None:
        super().__init__(convert_charrefs=False)
        self.rewrite = rewrite
        self.parts: list[str] = []

    def _start_tag(self) -> str:
        raw = self.get_starttag_text()
        if raw is None:
            return ""
        return _rewrite_start_tag_attributes(raw, self.rewrite)

    def handle_starttag(self, _tag: str, _attrs: list[tuple[str, str | None]]) -> None:
        self.parts.append(self._start_tag())

    def handle_startendtag(
        self, _tag: str, _attrs: list[tuple[str, str | None]]
    ) -> None:
        self.parts.append(self._start_tag())

    def handle_endtag(self, tag: str) -> None:
        self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def handle_entityref(self, name: str) -> None:
        self.parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.parts.append(f"&#{name};")

    def handle_comment(self, data: str) -> None:
        self.parts.append(f"<!--{data}-->")

    def handle_decl(self, decl: str) -> None:
        self.parts.append(f"<!{decl}>")

    def unknown_decl(self, data: str) -> None:
        self.parts.append(f"<![{data}]>")


def _rewrite_html_attributes(
    html_text: str, rewrite: Callable[[str, str], str]
) -> str:
    parser = _HtmlAttributeRewriter(rewrite)
    parser.feed(html_text)
    parser.close()
    return "".join(parser.parts)


def replace_publication_placeholders(html_text: str, *, material_id: str) -> str:
    """Turn compiler placeholders into routes without rewriting visible text."""

    def rewrite(name: str, value: str) -> str:
        if name.lower() == "src":
            return re.sub(
                r"__LJ_RESOURCE_(r[0-9]+)__",
                lambda resource_match: (
                    f"/materials/{material_id}/publication/resources/"
                    f"{resource_match.group(1)}"
                ),
                value,
            )
        value = value.replace("__LJ_DISABLED_LINK__", "#")
        return re.sub(
            r"__LJ_CHAPTER_([0-9]+)__",
            lambda chapter_match: (
                f"/materials/{material_id}/publication/spine/"
                f"{chapter_match.group(1)}"
            ),
            value,
        )

    return _rewrite_html_attributes(html_text, rewrite)
