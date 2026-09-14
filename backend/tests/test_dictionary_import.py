"""P2 词典导入与查找（`data-model.md` §2.0，ADR-032，plan P2 第 2 条）。

覆盖：ZIP 安全边界（穿越/超限/损坏/未知 schema/重复资源带定位拒绝）、
archive hash 幂等、canonical 模型落地（source/entry/definition/asset/run）、
结构化定义保留与纯文本降级、精确查找与 FTS5 搜索、词典导入不创建
KP/KE（§9 不变量 8 的生产面）、解析在事务外（失败零行落地）。所有
API 用例跑在真实开发基线重建库上。
"""

from __future__ import annotations

import io
import json
import sqlite3
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import build_yomitan_zip as build_zip

from learningj.api.app import create_app
from learningj.db.maintenance import rebuild_development_database
from learningj.dictionary.importer import DictionaryImportError, parse_yomitan_archive

_PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360000002000154a24f4f0000000049454e44ae426082"
)


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    db_path = tmp_path / "development.db"
    rebuild_development_database(db_path)
    app = create_app(f"sqlite:///{db_path}", assets_root=tmp_path / "assets")
    client = TestClient(app)
    client.app.state.db_path = db_path  # type: ignore[attr-defined]
    return client


def _counts(client: TestClient, table: str) -> int:
    with sqlite3.connect(client.app.state.db_path) as conn:  # type: ignore[attr-defined]
        return conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]


def test_import_maps_yomitan_to_canonical_model(client: TestClient) -> None:
    entries = [
        ["走る", "はしる", "v5", "v5", 10, "to run", {"type": "text", "text": "奔跑"}],
        ["走", "そう", "", "", 5, "run (kanji)"],
    ]
    index = {"title": "テスト辞書", "revision": "2026-09-12", "sequenced": True, "author": "fixture"}
    blob = build_zip(entries, index=index, extra_files={"img/run.png": _PNG_1PX})

    response = client.post("/dictionaries/import", files={"file": ("dict.zip", blob, "application/zip")})
    assert response.status_code == 201
    body = response.json()
    assert body["idempotent_replay"] is False
    source = body["source"]
    assert source["display_name"] == "テスト辞書"
    assert source["source_version"] == "2026-09-12"
    assert source["format"] == "yomitan_zip"
    assert source["license_metadata"] == {"author": "fixture"}
    assert body["status"] == "done"
    assert body["stats"]["entry_rows"] == 2
    assert body["stats"]["asset_files"] == 1

    with sqlite3.connect(client.app.state.db_path) as conn:  # type: ignore[attr-defined]
        source_row = conn.execute(
            "SELECT display_name, source_version, schema_version FROM dictionary_sources"
        ).fetchone()
        assert source_row == ("テスト辞書", "2026-09-12", "term_bank_v1")
        assert conn.execute("SELECT count(*) FROM dictionary_entries").fetchone()[0] == 2
        assert conn.execute("SELECT count(*) FROM dictionary_definitions").fetchone()[0] == 3
        asset = conn.execute(
            "SELECT relative_path, mime_type, storage_path FROM dictionary_assets"
        ).fetchone()
        assert asset[0] == "img/run.png" and asset[1] == "image/png"
        assert asset[2].startswith(str(source["id"]))
        run_status, finished_at = conn.execute(
            "SELECT status, finished_at FROM dictionary_import_runs"
        ).fetchone()
        assert run_status == "done" and finished_at is not None

    # 资源真实落盘
    assets_root = Path(client.app.state.assets_root)  # type: ignore[attr-defined]
    assert (assets_root / source["id"] / "img" / "run.png").read_bytes() == _PNG_1PX


def test_sequenced_dictionary_assigns_grouped_sequence_numbers(client: TestClient) -> None:
    entries = [
        ["走る", "はしる", "", "v5", 10, "to run"],
        ["走る", "はしる", "", "v5", 8, "to drive"],
        ["走", "そう", "", "", 5, "kanji reading"],
    ]
    index = {"title": "s", "revision": "1", "sequenced": True}
    response = client.post(
        "/dictionaries/import", files={"file": ("d.zip", build_zip(entries, index=index), "application/zip")}
    )
    assert response.status_code == 201
    with sqlite3.connect(client.app.state.db_path) as conn:  # type: ignore[attr-defined]
        sequences = conn.execute(
            "SELECT sequence FROM dictionary_entries ORDER BY source_local_id"
        ).fetchall()
    assert [row[0] for row in sequences] == [0, 0, 1]


