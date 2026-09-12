"""P1 契约面测试：OpenAPI 生成与素材 fixture（plan §3 P0 第 4 条 / P1）。

- OpenAPI 路径集合包含素材链端点（P1 新增词频索引与代次重建）；
  不含任何旧 AI 端点（analysis/questions/extract/retention），
  不暴露旧第二状态机字段；
- OpenAPI 与素材 fixture 的生成均可复现（两次运行字节相同）。
"""

from __future__ import annotations

import json

from learningj.api.export_openapi import build_openapi
from learningj.fixtures.material_fixture import build_fixture

EXPECTED_PATHS = {
    "/healthz",
    "/materials",
    "/materials/{material_id}/sentences",
    "/materials/{material_id}/sidecar",
    "/materials/{material_id}/lexeme-counts",
    "/materials/{material_id}/sidecar/rebuild",
    # P2 reader surface
    "/sentences/{sentence_id}/tokens",
    "/dictionaries",
    "/dictionaries/import",
    "/dictionaries/lookup",
    "/dictionaries/search",
    "/materials/{material_id}/annotations",
    "/annotations/{annotation_id}",
    "/lexemes/{lexeme_id}/decisions",
    "/lexemes/{lexeme_id}/evidence",
    "/lexemes/{lexeme_id}/evidence-summary",
    "/lexemes/known-views/batch",
    "/known-evidence/{evidence_id}/retractions",
}

# 旧第二状态机与旧端点的字段/路径，不得重新出现在契约面。
FORBIDDEN_MARKERS = (
    "session_closed",
    "turn_count",
    "extraction_status",
    "extraction_trigger",
    "follow_up_count",
    "/sentences/{sentence_id}/analysis",
    "/analyses",
    "/questions",
    "/extract",
    "/knowledge-points",
    "/retention",
)


def test_openapi_paths_include_material_surface() -> None:
    spec = build_openapi()
    # P2+ may add legal routes; the P1 material surface must remain present
    # without freezing the entire document to today's paths.
    assert EXPECTED_PATHS <= set(spec["paths"])


def test_openapi_has_no_legacy_state_machine_or_ghost_endpoints() -> None:
    spec = json.dumps(build_openapi(), ensure_ascii=False)
    for marker in FORBIDDEN_MARKERS:
        assert marker not in spec, f"契约面出现禁止标记: {marker}"


def test_openapi_generation_is_reproducible() -> None:
    first = json.dumps(build_openapi(), ensure_ascii=False, sort_keys=True)
    second = json.dumps(build_openapi(), ensure_ascii=False, sort_keys=True)
    assert first == second
    assert first.endswith("}")  # sanity：非空文档


def test_material_fixture_generation_is_reproducible() -> None:
    first = json.dumps(build_fixture(), ensure_ascii=False, sort_keys=True)
    second = json.dumps(build_fixture(), ensure_ascii=False, sort_keys=True)
    assert first == second


def test_material_fixture_content_covers_txt_and_srt() -> None:
    fixture = build_fixture()
    txt_sentences = fixture["sentences/txt"]
    srt_sentences = fixture["sentences/srt"]
    # BMP 外字符按 code point 成句（「𠮟」是单个码点）。
    assert txt_sentences[0]["text"] == "𠮟られた。"
    assert len(txt_sentences[0]["text"]) == 5
    assert txt_sentences[0]["anchor_type"] == "plain_text"
    assert len(srt_sentences) == 2
    assert srt_sentences[0]["anchor_type"] == "subtitle"
    assert srt_sentences[0]["anchor_payload"] == {"cue_index": 0}
    assert srt_sentences[0]["time_start"] == 1000
    # sidecar 携带版本戳与 token 化结果（analyzer_dict_version 命名空间是
    # SudachiDict 构建日期，不假设其格式，只要求非空）。
    sidecar = fixture["sidecar/txt"]
    assert sidecar["analyzer_dict_version"]
    assert sidecar["segmenter_version"].startswith("learningj-segmenter")
    assert sidecar["payload"]["sentences"][0]["tokens"][0]["surface"] == "𠮟"
    # 词频索引与 sidecar 代次一致，token 计数为正。
    counts = fixture["lexeme-counts/txt"]
    assert counts["sidecar_generation_id"] == sidecar["sidecar_generation_id"]
    assert counts["counts"]
    assert all(item["token_count"] > 0 for item in counts["counts"])
    # 素材 fixture 不含真实 UUID（已归一为确定性占位 id）。
    raw = json.dumps(fixture)
    assert "fixture-id-" in raw


def test_reader_fixture_generation_is_reproducible() -> None:
    from learningj.fixtures.reader_fixture import build_fixture

    first = json.dumps(build_fixture(), ensure_ascii=False, sort_keys=True)
    second = json.dumps(build_fixture(), ensure_ascii=False, sort_keys=True)
    assert first == second


def test_tracked_reader_fixture_matches_regeneration(tmp_path) -> None:
    """tracked reader-fixture.json 与当前代码再生成逐字节一致。"""
    from pathlib import Path

    from learningj.fixtures.reader_fixture import build_fixture

    regenerated = tmp_path / "reader-fixture.json"
    regenerated.write_text(
        json.dumps(build_fixture(), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    tracked = Path(__file__).resolve().parent.parent / "fixtures" / "reader-fixture.json"
    assert regenerated.read_bytes() == tracked.read_bytes()


def test_reader_fixture_content_covers_p2_surface() -> None:
    from learningj.fixtures.reader_fixture import build_fixture

    fixture = build_fixture()
    # token 视图：代次与版本戳齐全，code point 切片等于 surface，
    # 「次は君の番です！」一句的君/次/番 有真实词典 provenance。
    tokens = fixture["tokens/txt"]
    assert tokens["sidecar_generation_id"]
    assert tokens["analyzer_dict_version"]
    assert tokens["dictionary_sources"]
    assert any(token["dictionary_source_ids"] for token in tokens["tokens"])
    assert any(token["normalized_form"] == "君" for token in tokens["tokens"])
    sentence_text = "次は君の番です！"
    for token in tokens["tokens"]:
        assert "".join(list(sentence_text)[token["char_start"] : token["char_end"]]) == token["surface"]

    # 词典来源 provenance 与降级定义
    source = fixture["dictionary/source"]["source"]
    assert source["display_name"] == "fixture-辞書"
    lookup = fixture["dictionary/lookup"]
    assert lookup["entries"]
    assert all(entry["definitions"] for entry in lookup["entries"])

    # 划线：BMP 外样本「𠮟られた」切片回读一致并对齐 token
    annotation = fixture["annotations/txt"]
    span = annotation["spans"][0]
    assert span["surface"] == "𠮟られた"
    assert span["alignment_status"] == "aligned"
    assert span["char_start"] == 0 and span["char_end"] == 4

    # 证据链：known 裁定 + 引用的 user_asserted KE + 同事务摘要
    decision = fixture["evidence/decision"]
    assert decision["decision"] == "known" and decision["evidence_id"]
    assert decision["created_at"] == "fixture-timestamp"  # 时间戳归一
    summary = fixture["evidence/summary"]
    lexeme_scope = next(
        s for s in summary["scopes"] if s["scope_form_key"] == "lexeme:"
    )
    assert lexeme_scope["current_decision"] == "known"
    assert lexeme_scope["valid_source_counts"] == {"user_asserted": 1}
    assert fixture["evidence/known-views"]["items"][0]["effective"]["state"] == "known"

    raw = json.dumps(fixture)
    assert "fixture-id-" in raw
    assert "fixture-timestamp" in raw
