"""Lexeme 身份的确定性派生（`data-model.md` §2.1）。

- `lexeme_id` 由 `normalized_form + pos + reading_form` 三元组哈希派生，
  是确定性自然键的投影，**不是自签发 ID**；
- **`analyzer_dict_version` 不参与派生**（§2.1 约束 1）：三元组不变时 id
  天然稳定，SudachiDict 升级只影响 `normalized_form` 漂移的那一小部分
  记录，映射表规模因此从全库降到实际漂移的条目；
- Lexeme 不参与 KnowledgePoint 的 ID 空间：无 `canonical_id`、不进别名表。
"""

from __future__ import annotations

import hashlib
import unicodedata

# 单元分隔符，不出现在 Sudachi 的 normalized_form / POS / reading 中，
# 保证三元组拼接无歧义。
_SEPARATOR = "\x1f"
_PREFIX = "lx_"


def derive_lexeme_id(normalized_form: str, pos: str, reading_form: str) -> str:
    """由三元组确定性派生 `lexeme_id`。

    同一三元组在任何时候、任何进程中得到同一 id；调用方不得把
    词典版本、模型版本等任何版本戳掺入输入。
    """
    parts = (
        unicodedata.normalize("NFC", normalized_form),
        unicodedata.normalize("NFC", pos),
        unicodedata.normalize("NFC", reading_form),
    )
    joined = _SEPARATOR.join(parts)
    digest = hashlib.sha256(joined.encode("utf-8")).hexdigest()
    return f"{_PREFIX}{digest}"