def test_same_archive_hash_reimport_is_idempotent(client: TestClient) -> None:
    blob = build_zip()
    first = client.post("/dictionaries/import", files={"file": ("a.zip", blob, "application/zip")})
    second = client.post("/dictionaries/import", files={"file": ("b.zip", blob, "application/zip")})
    assert first.status_code == 201 and second.status_code == 200
    assert second.json()["idempotent_replay"] is True
    assert second.json()["source"]["id"] == first.json()["source"]["id"]
    assert _counts(client, "dictionary_entries") == 1
    assert _counts(client, "dictionary_sources") == 1
    # 重放记录一次运行，但不产生新条目
    assert _counts(client, "dictionary_import_runs") == 2
    with sqlite3.connect(client.app.state.db_path) as conn:  # type: ignore[attr-defined]
        stats = conn.execute("SELECT stats FROM dictionary_import_runs ORDER BY started_at").fetchall()
    assert json.loads(stats[1][0])["idempotent_replay"] is True


def test_path_traversal_members_are_rejected_with_location() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("index.json", json.dumps({"title": "t", "revision": "1"}))
        archive.writestr("term_bank_1.json", "[]")
        archive.writestr("../evil.json", b"{}")
    with pytest.raises(DictionaryImportError, match=r"\.\./evil\.json"):
        parse_yomitan_archive(buffer.getvalue())
    for name in ("/abs.json", "C:/evil.json", "a\\b.json", "..\\x.json"):
        blob = build_zip(extra_files={name: b"{}"})
        with pytest.raises(DictionaryImportError, match="成员"):
            parse_yomitan_archive(blob)

    with pytest.raises(DictionaryImportError, match="重复的成员名"):
        parse_yomitan_archive(
            build_zip(extra_files={"img/a.txt": b"one", "img//a.txt": b"two"})
        )


@pytest.mark.filterwarnings("ignore:Duplicate name")
def test_duplicated_member_and_size_limits_are_rejected_with_location() -> None:
    parse_yomitan_archive(build_zip())  # sanity

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("index.json", json.dumps({"title": "t", "revision": "1"}))
        archive.writestr("term_bank_1.json", "[]")
        archive.writestr("term_bank_1.json", "[]")
    with pytest.raises(DictionaryImportError, match="重复的成员名"):
        parse_yomitan_archive(buffer.getvalue())

    # 声明尺寸超限（中央目录即可判定）
    entries = [["走る", "はしる", "", "", 1, "x" * (128 * 1024 * 1024 + 1)]]
    blob = build_zip(entries)
    with pytest.raises(DictionaryImportError, match="超过单文件上限"):
        parse_yomitan_archive(blob)


def test_corrupt_and_unknown_schema_archives_are_rejected_with_location() -> None:
    with pytest.raises(DictionaryImportError, match="损坏或不是 ZIP"):
        parse_yomitan_archive(b"not a zip")
    with pytest.raises(DictionaryImportError, match="缺少 index.json"):
        parse_yomitan_archive(build_zip(omit={"index.json"}))
    with pytest.raises(DictionaryImportError, match="title"):
        parse_yomitan_archive(build_zip(index={"revision": "1"}))
    with pytest.raises(DictionaryImportError, match="revision"):
        parse_yomitan_archive(build_zip(index={"title": "t"}))
    with pytest.raises(DictionaryImportError, match="format=2 不受支持"):
        parse_yomitan_archive(build_zip(index={"title": "t", "revision": "1", "format": 2}))
    with pytest.raises(DictionaryImportError, match="term bank"):
        parse_yomitan_archive(build_zip(entries=[["only-two", "columns"]]))
    with pytest.raises(DictionaryImportError, match="score"):
        parse_yomitan_archive(build_zip(entries=[["走る", "はしる", "", "", "bad", "x"]]))
    with pytest.raises(DictionaryImportError, match="释义类型"):
        parse_yomitan_archive(build_zip(entries=[["走る", "はしる", "", "", 1, 1.5]]))
    with pytest.raises(DictionaryImportError, match="JSON 解析失败"):
        parse_yomitan_archive(_corrupt_bank())
    with pytest.raises(DictionaryImportError, match="term_bank"):
        parse_yomitan_archive(build_zip(omit={"term_bank_1.json"}))


