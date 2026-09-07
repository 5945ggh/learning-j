"""文本规范与 code point 偏移的纯函数（`data-model.md` §0）。

- 进入 `Material` / `Sentence` 的文本统一 Unicode NFC，换行统一 LF；
- 所有持久化 `char_start` / `char_end` 以 Unicode code point 计，
  半开区间 `[start, end)`。

Python 的 `str` 本身就是 code point 序列，但业务代码必须经由本模块的
函数表达契约，与前端 `sliceByCodePoint`（`Array.from`）互为镜像，
不得散落直接切片。
"""

from __future__ import annotations

import unicodedata


def normalize_text(text: str) -> str:
    """素材/句子文本入库前的规范化：NFC + 换行统一为 LF。

    不做全角/半角折叠，不删除原文空白。
    """
    normalized = unicodedata.normalize("NFC", text)
    return normalized.replace("\r\n", "\n").replace("\r", "\n")


def code_point_len(text: str) -> int:
    """文本的 Unicode code point 长度。"""
    return len(list(text))


def slice_by_code_point(text: str, start: int, end: int) -> str:
    """按 code point 半开区间 `[start, end)` 切片。

    与 `data-model.md` §1 约束 1 一致：字符区间是权威值。
    越界或区间非法时抛 `ValueError`，由调用方决定降级方式。
    """
    if start < 0:
        raise ValueError(f"char_start must be >= 0, got {start}")
    if end < start:
        raise ValueError(f"char_end ({end}) must be >= char_start ({start})")
    chars = list(text)
    if end > len(chars):
        raise ValueError(
            f"char_end ({end}) exceeds code point length ({len(chars)})"
        )
    return "".join(chars[start:end])
