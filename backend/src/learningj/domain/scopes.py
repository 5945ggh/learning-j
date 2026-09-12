"""词形作用域键的确定性派生（`data-model.md` §0、§2.2，ADR-040）。

`scope_form_key` 是确定性、非空的作用域键：

- Lexeme 级为 ``lexeme:``；
- 具体词形为 ``form:`` 加该原词形的 Unicode NFC 结果。

具体词形不得 trim，也不做大小写、全角／半角或其他宽窄折叠；空具体词形
直接拒绝。KnownEvidence 与 LexemeKnowledgeDecision 必须使用同一派生规则
（本模块是该规则的唯一实现）；唯一性与查询索引使用
``(lexeme_id, scope_form_key)``，不依赖 NULL 的唯一性行为。
"""

from __future__ import annotations

import unicodedata

LEXEME_SCOPE_KEY = "lexeme:"
FORM_SCOPE_PREFIX = "form:"

# 消解规则版本：把原始输入映射到 Lexeme + 作用域键的规则编号。
# 规则变化（例如引入宽窄折叠）必须换新版本号，不得改写旧记录。
SCOPE_RESOLVER_VERSION = "learningj-scope-resolver-v1"

# 已知状态求值（known view 组合）的规则版本（data-model §2.5）。
KNOWN_RULE_VERSION = "learningj-known-rule-v1"


def derive_scope_form_key(conjugated_form: str | None) -> str:
    """由具体词形派生作用域键；``None`` 表示 Lexeme 级证据。

    空字符串（含调用方显式传入的 ``""``）直接拒绝——空词形既不是合法的
    具体词形，也不允许被静默当作 Lexeme 级证据。
    """
    if conjugated_form is None:
        return LEXEME_SCOPE_KEY
    form = unicodedata.normalize("NFC", conjugated_form)
    if not form:
        raise ValueError("空具体词形不能派生词形作用域键")
    return f"{FORM_SCOPE_PREFIX}{form}"
