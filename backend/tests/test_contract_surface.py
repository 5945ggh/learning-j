"""P0 契约面测试：OpenAPI 生成与素材 fixture（plan §3 P0 第 4 条）。

- OpenAPI 路径集合精确等于现有素材端点；不含任何旧 AI 端点
  （analysis/questions/extract/retention），不暴露旧第二状态机字段；
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


def test_openapi_paths_are_exactly_the_material_surface() -> None:
    spec = build_openapi()
    assert set(spec["paths"]) == EXPECTED_PATHS


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
    # 素材 fixture 不含真实 UUID（已归一为确定性占位 id）。
    raw = json.dumps(fixture)
    assert "fixture-id-" in raw
