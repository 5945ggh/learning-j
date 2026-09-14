"""安全的 EPUB package 解析与受控 reader projection。

这个模块只处理 publication 边界：ZIP/OCF 路径、OPF manifest/spine、图片资源
allowlist 和非脚本 XHTML。语言层的 canonical text 仍由 ingest.service 的
``_TextExtractor`` 产生，避免 reader representation 偷换 Sentence 坐标。
"""

from __future__ import annotations

import hashlib
import html
import io
import posixpath
import re
import zipfile
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import PurePosixPath
from typing import Callable
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree

EPUB_PROJECTION_VERSION = "learningj-epub-publication-v2"
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

    def as_manifest(self, source_sha256: str) -> dict[str, object]:
        return {
            "title": self.title,
            "projection_version": self.projection_version,
            "publication_version": self.publication_version,
            "source_sha256": source_sha256,
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
            "source_spine": [
                {
                    "index": item.index,
                    "item_id": item.item_id,
                    "member_path": item.member_path,
                    "label": item.label,
                    "canonical_text": item.canonical_text,
                    "controlled_html": item.controlled_html,
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
    decoded = unquote(name)
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

    parsed = urlsplit(unquote(href))
    if parsed.scheme or parsed.netloc:
        raise EpubPublicationError("EPUB 不支持外部 publication 资源")
    target = parsed.path or ""
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


def _parse_xml(blob: bytes, resource: str) -> ElementTree.Element:
    # ElementTree does not fetch external entities, but rejecting declarations
    # explicitly makes the boundary independent of parser implementation.
    upper = blob[:4096].upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise EpubPublicationError(f"{resource} 不允许 DOCTYPE/外部实体")
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
    def replace(match: re.Match[str]) -> str:
        source_index = int(match.group(1))
        chapter_index = source_to_chapter.get(source_index, source_index)
        return f"__LJ_CHAPTER_{chapter_index}__"

    return re.sub(r"__LJ_CHAPTER_([0-9]+)__", replace, html_text)


_SAFE_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,127}$")
_DROP_WITH_CONTENT = {
    "script", "style", "nav", "head", "iframe", "object", "embed", "form",
    "input", "button", "textarea", "select", "option", "video", "audio", "canvas",
}
_TRANSPARENT_TAGS = {"html", "body", "main", "article", "section", "figure", "figcaption", "dl", "dt", "dd", "table", "thead", "tbody", "tr", "td", "th"}
_VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
_ALLOWED_TAGS = {
    "p", "div", "blockquote", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6",
    "span", "em", "strong", "b", "i", "ruby", "rb", "rt", "rp", "br", "img", "a",
}


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
        if tag == "svg":
            # SVG itself is never exposed to the browser.  Safe local bitmap
            # descendants are projected to ordinary <img> elements instead.
            self.svg_stack.append(tag)
            return
        if tag in _DROP_WITH_CONTENT:
            self.skip_depth = 1
            return
        raw_attrs = {key.lower(): value for key, value in attrs}
        if "hidden" in raw_attrs or raw_attrs.get("aria-hidden", "").lower() == "true":
            self.skip_depth = 1
            return
        if tag in _TRANSPARENT_TAGS:
            return
        if tag not in _ALLOWED_TAGS:
            # Unknown inline/block markup is transparent, but its attributes
            # never cross into the controlled surface.
            return
        raw = raw_attrs
        if tag == "img":
            try:
                member, _fragment = _safe_href(self.chapter_member, raw.get("src", ""))
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
        if was_skipping or self.svg_stack or tag.lower() in _VOID_TAGS:
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
        if not self.skip_depth:
            self.parts.append(html.escape(data, quote=False))

    def handle_comment(self, _data: str) -> None:
        return


def _canonical_projection(source: str) -> tuple[str, tuple[dict[str, object], ...]]:
    # Local import avoids the ingest.service ↔ epub module import cycle.
    from learningj.ingest.service import _TextExtractor
    from learningj.domain.offsets import normalize_text

    parser = _TextExtractor()
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
        container = _parse_xml(_read_member(archive, inventory, "META-INF/container.xml"), "container.xml")
        rootfiles = [element for element in container.iter() if _local_name(element.tag) == "rootfile"]
        if not rootfiles:
            raise EpubPublicationError("EPUB 缺少 OPF rootfile")
        rootfile = rootfiles[0].attrib.get("full-path")
        if not rootfile:
            raise EpubPublicationError("EPUB rootfile 路径为空")
        opf_member = _safe_member_path(rootfile)
        opf = _parse_xml(_read_member(archive, inventory, opf_member), "OPF")
        package_dir = posixpath.dirname(opf_member)
        manifest: dict[str, dict[str, str]] = {}
        for element in opf.iter():
            if _local_name(element.tag) != "item":
                continue
            item_id = element.attrib.get("id")
            href = element.attrib.get("href")
            media_type = element.attrib.get("media-type", "").lower()
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

        resources: list[EpubResource] = []
        resources_by_member: dict[str, EpubResource] = {}
        resource_index = 1
        for item in manifest.values():
            media_type = item["media_type"]
            if media_type.startswith("image/") and media_type != "image/svg+xml":
                resource = EpubResource(f"r{resource_index}", item["member"], media_type)
                resource_index += 1
                resources.append(resource)
                resources_by_member[resource.member_path] = resource

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
            try:
                ncx_labels = _parse_ncx_labels(
                        _read_member(archive, inventory, ncx_item["member"]),
                        ncx_member=ncx_item["member"],
                    )
                labels_by_member.update(ncx_labels)
                toc_members.update(ncx_labels)
            except EpubPublicationError:
                pass
        nav_item = next((item for item in manifest.values() if "nav" in item["properties"].split()), None)
        if nav_item is not None:
            try:
                nav_parser = _NavParser()
                nav_parser.feed(_read_member(archive, inventory, nav_item["member"]).decode("utf-8"))
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
                source = _read_member(archive, inventory, item["member"]).decode("utf-8")
            except UnicodeDecodeError as exc:
                raise EpubPublicationError(f"EPUB 章节不是 UTF-8 XHTML: {item['member']}") from exc
            canonical, ruby_hints = _canonical_projection(source)
            label = labels_by_member.get(item["member"], f"章节 {index + 1}")
            parser = _ControlledXhtml(
                chapter_member=item["member"],
                spine_by_member=spine_by_member,
                resources_by_member=resources_by_member,
            )
            parser.feed(source)
            parser.close()
            controlled_html = "".join(parser.parts)
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
                        or bool(re.search(r"epub:(?:type|TYPE)\s*=\s*['\"]cover['\"]", source))
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
                groups.append((cursor,))
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
            fragments = [
                (
                    f'<section data-learningj-source-spine-index="{source_index}">'
                    f'{_remap_chapter_placeholders(source_spine[source_index].controlled_html, source_to_chapter)}'
                    "</section>"
                )
                for source_index in group
            ]
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
        )


def replace_publication_placeholders(html_text: str, *, material_id: str) -> str:
    """Turn opaque compiler placeholders into same-origin controlled routes."""

    html_text = re.sub(
        r"__LJ_RESOURCE_(r[0-9]+)__",
        lambda match: f"/materials/{material_id}/publication/resources/{match.group(1)}",
        html_text,
    )
    return re.sub(
        r"__LJ_CHAPTER_([0-9]+)__",
        lambda match: f"/materials/{material_id}/publication/spine/{match.group(1)}",
        html_text,
    )