def test_format3_index_accepted_with_structured_content() -> None:
    """format 3（当前 Yomitan 主流导出）显式支持：schema 声明通过，
    八列 term bank v3 行、显式 sequence/termTags 与 structured-content 释义
    走严格校验路径。"""
    structured = {
        "type": "structured-content",
        "content": {
            "tag": "div",
            "content": [
                {"tag": "span", "content": ["あ"], "data": {"class": "word"}},
                {
                    "tag": "span",
                    "lang": "zh",
                    "content": ["/ ", "啊，噢。"],
                    "data": {"class": "dfcn"},
                },
            ],
        },
    }
    parsed = parse_yomitan_archive(
        build_zip(
            [["あ", "", "interj", "", 0, [structured], 42, "common"]],
            index={"title": "s3", "revision": "r3", "format": 3, "sequenced": True},
        )
    )
    assert parsed.schema_version == "yomitan_format_3"
    assert parsed.entries[0].sequence == 42
    assert parsed.entries[0].tags == ["interj", "common"]
    definition = parsed.entries[0].definitions[0]
    # content 数组裸字符串是文本节点；相邻裸字符串合并为一个文本块，
    # data/style 等属性值不入纯文本投影；原始 payload 原样保留。
    assert definition.plain_text == "あ\n/ 啊，噢。"
    assert definition.structured_content == structured


def test_format3_import_persists_explicit_sequence_and_term_tags(client: TestClient) -> None:
    structured = {"type": "structured-content", "content": "definition"}
    blob = build_zip(
        [["あ", "", "interj", "", 3, [structured], 19, "common"]],
        index={"title": "s3", "revision": "r3", "format": 3, "sequenced": True},
    )
    response = client.post("/dictionaries/import", files={"file": ("s3.zip", blob, "application/zip")})
    assert response.status_code == 201
    assert response.json()["source"]["schema_version"] == "yomitan_format_3"
    with sqlite3.connect(client.app.state.db_path) as conn:  # type: ignore[attr-defined]
        sequence, tags, definition_count = conn.execute(
            """
            SELECT e.sequence, e.tags, count(d.id)
            FROM dictionary_entries AS e
            JOIN dictionary_definitions AS d ON d.entry_id = e.id
            GROUP BY e.id
            """
        ).fetchone()
    assert sequence == 19
    assert json.loads(tags) == ["interj", "common"]
    assert definition_count == 1


def test_format3_real_world_glossary_shapes_project_deterministically() -> None:
    """真实 format 3 词典的释义三形态：structured-content、纯文本与空字符串，
    均得到确定性投影；sequence 与 termTags 不会混入 definitions。"""
    structured = {"type": "structured-content", "content": {"tag": "div", "content": "定義"}}
    parsed = parse_yomitan_archive(
        build_zip(
            [["あ", "", None, "", 0, [structured, "plain", ""], 7, "term-tag"]],
            index={"title": "s3", "revision": "r3", "format": 3, "sequenced": True},
        )
    )
    definitions = parsed.entries[0].definitions
    assert [d.ordinal for d in definitions] == [0, 1, 2]
    assert definitions[0].plain_text == "定義"
    assert definitions[0].structured_content == structured
    assert definitions[1].plain_text == "plain"
    assert definitions[1].structured_content is None
    assert definitions[2].plain_text == ""
    assert parsed.entries[0].sequence == 7
    assert parsed.entries[0].tags == ["term-tag"]

    # 布尔不是合法释义项，仍按未知 schema 拒绝。
    with pytest.raises(DictionaryImportError, match="释义类型"):
        parse_yomitan_archive(
            build_zip(
                [["あ", "", "", "", 0, [True], 0, ""]],
                index={"title": "t", "revision": "1", "format": 3},
            )
        )


def test_format3_malformed_rows_are_still_rejected_strictly() -> None:
    """format 3 的接受不放宽校验：列数不足与未知 glossary 类型仍带定位拒绝。"""
    with pytest.raises(DictionaryImportError, match="必须恰好 8 列"):
        parse_yomitan_archive(
            build_zip([["あ", ""]], index={"title": "t", "revision": "1", "format": 3})
        )
    with pytest.raises(DictionaryImportError, match="释义类型"):
        parse_yomitan_archive(
            build_zip(
                [["あ", "", "", "", 0, [1.5], 0, ""]],
                index={"title": "t", "revision": "1", "format": 3},
            )
        )


