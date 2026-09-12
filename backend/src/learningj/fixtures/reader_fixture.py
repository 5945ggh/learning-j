"""阅读器 P2 fixture 生成（`CURRENT-PACKETS.md` P2-backend：reader fixtures）。

在真实重建的开发基线库上通过 TestClient 走完 P2 公开契约面，把响应归一
成确定性 JSON（UUID → ``fixture-id-*``，ISO 时间戳 → ``fixture-timestamp``）：
素材链来自 material fixture 的同一样本，词典是一个代码内构造的确定性
Yomitan ZIP（ZIP_STORED + 固定 date_time），证据裁定作用于 fixture 句子的
真实 lexeme。两次运行字节相同，P2-frontend/P2-integration 可锁定。

命令（backend/ 目录下执行）::

    uv run python -m learningj.fixtures.reader_fixture \
        --out fixtures/reader-fixture.json
"""

from __future__ import annotations

import argparse
import io
import json
import re
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from learningj.api.app import create_app
from learningj.db.maintenance import rebuild_development_database

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)

_FIXED_TIME = (2026, 9, 12, 0, 0, 0)

# 词库内容是固定样本：与 fixture 句子里的「君」「次」「番」「頑張る」对应，
# 让 token provenance 与精确查找有真实命中。
_TERM_BANK: list[list[Any]] = [
    ["君", "きみ", "代名詞", "", 8, "you", {"type": "text", "text": "第二人称代词"}],
    ["次", "つぎ", "名詞", "", 7, "next", {"type": "image", "path": "img/fixture.png", "text": "next (image)"}],
    ["番", "ばん", "名詞", "", 6, "turn", "one's turn"],
    ["頑張る", "がんばる", "動詞", "v5", 9, "to persevere", "to do one's best"],
]
_INDEX: dict[str, Any] = {
    "title": "fixture-辞書",
    "revision": "2026-09-12",
    "sequenced": True,
    "author": "learningj-fixture",
}
_ASSET_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360000002000154a24f4f0000000049454e44ae426082"
)


def build_fixture_yomitan_zip() -> bytes:
    """确定性 Yomitan ZIP：ZIP_STORED + 固定 date_time，字节级可复现。"""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        for name, content in (
            ("index.json", json.dumps(_INDEX, ensure_ascii=False)),
            (
                "term_bank_1.json",
                json.dumps(_TERM_BANK, ensure_ascii=False),
            ),
            ("img/fixture.png", _ASSET_PNG),
        ):
            info = zipfile.ZipInfo(name, date_time=_FIXED_TIME)
            info.external_attr = 0o644 << 16
            archive.writestr(info, content if isinstance(content, bytes) else content.encode("utf-8"))
    return buffer.getvalue()


def _normalize(node: Any, uuids: dict[str, str]) -> Any:
    """UUID → 确定性占位 id；ISO 时间戳 → fixture-timestamp。"""
    if isinstance(node, dict):
        return {key: _normalize(value, uuids) for key, value in node.items()}
    if isinstance(node, list):
        return [_normalize(item, uuids) for item in node]
    if isinstance(node, str):
        if _UUID.fullmatch(node):
            if node not in uuids:
                uuids[node] = f"fixture-id-{len(uuids) + 1:03d}"
            return uuids[node]
        if _TIMESTAMP.fullmatch(node):
            return "fixture-timestamp"
    return node


def build_fixture() -> dict[str, Any]:
    """重建基线库后走一遍 P2 契约面，返回归一后的 API 响应结构。"""
    with tempfile.TemporaryDirectory(prefix="lj-reader-fixture-") as tmp:
        root = Path(tmp)
        db_path = root / "reader-fixture.db"
        rebuild_development_database(db_path)
        client = TestClient(create_app(f"sqlite:///{db_path}", assets_root=root / "assets"))
        responses: dict[str, Any] = {}

        imported = client.post(
            "/dictionaries/import",
            files={"file": ("fixture-dictionary.zip", build_fixture_yomitan_zip(), "application/zip")},
        )
        imported.raise_for_status()
        responses["dictionary/source"] = imported.json()

        materials = client.get("/materials")
        materials.raise_for_status()
        material_by_kind = {row["kind"]: row for row in materials.json()}
        sentences_by_kind: dict[str, list[dict[str, Any]]] = {}
        for kind, material in material_by_kind.items():
            fetched = client.get(f"/materials/{material['id']}/sentences")
            fetched.raise_for_status()
            sentences_by_kind[kind] = fetched.json()

        # token 视图：txt 取含「君」的句子（token provenance 有真实词典命中），
        # srt 取第一句；两者都携带 code point 偏移与版本来源。
        token_responses: dict[str, dict[str, Any]] = {}
        for sentence in sentences_by_kind["text"]:
            fetched = client.get(f"/sentences/{sentence['id']}/tokens")
            fetched.raise_for_status()
            body = fetched.json()
            token_responses.setdefault("txt", body)
            if any(token["normalized_form"] == "君" for token in body["tokens"]):
                token_responses["txt"] = body
                break
        first_srt = sentences_by_kind["subtitle_video"][0]
        fetched = client.get(f"/sentences/{first_srt['id']}/tokens")
        fetched.raise_for_status()
        token_responses["srt"] = fetched.json()
        responses.update({f"tokens/{key}": body for key, body in token_responses.items()})

        # 词典精确查找与前缀搜索
        lookup = client.get("/dictionaries/lookup", params={"expression": "君"})
        lookup.raise_for_status()
        responses["dictionary/lookup"] = lookup.json()
        search = client.get("/dictionaries/search", params={"query": "頑"})
        search.raise_for_status()
        responses["dictionary/search"] = search.json()

        # 划线：单句划线选「𠮟られた」（BMP 外 code point 样本）
        txt_first = sentences_by_kind["text"][0]
        created = client.post(
            f"/materials/{material_by_kind['text']['id']}/annotations",
            json={
                "spans": [{"sentence_id": txt_first["id"], "surface": "𠮟られた"}],
                "note": "fixture-annotation",
                "color": "yellow",
            },
        )
        created.raise_for_status()
        responses["annotations/txt"] = created.json()

        # 证据链：对 fixture 句子中的「君」词元做 known 裁定并读回摘要/视图
        tokens = token_responses["txt"]["tokens"]
        target = next(token for token in tokens if token["normalized_form"] == "君")
        lexeme_id = target["lexeme_id"]
        decision = client.post(
            f"/lexemes/{lexeme_id}/decisions",
            json={
                "decision": "known",
                "input_surface": target["surface"],
                "input_reading": target["reading_form"],
                "material_id": material_by_kind["text"]["id"],
                "operation_key": "fixture-known-jun",
                "expected_decision_seq": 0,
            },
        )
        decision.raise_for_status()
        responses["evidence/decision"] = decision.json()
        summary = client.get(f"/lexemes/{lexeme_id}/evidence-summary")
        summary.raise_for_status()
        responses["evidence/summary"] = summary.json()
        known_views = client.post(
            "/lexemes/known-views/batch",
            json={"items": [{"lexeme_id": lexeme_id}, {"lexeme_id": lexeme_id, "form": "君"}]},
        )
        known_views.raise_for_status()
        responses["evidence/known-views"] = known_views.json()

        return _normalize(responses, {})


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="learningj.fixtures.reader_fixture",
        description="生成前端可锁定的 P2 阅读/词典/证据 fixture（确定性输出）",
    )
    parser.add_argument("--out", type=Path, required=True, help="输出 JSON 路径")
    args = parser.parse_args(argv)

    fixture = build_fixture()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(fixture, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"阅读器 fixture 已生成: {args.out.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
