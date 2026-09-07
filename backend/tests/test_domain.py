"""domain 层单元测试：uuid7 单调性、code point 切片、文本规范化、lexeme_id 派生。"""

from __future__ import annotations

import uuid

import pytest

from learningj.domain.ids import new_uuid7
from learningj.domain.lexeme import derive_lexeme_id
from learningj.domain.offsets import (
    code_point_len,
    normalize_text,
    slice_by_code_point,
)


class TestUuid7:
    def test_shape_is_valid_uuid(self) -> None:
        value = new_uuid7()
        assert value.version == 7
        assert value.variant == uuid.RFC_4122

    def test_monotonic_within_same_call_site(self) -> None:
        values = [new_uuid7() for _ in range(1000)]
        assert values == sorted(values)
        assert len(set(values)) == 1000


class TestOffsets:
    def test_code_point_len_counts_code_points_not_utf16(self) -> None:
        # '𠮟' 是 BMP 外字符：UTF-16 长度为 2，code point 长度为 1。
        text = "𠮟られた"
        assert code_point_len(text) == 4
        assert len(text.encode("utf-16-le")) // 2 == 5

    def test_slice_by_code_point_with_astral_chars(self) -> None:
        text = "𠮟られた"
        assert slice_by_code_point(text, 0, 1) == "𠮟"
        assert slice_by_code_point(text, 1, 3) == "られ"

    def test_slice_rejects_bad_ranges(self) -> None:
        with pytest.raises(ValueError):
            slice_by_code_point("abc", 2, 1)
        with pytest.raises(ValueError):
            slice_by_code_point("abc", 0, 4)
        with pytest.raises(ValueError):
            slice_by_code_point("abc", -1, 2)

    def test_normalize_text_nfc_and_lf(self) -> None:
        # U+30AC (ガ) vs U+30AB + U+3099 (カ + combining):NFC 合并。
        composed = "ガ"
        decomposed = "ガ"
        assert normalize_text(decomposed) == composed
        assert normalize_text("a\r\nb\rc") == "a\nb\nc"
        # 不做全角/半角折叠、不删空白。
        assert normalize_text("Ａ ｂ") == "Ａ ｂ"


class TestLexemeId:
    def test_deterministic(self) -> None:
        a = derive_lexeme_id("食べる", "動詞,非自律", "たべる")
        b = derive_lexeme_id("食べる", "動詞,非自律", "たべる")
        assert a == b
        assert a.startswith("lx_")

    def test_different_triple_different_id(self) -> None:
        assert derive_lexeme_id("食べる", "動詞", "たべる") != derive_lexeme_id(
            "食べる", "動詞", "たべす"
        )

    def test_analyzer_dict_version_not_an_input(self) -> None:
        """§2.1 约束 1：词典版本不参与派生（函数签名里根本没有它）。"""
        assert derive_lexeme_id("食べる", "動詞", "たべる") == derive_lexeme_id(
            "食べる", "動詞", "たべる"
        )

    def test_nfc_insensitive(self) -> None:
        decomposed = "ガ" + "る"
        assert derive_lexeme_id("ガる", "pos", "r") == derive_lexeme_id(
            decomposed, "pos", "r"
        )