def _corrupt_bank() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("index.json", json.dumps({"title": "t", "revision": "1"}))
        archive.writestr("term_bank_1.json", "{not json")
    return buffer.getvalue()


def test_import_failure_leaves_no_rows_and_no_assets(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """解析与资源落盘在事务外；发布事务失败时零行落地、资源目录清理。"""
    from learningj.dictionary import service as dictionary_service

    blob = build_zip(entries=[["走る", "はしる", "", "", 10, "to run"]])

    def explode(*args, **kwargs):  # noqa: ANN002, ANN003
        raise RuntimeError("publish failure")

    monkeypatch.setattr(dictionary_service, "_insert_entries", explode)
    response = client.post(
        "/dictionaries/import", files={"file": ("bad.zip", blob, "application/zip")}
    )
    assert response.status_code == 422
    assert _counts(client, "dictionary_sources") == 0
    assert _counts(client, "dictionary_entries") == 0
    assert _counts(client, "dictionary_import_runs") == 0

    # 解析期失败同样零行（压缩炸弹式声明尺寸超限）
    monkeypatch.undo()
    entries = [["走る", "はしる", "", "", 1, "x" * (128 * 1024 * 1024 + 1)]]
    response = client.post(
        "/dictionaries/import",
        files={"file": ("bad.zip", build_zip(entries), "application/zip")},
    )
    assert response.status_code == 422
    assert "超过单文件上限" in response.json()["detail"]
    assert _counts(client, "dictionary_import_runs") == 0


def test_asset_write_failure_cleans_staging_and_final_directories(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    blob = build_zip(
        entries=[["走る", "はしる", "", "", 10, "to run"]],
        extra_files={"img/a.txt": b"one", "img/b.txt": b"two"},
    )
    original_write_bytes = Path.write_bytes
    writes = 0

    def flaky_write(self: Path, data: bytes) -> int:
        nonlocal writes
        writes += 1
        if writes == 2:
            raise OSError("simulated asset write failure")
        return original_write_bytes(self, data)

    monkeypatch.setattr(Path, "write_bytes", flaky_write)
    response = client.post(
        "/dictionaries/import", files={"file": ("bad-assets.zip", blob, "application/zip")}
    )
    assert response.status_code == 422
    assets_root = Path(client.app.state.assets_root)  # type: ignore[attr-defined]
    assert not assets_root.exists() or not any(assets_root.iterdir())


def test_lookup_exact_match_with_source_provenance(client: TestClient) -> None:
    blob = build_zip(
        entries=[
            ["走る", "はしる", "v5", "v5", 10, "to run"],
            ["走る", "", "", "", 1, "hashiru (no reading)"],
        ]
    )
    client.post("/dictionaries/import", files={"file": ("d.zip", blob, "application/zip")})

    response = client.get("/dictionaries/lookup", params={"expression": "走る"})
    assert response.status_code == 200
    body = response.json()
    assert len(body["entries"]) == 2
    top = body["entries"][0]  # score 高者在前
    assert top["source_version"] == "2026-09-12"
    assert top["display_name"] == "テスト辞書"
    assert top["tags"] == ["v5"]
    assert top["definitions"][0]["plain_text"] == "to run"

    # reading 过滤：限定读音后空读音条目也保留，另一读音被排除
    filtered = client.get("/dictionaries/lookup", params={"expression": "走る", "reading": "はしる"})
    assert len(filtered.json()["entries"]) == 1
    assert filtered.json()["entries"][0]["reading"] == "はしる"

    missing = client.get("/dictionaries/lookup", params={"expression": "存在しない"})
    assert missing.status_code == 200
    assert missing.json()["entries"] == []


def test_search_prefers_exact_then_fts_prefix(client: TestClient) -> None:
    blob = build_zip(
        entries=[
            ["頑張る", "がんばる", "", "v5", 9, "to persevere"],
            ["頑張り屋", "がんばりや", "", "名詞", 3, "triertype"],
            ["散歩", "さんぽ", "", "", 5, "walk"],
        ]
    )
    client.post("/dictionaries/import", files={"file": ("d.zip", blob, "application/zip")})
    response = client.get("/dictionaries/search", params={"query": "頑張"})
    assert response.status_code == 200
    expressions = [entry["expression"] for entry in response.json()["entries"]]
    assert "頑張る" in expressions and "頑張り屋" in expressions and "散歩" not in expressions
    assert expressions[0] == "頑張る"  # 精确前缀命中排序在前
    empty = client.get("/dictionaries/search", params={"query": "存在しない"})
    assert empty.json()["entries"] == []


def test_search_index_failure_is_visible_not_silently_downgraded(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from learningj.dictionary import service as dictionary_service

    client.post(
        "/dictionaries/import",
        files={
            "file": (
                "d.zip",
                build_zip(entries=[["頑張る", "がんばる", "", "v5", 9, "to persevere"]]),
                "application/zip",
            )
        },
    )

    def fail(_query: str) -> str:
        raise RuntimeError("corrupt FTS")

    monkeypatch.setattr(dictionary_service, "_escape_fts", fail)
    response = client.get("/dictionaries/search", params={"query": "頑張"})
    assert response.status_code == 503
    assert "搜索索引不可用" in response.json()["detail"]


def test_missing_search_index_with_existing_entries_is_visible(
    client: TestClient,
) -> None:
    client.post(
        "/dictionaries/import",
        files={
            "file": (
                "d.zip",
                build_zip(entries=[["頑張る", "がんばる", "", "v5", 9, "to persevere"]]),
                "application/zip",
            )
        },
    )
    with sqlite3.connect(client.app.state.db_path) as conn:  # type: ignore[attr-defined]
        conn.execute("DROP TABLE dictionary_search_fts")
        conn.commit()

    response = client.get("/dictionaries/search", params={"query": "頑張"})
    assert response.status_code == 503
    assert "搜索索引缺失" in response.json()["detail"]


def test_structured_content_preserved_and_degrades_to_plain_text(client: TestClient) -> None:
    entries = [
        ["走る", "はしる", "", "", 10, "plain gloss", {"type": "text", "text": "structured gloss"}],
    ]
    client.post("/dictionaries/import", files={"file": ("d.zip", build_zip(entries), "application/zip")})
    body = client.get("/dictionaries/lookup", params={"expression": "走る"}).json()
    definitions = body["entries"][0]["definitions"]
    assert definitions[0] == {"ordinal": 0, "plain_text": "plain gloss", "structured_content": None}
    # 富文本 payload 原样保留，同时存在纯文本投影（资源缺失仍可读）
    assert definitions[1]["structured_content"] == {"type": "text", "text": "structured gloss"}
    assert definitions[1]["plain_text"] == "structured gloss"


def test_dictionary_import_creates_no_kp_or_ke(client: TestClient) -> None:
    blob = build_zip(entries=[["走る", "はしる", "", "", 10, "to run"]])
    response = client.post("/dictionaries/import", files={"file": ("d.zip", blob, "application/zip")})
    assert response.status_code == 201
    # 词典条目/义项/资源/词频 metadata 均不得自动创建 KnowledgePoint 或 KE；
    # 基线库根本没有 KP 表（P4a 落地），这里断言证据侧无写入、查找只读。
    assert _counts(client, "known_evidence") == 0
    assert _counts(client, "lexeme_knowledge_decisions") == 0
    for _ in range(2):
        client.get("/dictionaries/lookup", params={"expression": "走る"})
        client.get("/dictionaries/search", params={"query": "走"})
    assert _counts(client, "known_evidence") == 0
    assert _counts(client, "lexeme_knowledge_decisions") == 0


def test_search_index_is_rebuildable_projection(client: TestClient) -> None:
    from sqlalchemy import text

    from learningj.db.session import make_engine, make_session_factory
    from learningj.dictionary import service as dictionary_service

    blob = build_zip(entries=[["頑張る", "がんばる", "", "v5", 9, "to persevere"]])
    client.post("/dictionaries/import", files={"file": ("d.zip", blob, "application/zip")})

    engine = make_engine(f"sqlite:///{client.app.state.db_path}")  # type: ignore[attr-defined]
    session_factory = make_session_factory(engine)
    with session_factory() as session:
        before = session.execute(text("SELECT count(*) FROM dictionary_search_fts")).scalar()
        rebuilt = dictionary_service.rebuild_search_index(session)
        session.commit()
        after = session.execute(text("SELECT count(*) FROM dictionary_search_fts")).scalar()
    assert before == rebuilt == after == 1
    engine.dispose()
