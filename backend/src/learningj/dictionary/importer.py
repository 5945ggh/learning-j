"""Yomitan ZIP 导入的解析与校验层（`data-model.md` §2.0，ADR-032）。

本模块是纯解析层：只读取字节、产出 canonical 形状的候选数据，**不做任何
数据库 I/O**（§11.3：文件读取与解析不持有数据库写事务）。数据库持久化
在 `dictionary/service.py` 的短事务内完成。

安全边界（ADR-032）：

- 阻止路径穿越（绝对路径、盘符、`..`、反斜杠路径、空名、重名）；
- 限制文件数与压缩/解压总大小、单文件解压大小（解压炸弹防护按实际读取
  字节复核，不信任中央目录声明）；
- 损坏 ZIP、缺失/损坏 index、未知 term bank 结构、重复资源都给出带定位
  信息的错误；
- 同一 archive hash 的重复导入由 service 层幂等，本层不关心。

Yomitan 约定：`index.json`（title/revision 必需）+ `term_bank_N.json`
（term bank v1 行结构）+ 可选 `term_meta_bank_N.json`（本包不解析，统计
记录并跳过）+ 其余文件作为资源（DictionaryAsset）保存。
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePosixPath

# MVP 默认上限（ADR-032：限制文件数与压缩/解压大小；取值为本包落地面，
# 不是性能承诺）。
MAX_ARCHIVE_FILES = 4096
MAX_TOTAL_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
MAX_FILE_UNCOMPRESSED_BYTES = 128 * 1024 * 1024
MAX_INDEX_BYTES = 4 * 1024 * 1024

_TERM_BANK_RE = re.compile(r"^term_bank_(\d+)\.json$")
_TERM_META_BANK_RE = re.compile(r"^term_meta_bank_(\d+)\.json$")

# index.json 的 format 声明（官方 schema：整数枚举 1–3，`version` 为别名）。
# 本导入器显式解析两种声明：format 1（及无 format 声明的 term bank v1 旧布局）
# 与 format 3（当前 Yomitan 主流导出格式；term bank v3 为八列行，释义数组
# 中的项可为 structured-content 对象，由逐行/逐释义项校验严格解析）。
# format 2 是历史遗留版本，不做显式适配，继续拒绝；未知声明一律按
# ADR-032「未知 schema 给出定位信息」拒绝，不猜测行语义。
SUPPORTED_INDEX_FORMATS = frozenset({1, 3})
DEFAULT_SCHEMA_VERSION = "term_bank_v1"


class DictionaryImportError(ValueError):
    """携带定位信息的导入失败（损坏、未知 schema、越界、重复资源等）。"""


@dataclass(frozen=True)
class ParsedDefinition:
    ordinal: int
    plain_text: str
    structured_content: dict | None


@dataclass(frozen=True)
class ParsedEntry:
    source_local_id: str
    expression: str
    reading: str | None
    tags: list[str]
    score: int
    sequence: int | None
    definitions: list[ParsedDefinition]


@dataclass(frozen=True)
class ParsedAsset:
    relative_path: str
    mime_type: str | None
    content_hash: str
    content: bytes


@dataclass(frozen=True)
class ParsedDictionaryArchive:
    archive_hash: str
    display_name: str
    source_version: str
    schema_version: str
    sequenced: bool
    license_metadata: dict | None
    entries: list[ParsedEntry]
    assets: list[ParsedAsset]
    stats: dict = field(default_factory=dict)


def _fail(location: str, message: str) -> None:
    raise DictionaryImportError(f"{location}: {message}")


def _safe_member_name(name: str) -> PurePosixPath:
    """校验 ZIP 成员名，拒绝一切穿越/绝对/反斜杠形式（ADR-032）。"""
    if not name or name.endswith("/"):
        _fail(f"成员 {name!r}", "空路径或目录项")
    if "\\" in name:
        _fail(f"成员 {name!r}", "路径含反斜杠（非 Yomitan 约定，拒绝解析）")
    path = PurePosixPath(name)
    if path.is_absolute() or name.startswith("/"):
        _fail(f"成员 {name!r}", "绝对路径")
    if re.match(r"^[A-Za-z]:", name):
        _fail(f"成员 {name!r}", "盘符路径")
    parts = path.parts
    if any(part in {"..", "."} for part in parts):
        _fail(f"成员 {name!r}", "路径穿越（'..' 或 '.' 分量）")
    return path


def _member_mime(name: str) -> str | None:
    suffix = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    return {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "svg": "image/svg+xml",
        "mp3": "audio/mpeg",
        "ogg": "audio/ogg",
        "wav": "audio/wav",
        "css": "text/css",
        "json": "application/json",
        "txt": "text/plain",
    }.get(suffix)


def _definition_plain_text(gloss: object) -> tuple[str, dict | None]:
    """把一个 glossary 项投影为 (纯文本, 结构化内容)。

    字符串即纯文本释义；对象是 structured content（保留原始 payload，
    收集其中全部 `text` 字段与 content 数组裸字符串作降级显示投影，资源
    缺失时定义仍可读）；单元素字典数组是导出器对 structured-content 的
    包裹，递归取其内容；整型是旧式 sequenced 词典的序列交叉引用，按
    确定性投影保留指向信息；旧式异构数组按 legacy 项保留并拼接字符串
    分量。其他类型按未知 schema 拒绝。
    """
    if isinstance(gloss, str):
        return gloss, None
    if isinstance(gloss, int) and not isinstance(gloss, bool):
        return f"→ sequence {gloss}", None
    if isinstance(gloss, list) and len(gloss) == 1 and isinstance(gloss[0], dict):
        return _definition_plain_text(gloss[0])
    if isinstance(gloss, dict):
        texts: list[str] = []

        def collect(node: object) -> None:
            if isinstance(node, dict):
                value = node.get("text")
                if isinstance(value, str):
                    texts.append(value)
                for key, child in node.items():
                    if key == "content" and isinstance(child, str):
                        texts.append(child)
                    elif key == "content" and isinstance(child, list):
                        # format 3 常见紧凑写法：content 数组里的裸字符串就是
                        # 文本节点；相邻裸字符串合并为一个文本块，其余节点
                        # 递归；data/style 等属性值不入投影。
                        buffer: list[str] = []
                        for item in child:
                            if isinstance(item, str):
                                buffer.append(item)
                                continue
                            if buffer:
                                texts.append("".join(buffer))
                                buffer = []
                            collect(item)
                        if buffer:
                            texts.append("".join(buffer))
                    elif isinstance(child, (dict, list)):
                        collect(child)
            elif isinstance(node, list):
                for child in node:
                    collect(child)

        collect(gloss)
        return "\n".join(t for t in texts if t), gloss
    if isinstance(gloss, list):
        strings = [item for item in gloss if isinstance(item, str)]
        return "\n".join(strings), {"legacy": gloss}
    _fail("glossary 项", f"不支持的释义类型 {type(gloss).__name__}")


def _parse_term_bank(
    bank_name: str, raw: bytes, sequenced: bool, *, format3: bool
) -> list[ParsedEntry]:
    try:
        rows = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DictionaryImportError(f"{bank_name}: JSON 解析失败（{exc}）") from exc
    if not isinstance(rows, list):
        _fail(bank_name, "term bank 顶层必须是数组（term bank v1/v3）")
    entries: list[ParsedEntry] = []
    sequence_by_head: dict[tuple[str, str], int] = {}
    for row_index, row in enumerate(rows):
        location = f"{bank_name}[{row_index}]"
        if not isinstance(row, list):
            _fail(location, "term bank 行必须是数组")
        if format3 and len(row) != 8:
            _fail(
                location,
                "term bank v3 行必须恰好 8 列 "
                "（expression/reading/definitionTags/rules/score/definitions/sequence/termTags）",
            )
        if not format3 and len(row) < 5:
            _fail(location, "term bank v1 行至少 5 列（expression/reading/tags/rules/score）")
        expression, reading = row[0], row[1]
        if not isinstance(expression, str) or not expression:
            _fail(location, "expression 必须是非空字符串")
        if not isinstance(reading, str):
            _fail(location, "reading 必须是字符串")
        # 官方约定：空读音表示与 expression 相同。
        reading = reading or expression
        head = (expression, reading)
        tags: list[str] = []
        tag_fields = ((2, row[2]), (3, row[3]))
        if format3:
            definition_values = row[5]
            if not isinstance(definition_values, list):
                _fail(location, "第 5 列（definitions）必须是数组")
            sequence_value = row[6]
            if isinstance(sequence_value, bool) or not isinstance(sequence_value, int):
                _fail(location, "第 6 列（sequence）必须是整数")
            term_tags = row[7]
            if not isinstance(term_tags, str):
                _fail(location, "第 7 列（termTags）必须是字符串")
            tag_fields = (*tag_fields, (7, term_tags))
            sequence = sequence_value if sequenced else None
        else:
            definition_values = row[5:]
            sequence = None
            if sequenced:
                sequence = sequence_by_head.setdefault(head, len(sequence_by_head))
        for field_index, tag_field in tag_fields:
            if tag_field is None and field_index == 2:
                continue  # 官方 schema：definitionTags 允许 null，等同空串。
            if not isinstance(tag_field, str):
                _fail(location, f"第 {field_index} 列（tags/rules）必须是字符串")
            for tag in tag_field.split(" "):
                if tag and tag not in tags:
                    tags.append(tag)
        score = row[4]
        if isinstance(score, bool) or not isinstance(score, (int, float)):
            _fail(location, "score 必须是数字")
        if isinstance(score, float):
            if not score.is_integer():
                _fail(location, f"score {score!r} 不是整数（canonical 模型的 score 为整数）")
            score = int(score)
        definitions: list[ParsedDefinition] = []
        for ordinal, gloss in enumerate(definition_values):
            plain_text, structured = _definition_plain_text(gloss)
            definitions.append(
                ParsedDefinition(ordinal=ordinal, plain_text=plain_text, structured_content=structured)
            )
        entries.append(
            ParsedEntry(
                source_local_id=f"{bank_name}:{row_index}",
                expression=expression,
                reading=reading,
                tags=tags,
                score=score,
                sequence=sequence,
                definitions=definitions,
            )
        )
    return entries


def parse_yomitan_archive(blob: bytes) -> ParsedDictionaryArchive:
    """把 Yomitan ZIP 解析为 canonical 候选数据（无数据库 I/O）。"""
    archive_hash = hashlib.sha256(blob).hexdigest()
    try:
        archive = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile as exc:
        raise DictionaryImportError(f"档案损坏或不是 ZIP 文件（{exc}）") from exc
    with archive:
        infos = [info for info in archive.infolist() if not info.is_dir()]
        if not infos:
            raise DictionaryImportError("档案为空")
        if len(infos) > MAX_ARCHIVE_FILES:
            raise DictionaryImportError(
                f"档案包含 {len(infos)} 个文件，超过上限 {MAX_ARCHIVE_FILES}"
            )
        names: set[str] = set()
        total_uncompressed = 0
        members: dict[str, zipfile.ZipInfo] = {}
        for info in infos:
            canonical_path = _safe_member_name(info.filename)
            canonical_name = canonical_path.as_posix()
            if canonical_name in names:
                _fail(f"成员 {info.filename!r}", "重复的成员名")
            names.add(canonical_name)
            if info.file_size > MAX_FILE_UNCOMPRESSED_BYTES:
                _fail(
                    f"成员 {info.filename!r}",
                    f"解压后 {info.file_size} 字节，超过单文件上限 {MAX_FILE_UNCOMPRESSED_BYTES}",
                )
            total_uncompressed += info.file_size
            if total_uncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES:
                raise DictionaryImportError(
                    f"档案解压总量超过上限 {MAX_TOTAL_UNCOMPRESSED_BYTES} 字节"
                )
            members[canonical_name] = info

        index_info = members.get("index.json")
        if index_info is None:
            raise DictionaryImportError("缺少 index.json（Yomitan 档案必需）")
        try:
            index = json.loads(archive.read(index_info).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise DictionaryImportError(f"index.json: JSON 解析失败（{exc}）") from exc
        if not isinstance(index, dict):
            raise DictionaryImportError("index.json: 顶层必须是对象")
        title = index.get("title")
        revision = index.get("revision")
        if not isinstance(title, str) or not title:
            raise DictionaryImportError("index.json: 缺少非空 title")
        if isinstance(revision, bool) or not isinstance(revision, (str, int)):
            raise DictionaryImportError("index.json: 缺少 revision（字符串或整数）")
        format_value = index.get("format", index.get("version"))
        if format_value is None:
            schema_version = DEFAULT_SCHEMA_VERSION
        elif isinstance(format_value, bool) or not isinstance(format_value, int):
            raise DictionaryImportError(
                f"index.json: 非法的 schema 声明 format={format_value!r}（官方 schema 为整数 1–3）"
            )
        elif format_value not in SUPPORTED_INDEX_FORMATS:
            raise DictionaryImportError(
                f"index.json: format={format_value} 不受支持（本导入器解析 format 1 / "
                "无 format 声明的 term bank v1 布局，以及 format 3；format 2 为历史遗留"
                "版本，不做适配；未知行结构按 ADR-032 拒绝而非猜测）"
            )
        else:
            schema_version = f"yomitan_format_{format_value}"
        sequenced = bool(index.get("sequenced", False))
        # index 的其余字段（author/url/indexUrl 等）整体保留为许可元数据。
        license_metadata = {
            key: value
            for key, value in index.items()
            if key not in {"title", "revision", "format", "version", "sequenced"}
        }

        bank_names = sorted(
            (name for name in names if _TERM_BANK_RE.match(name)),
            key=lambda name: int(_TERM_BANK_RE.match(name).group(1)),  # type: ignore[union-attr]
        )
        if not bank_names:
            raise DictionaryImportError("未找到 term_bank_*.json（term bank v1 布局）")
        meta_bank_count = sum(1 for name in names if _TERM_META_BANK_RE.match(name))

        entries: list[ParsedEntry] = []
        for bank_name in bank_names:
            info = members[bank_name]
            raw = archive.read(info)
            entries.extend(
                _parse_term_bank(bank_name, raw, sequenced, format3=format_value == 3)
            )

        assets: list[ParsedAsset] = []
        for name in sorted(names):
            if name == "index.json" or _TERM_BANK_RE.match(name) or _TERM_META_BANK_RE.match(name):
                continue
            info = members[name]
            content = archive.read(info)
            assets.append(
                ParsedAsset(
                    relative_path=name,
                    mime_type=_member_mime(name),
                    content_hash=hashlib.sha256(content).hexdigest(),
                    content=content,
                )
            )

        return ParsedDictionaryArchive(
            archive_hash=archive_hash,
            display_name=title,
            source_version=str(revision),
            schema_version=schema_version,
            sequenced=sequenced,
            license_metadata=license_metadata or None,
            entries=entries,
            assets=assets,
            stats={
                "bank_files": len(bank_names),
                "meta_bank_files": meta_bank_count,
                "entry_rows": len(entries),
                "asset_files": len(assets),
                "asset_bytes": sum(len(asset.content) for asset in assets),
            },
        )
