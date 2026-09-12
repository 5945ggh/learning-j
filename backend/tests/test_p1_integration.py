"""P1-integration 跨边界集成测试（`CURRENT-PACKETS.md` P1-integration）。

集成包只拥有跨边界验证：全部用例跑在真实重建的开发基线库上，只通过公开
API（TestClient）与数据库探针观察行为，不 mock 被测结果。覆盖阶段验收点：

- txt/srt/vtt/epub 四种格式的端到端素材链：§8.2 锚点表、code point 偏移
  （不变量 6：切片等于 surface）、sidecar 三版本戳（不变量 5 的 API 面）、
  单代次词频与全量重建一致；
- 重分词字节级幂等；EPUB ruby hints 在幂等重建中逐字节保留并跨代次携带
  （P1-backend Review 遗留项）；
- 重建期间旧代次持续可读、current 指针提交后才对读者可见（并发 API 探针，
  不只信 mock）；
- 全库快照导出 → 隔离副本恢复 → verify-snapshot：恢复库经 API 与源库读数
  一致、是可写活库、代次历史在快照中保留（§1.6；ADR-042）；
- tracked 生成契约产物（openapi.json / material-fixture.json）与再生成
  字节一致；fixture 能在重建库上端到端还原 txt/srt 句子列表。
"""

from __future__ import annotations

import io
import json
import sqlite3
import zipfile
from pathlib import Path
from typing import Any

import msgpack
import pytest
from fastapi.testclient import TestClient

from learningj.api.app import create_app
from learningj.api.export_openapi import build_openapi
from learningj.db.maintenance import (
    DEVELOPMENT_CONTRACT_ID,
    DEVELOPMENT_SCHEMA_ID,
    export_snapshot,
    inspect_development_baseline,
    rebuild_development_database,
    verify_snapshot,
)
from learningj.domain.offsets import normalize_text
from learningj.fixtures.material_fixture import build_fixture
from learningj.ingest import service as ingest_service

FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures"


@pytest.fixture()
def dev_client(tmp_path: Path) -> TestClient:
    db_path = tmp_path / "development.db"
    rebuild_development_database(db_path)
    client = TestClient(create_app(f"sqlite:///{db_path}"))
    client.app.state.db_path = db_path  # type: ignore[attr-defined]
    return client


def _epub_blob(xhtml: str) -> bytes:
    container = (
        "<?xml version='1.0'?><container xmlns='urn:oasis:names:tc:opendocument:"
        "xmlns:container'><rootfiles><rootfile full-path='OEBPS/content.opf'/>"
        "</rootfiles></container>"
    )
    opf = (
        "<?xml version='1.0'?><package xmlns='http://www.idpf.org/2007/opf'>"
        "<manifest><item id='chapter' href='chapter.xhtml' "
        "media-type='application/xhtml+xml'/></manifest>"
        "<spine><itemref idref='chapter'/></spine></package>"
    )
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("META-INF/container.xml", container)
        archive.writestr("OEBPS/content.opf", opf)
        archive.writestr("OEBPS/chapter.xhtml", xhtml)
    return out.getvalue()


def _import(client: TestClient, filename: str, blob: bytes) -> dict[str, Any]:
    created = client.post(
        "/materials", files={"file": (filename, blob, "application/octet-stream")}
    )
    assert created.status_code == 201, (filename, created.text)
    return created.json()


def _library_chain(client: TestClient) -> dict[str, Any]:
    """素材链全部公开读端点的响应快照（跨库一致性比较用）。"""
    materials = client.get("/materials").json()
    chain: dict[str, Any] = {"materials": materials}
    for material in materials:
        material_id = material["id"]
        chain[material_id] = {
            "sentences": client.get(f"/materials/{material_id}/sentences").json(),
            "sidecar": client.get(f"/materials/{material_id}/sidecar").json(),
            "counts": client.get(f"/materials/{material_id}/lexeme-counts").json(),
        }
    return chain


def _sidecar_fingerprint(conn: sqlite3.Connection, material_id: str) -> tuple[Any, Any]:
    """sidecar 行（含 payload 原始字节）与词频行的逐字节指纹。"""
    sidecars = conn.execute(
        "SELECT id, payload, content_hash, segmenter_version, tokenizer_version,"
        " analyzer_dict_version FROM sidecars WHERE material_id = ? ORDER BY id",
        (material_id.replace("-", ""),),
    ).fetchall()
    counts = conn.execute(
        "SELECT sidecar_id, lexeme_id, token_count FROM material_lexeme_counts"
        " WHERE material_id = ? ORDER BY sidecar_id, lexeme_id",
        (material_id.replace("-", ""),),
    ).fetchall()
    return sidecars, counts


# ---------------------------------------------------------------------------
# 四格式端到端素材链
# ---------------------------------------------------------------------------


def test_four_format_material_chain_end_to_end(dev_client: TestClient) -> None:
    """txt/srt/vtt/epub 经真实重建库与公开 API 完成导入→句子→sidecar→词频。"""
    client = dev_client
    txt_full_text = normalize_text("静かな朝だった。鳥が鳴いた。\n𠮟ることも愛だ。")
    epub_xhtml = (
        "<html><body><p><ruby><rb>𠮟</rb><rt>しか</rt></ruby>られた。"
        "次は君の番です！</p><p>向上心が熱い。</p></body></html>"
    )
    samples = [
        # (文件名, 字节, kind, anchor_type, 锚点偏移期望, 规范化全文/文本基,
        #  首句期望翻译)
        (
            "sample.txt",
            "静かな朝だった。鳥が鳴いた。\n𠮟ることも愛だ。".encode("utf-8"),
            "text",
            "plain_text",
            [(0, 8), (8, 14), (15, 23)],
            txt_full_text,
            None,
        ),
        (
            "sample.srt",
            (
                "1\n00:00:01,000 --> 00:00:04,200\nもう一度挑戦したい。\n想再挑战一次。\n"
                "\n2\n00:00:04,400 --> 00:00:08,000\n明日は晴れるでしょう。\n"
            ).encode("utf-8"),
            "subtitle_video",
            "subtitle",
            None,
            None,
            "想再挑战一次。",
        ),
        (
            "sample.vtt",
            (
                "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.200\n静かな朝だった。\n"
                "\n2\n00:00:04.400 --> 00:00:08.000\n鳥が鳴いた。\n"
            ).encode("utf-8"),
            "subtitle_video",
            "subtitle",
            None,
            None,
            None,
        ),
        (
            "book.epub",
            _epub_blob(epub_xhtml),
            "epub",
            "epub",
            [(0, 5), (5, 13), (14, 21)],
            normalize_text("𠮟られた。次は君の番です！\n向上心が熱い。\n"),
            None,
        ),
    ]

    imported: list[dict[str, Any]] = []
    for filename, blob, kind, anchor_type, offsets, _base, first_translation in samples:
        material = _import(client, filename, blob)
        material_id = material["id"]
        imported.append(material)

        # §8.1 版本与资源边界字段经 API 可见。
        assert material["kind"] == kind
        assert material["storage_mode"] == "external_reference"
        assert material["source_sha256"]
        assert material["current_sidecar_id"]

        sentences = client.get(f"/materials/{material_id}/sentences").json()
        assert [s["anchor_type"] for s in sentences] == [anchor_type] * len(sentences)

        # §8.2 锚点表：payload 键集合按 anchor_type 严格成立。
        if anchor_type == "subtitle":
            assert all(set(s["anchor_payload"]) == {"cue_index"} for s in sentences)
            assert [s["anchor_payload"]["cue_index"] for s in sentences] == [0, 1]
            for sentence in sentences:
                assert sentence["time_start"] < sentence["time_end"]
            assert sentences[0]["translation"] == first_translation
            assert sentences[1]["translation"] is None
        else:
            # code point 半开区间（不变量 6）：锚点切片必须等于句子文本。
            assert offsets is not None and _base is not None
            assert [
                (s["anchor_payload"]["char_start"], s["anchor_payload"]["char_end"])
                for s in sentences
            ] == offsets
            for sentence, (start, end) in zip(sentences, offsets, strict=True):
                assert _base[start:end] == sentence["text"]
            if anchor_type == "epub":
                assert all(s["anchor_payload"]["spine_index"] == 0 for s in sentences)
                assert all(set(s["anchor_payload"]) == {"spine_index", "char_start", "char_end"} for s in sentences)

        sidecar = client.get(f"/materials/{material_id}/sidecar").json()
        # 不变量 5 的 API 面：三元组记录携带非空分析器词典版本来源。
        assert sidecar["segmenter_version"].startswith("learningj-segmenter")
        assert sidecar["tokenizer_version"] and sidecar["analyzer_dict_version"]
        assert sidecar["sidecar_generation_id"] == material["current_sidecar_id"]
        assert sidecar["content_hash"] == material["content_hash"]

        groups = sidecar["payload"]["sentences"]
        assert [g["sentence_index"] for g in groups] == [s["index"] for s in sentences]
        text_by_index = {s["index"]: s["text"] for s in sentences}
        token_count = 0
        for group in groups:
            for token in group["tokens"]:
                # 后端偏移按 code point：Python str 切片与其互为镜像。
                assert (
                    text_by_index[group["sentence_index"]][token["char_start"] : token["char_end"]]
                    == token["surface"]
                )
                assert token["lexeme_id"]
                token_count += 1
        tokens = [t for g in groups for t in g["tokens"]]
        assert token_count == len(tokens)

        counts = client.get(f"/materials/{material_id}/lexeme-counts").json()
        assert counts["material_id"] == material_id
        # 同一响应单一代次，且等于 sidecar 与素材指针的代次。
        assert counts["sidecar_generation_id"] == sidecar["sidecar_generation_id"]
        recomputed: dict[str, int] = {}
        for token in tokens:
            recomputed[token["lexeme_id"]] = recomputed.get(token["lexeme_id"], 0) + 1
        assert [(c["lexeme_id"], c["token_count"]) for c in counts["counts"]] == sorted(
            recomputed.items()
        )
        assert all(c["token_count"] > 0 for c in counts["counts"])
        assert len(counts["counts"]) < len(tokens)

    assert len(client.get("/materials").json()) == 2 + len(imported)


def test_reimport_with_same_normalized_content_returns_existing_material(
    dev_client: TestClient,
) -> None:
    """API 级导入幂等：同规范化全文 + 同 kind 的重复导入返回既有素材，
    不新建行，也不以新文件的翻译改写已存储内容（自动处理不覆盖既有事实）。"""
    client = dev_client
    original = _import(
        client,
        "first.srt",
        "1\n00:00:01,000 --> 00:00:02,000\n元の文です。\n元の訳です。\n".encode("utf-8"),
    )
    sentences = client.get(f"/materials/{original['id']}/sentences").json()
    assert sentences[0]["translation"] == "元の訳です。"

    reimported = _import(
        client,
        "second.srt",
        "1\n00:00:09,000 --> 00:00:10,000\n元の文です。\n別の訳です。\n".encode("utf-8"),
    )
    assert reimported["id"] == original["id"]
    assert len(client.get("/materials").json()) == 3
    assert client.get(f"/materials/{original['id']}/sentences").json() == sentences


def test_epub_ruby_hints_survive_idempotent_rebuild_and_generation_switch(
    dev_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """EPUB ruby hints：幂等重建逐字节保留；词典升级新代次携带旧 hints。

    闭合 P1-backend Review 的遗留建议（无任何测试在带 ruby hints 的 EPUB
    素材上执行 rebuild）。
    """
    client = dev_client
    xhtml = (
        "<html><body><p><ruby><rb>𠮟</rb><rt>しか</rt></ruby>られた。"
        "次は君の番です！</p><p>向上心が熱い。</p></body></html>"
    )
    material = _import(client, "ruby.epub", _epub_blob(xhtml))
    material_id = material["id"]
    sidecar = client.get(f"/materials/{material_id}/sidecar").json()
    hints = sidecar["payload"]["sentences"][0]["ruby_hints"]
    assert hints == [
        {
            "char_start": 0,
            "char_end": 1,
            "base_text": "𠮟",
            "reading": "しか",
            "reading_source": "epub_ruby",
        }
    ]
    sentence_text = client.get(f"/materials/{material_id}/sentences").json()[0]["text"]
    assert sentence_text[hints[0]["char_start"] : hints[0]["char_end"]] == hints[0]["base_text"]

    conn = sqlite3.connect(client.app.state.db_path)  # type: ignore[attr-defined]
    try:
        before = _sidecar_fingerprint(conn, material_id)
    finally:
        conn.close()

    # 幂等重建：不发布任何新行，payload 原始字节与 hints 逐字节不变。
    rebuilt = client.post(f"/materials/{material_id}/sidecar/rebuild")
    assert rebuilt.status_code == 200
    assert rebuilt.json()["sidecar_generation_id"] == sidecar["sidecar_generation_id"]
    assert rebuilt.json()["payload"]["sentences"][0]["ruby_hints"] == hints

    conn = sqlite3.connect(client.app.state.db_path)  # type: ignore[attr-defined]
    try:
        assert _sidecar_fingerprint(conn, material_id) == before
    finally:
        conn.close()

    # 词典升级：新代次发布，hints 按句子下标携带进新代次；旧代次完整保留。
    real_tokenize = ingest_service._tokenize

    def upgraded_tokenize(sentences, analyzer_dict_version=None):
        payload, tokenizer_version, _ = real_tokenize(sentences, analyzer_dict_version)
        return payload, tokenizer_version, "sudachidict-core-99990101"

    monkeypatch.setattr(ingest_service, "_tokenize", upgraded_tokenize)
    switched = client.post(f"/materials/{material_id}/sidecar/rebuild")
    assert switched.status_code == 200
    new_generation = switched.json()
    assert new_generation["sidecar_generation_id"] != sidecar["sidecar_generation_id"]
    assert new_generation["analyzer_dict_version"] == "sudachidict-core-99990101"
    assert new_generation["payload"]["sentences"][0]["ruby_hints"] == hints

    conn = sqlite3.connect(client.app.state.db_path)  # type: ignore[attr-defined]
    try:
        rows = conn.execute(
            "SELECT id, payload FROM sidecars WHERE material_id = ? ORDER BY created_at",
            (material_id.replace("-", ""),),
        ).fetchall()
        assert len(rows) == 2

        for _sidecar_id, payload in rows:
            groups = msgpack.unpackb(payload, raw=False)["sentences"]
            assert groups[0]["ruby_hints"] == hints
        old_total = conn.execute(
            "SELECT coalesce(sum(token_count), 0) FROM material_lexeme_counts"
            " WHERE sidecar_id = ?",
            (sidecar["sidecar_generation_id"].replace("-", ""),),
        ).fetchone()[0]
        new_total = conn.execute(
            "SELECT coalesce(sum(token_count), 0) FROM material_lexeme_counts"
            " WHERE sidecar_id = ?",
            (new_generation["sidecar_generation_id"].replace("-", ""),),
        ).fetchone()[0]
        assert old_total > 0 and new_total == old_total
    finally:
        conn.close()


def test_retokenize_is_byte_level_idempotent_for_every_format(dev_client: TestClient) -> None:
    """幂等验收的字节级形式：payload BLOB 与词频行重建前后逐字节相同。"""
    client = dev_client
    xhtml = "<html><body><p>𠮟られた。次は君の番です！</p></body></html>"
    materials = [
        client.get("/materials").json()[0],
        _import(client, "plain.txt", "静かな朝だった。鳥が鳴いた。".encode("utf-8")),
        _import(client, "plain.srt", "1\n00:00:01,000 --> 00:00:02,000\nはい。\n".encode("utf-8")),
        _import(
            client,
            "plain.vtt",
            "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nいいえ、違います。\n".encode("utf-8"),
        ),
        _import(client, "plain.epub", _epub_blob(xhtml)),
    ]
    assert len({m["id"] for m in materials}) == 5

    for material in materials:
        material_id = material["id"]
        current = client.get(f"/materials/{material_id}/sidecar").json()
        conn = sqlite3.connect(client.app.state.db_path)  # type: ignore[attr-defined]
        try:
            before = _sidecar_fingerprint(conn, material_id)
        finally:
            conn.close()

        response = client.post(f"/materials/{material_id}/sidecar/rebuild")
        assert response.status_code == 200
        assert response.json()["sidecar_generation_id"] == current["sidecar_generation_id"]

        conn = sqlite3.connect(client.app.state.db_path)  # type: ignore[attr-defined]
        try:
            assert _sidecar_fingerprint(conn, material_id) == before
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# 重建期间的并发可读性与指针原子切换
# ---------------------------------------------------------------------------


def test_old_generation_readable_during_rebuild_and_switch_is_atomic(
    dev_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """真实重建库 + 并发 API 探针：重建事务进行中读者只见旧代次；
    全部行写入、指针已在未提交事务中切换时读者仍只见旧代次；提交后才读新代次。"""
    client = dev_client
    material = client.get("/materials").json()[0]
    material_id = material["id"]
    old_sidecar = client.get(f"/materials/{material_id}/sidecar").json()
    old_counts = client.get(f"/materials/{material_id}/lexeme-counts").json()

    # 探针应用在重建事务开启前创建：引擎初始化（触发器安装）不与写锁竞争。
    probe = TestClient(create_app(f"sqlite:///{client.app.state.db_path}"))  # type: ignore[attr-defined]

    def probe_state() -> dict[str, Any]:
        sidecar = probe.get(f"/materials/{material_id}/sidecar")
        counts = probe.get(f"/materials/{material_id}/lexeme-counts")
        assert sidecar.status_code == 200 and counts.status_code == 200
        return {
            "sidecar": sidecar.json(),
            "counts": counts.json(),
        }

    real_publish = ingest_service._publish_generation
    real_tokenize = ingest_service._tokenize
    observations: list[dict[str, Any]] = []

    def upgraded_tokenize(sentences, analyzer_dict_version=None):
        payload, tokenizer_version, _ = real_tokenize(sentences, analyzer_dict_version)
        return payload, tokenizer_version, "sudachidict-core-99990101"

    def probe_during_publish(session, **kwargs):
        # 重建事务已开启（新 sidecar 行已插入未提交）：旧代次完整可读。
        observations.append(probe_state())
        real_publish(session, **kwargs)
        # 词频已写、指针已在未提交事务中切换：读者仍只读旧代次。
        observations.append(probe_state())

    monkeypatch.setattr(ingest_service, "_tokenize", upgraded_tokenize)
    monkeypatch.setattr(ingest_service, "_publish_generation", probe_during_publish)

    rebuilt = client.post(f"/materials/{material_id}/sidecar/rebuild")
    assert rebuilt.status_code == 200
    new_generation_id = rebuilt.json()["sidecar_generation_id"]
    assert new_generation_id != old_sidecar["sidecar_generation_id"]

    assert len(observations) == 2
    for observed in observations:
        assert observed["sidecar"]["sidecar_generation_id"] == old_sidecar["sidecar_generation_id"]
        assert observed["sidecar"]["payload"] == old_sidecar["payload"]
        assert observed["counts"]["sidecar_generation_id"] == old_sidecar["sidecar_generation_id"]
        assert observed["counts"]["counts"] == old_counts["counts"]

    # 提交完成后，同一探针应用读到新代次。
    after = probe_state()
    assert after["sidecar"]["sidecar_generation_id"] == new_generation_id
    assert after["counts"]["sidecar_generation_id"] == new_generation_id

    # 旧代次在存储层完整保留（行、payload、词频），读者按代次取数不混读。
    conn = sqlite3.connect(client.app.state.db_path)  # type: ignore[attr-defined]
    try:
        old_row = conn.execute(
            "SELECT payload FROM sidecars WHERE id = ?",
            (old_sidecar["sidecar_generation_id"].replace("-", ""),),
        ).fetchone()
        assert old_row is not None
        assert msgpack.unpackb(old_row[0], raw=False) == old_sidecar["payload"]
        old_count_rows = conn.execute(
            "SELECT count(*) FROM material_lexeme_counts WHERE sidecar_id = ?",
            (old_sidecar["sidecar_generation_id"].replace("-", ""),),
        ).fetchone()[0]
        assert old_count_rows == len(old_counts["counts"])
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 快照导出 → 隔离恢复 → 验证
# ---------------------------------------------------------------------------


def test_snapshot_roundtrip_restores_identical_readable_writable_chain(
    tmp_path: Path,
) -> None:
    """导出 → 隔离副本恢复 → verify-snapshot：恢复库经公开 API 与源库读数
    一致，且是可写活库；导出对源库无影响。"""
    db_path = tmp_path / "development.db"
    rebuild_development_database(db_path)
    client = TestClient(create_app(f"sqlite:///{db_path}"))
    _import(
        client,
        "ruby.epub",
        _epub_blob(
            "<html><body><p><ruby><rb>𠮟</rb><rt>しか</rt></ruby>られた。次です。</p></body></html>"
        ),
    )
    source_chain = _library_chain(client)
    assert len(source_chain["materials"]) == 3

    result = export_snapshot(db_path, tmp_path / "library-snapshot.db")
    assert result.schema_id == DEVELOPMENT_SCHEMA_ID
    assert result.contract_id == DEVELOPMENT_CONTRACT_ID
    report = verify_snapshot(result.snapshot_path, result.manifest_path)
    assert report["integrity_check"] == "ok"
    assert report["foreign_key_check"] == "ok"
    assert report["schema_id"] == DEVELOPMENT_SCHEMA_ID

    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert len(manifest["resources"]) == 3
    assert len(manifest["sidecars"]) == 3

    # 隔离副本：独立目录中的真实数据库文件，经同一公开 API 服务。
    restored_dir = tmp_path / "restored-isolated"
    restored_dir.mkdir()
    restored_path = restored_dir / "restored.db"
    restored_path.write_bytes(result.snapshot_path.read_bytes())
    assert restored_path.resolve().parent == restored_dir.resolve()
    restored = TestClient(create_app(f"sqlite:///{restored_path}"))
    assert _library_chain(restored) == source_chain

    # 基线登记行随快照原样携带（不是恢复时重建/重登记——已知限制的证据）。
    assert inspect_development_baseline(restored_path) == inspect_development_baseline(db_path)

    # 恢复库是可写活库：继续导入成立；源库不受影响。
    _import(restored, "more.txt", "追加の素材です。".encode("utf-8"))
    assert len(restored.get("/materials").json()) == 4
    assert len(client.get("/materials").json()) == 3


def test_snapshot_preserves_generation_history_across_rebuild(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """导出后源库发生代次切换：旧快照恢复出的库仍服务导出时的旧代次。"""
    db_path = tmp_path / "development.db"
    rebuild_development_database(db_path)
    client = TestClient(create_app(f"sqlite:///{db_path}"))
    material_id = client.get("/materials").json()[0]["id"]
    old_sidecar = client.get(f"/materials/{material_id}/sidecar").json()
    old_counts = client.get(f"/materials/{material_id}/lexeme-counts").json()

    snapshot = tmp_path / "pre-upgrade-snapshot.db"
    export_snapshot(db_path, snapshot)

    real_tokenize = ingest_service._tokenize

    def upgraded_tokenize(sentences, analyzer_dict_version=None):
        payload, tokenizer_version, _ = real_tokenize(sentences, analyzer_dict_version)
        return payload, tokenizer_version, "sudachidict-core-99990101"

    monkeypatch.setattr(ingest_service, "_tokenize", upgraded_tokenize)
    switched = client.post(f"/materials/{material_id}/sidecar/rebuild")
    assert switched.status_code == 200
    new_generation_id = switched.json()["sidecar_generation_id"]

    assert new_generation_id != old_sidecar["sidecar_generation_id"]
    assert client.get(f"/materials/{material_id}/sidecar").json()["sidecar_generation_id"] == new_generation_id

    restored_dir = tmp_path / "restored-isolated"
    restored_dir.mkdir()
    restored_path = restored_dir / "restored.db"
    restored_path.write_bytes(snapshot.read_bytes())
    restored = TestClient(create_app(f"sqlite:///{restored_path}"))
    restored_sidecar = restored.get(f"/materials/{material_id}/sidecar").json()
    assert restored_sidecar["sidecar_generation_id"] == old_sidecar["sidecar_generation_id"]
    assert restored_sidecar["payload"] == old_sidecar["payload"]
    restored_counts = restored.get(f"/materials/{material_id}/lexeme-counts").json()
    assert restored_counts["sidecar_generation_id"] == old_sidecar["sidecar_generation_id"]
    assert restored_counts["counts"] == old_counts["counts"]


# ---------------------------------------------------------------------------
# 生成契约产物与 fixture 的跨边界一致性
# ---------------------------------------------------------------------------


def test_tracked_contract_artifacts_match_regeneration(tmp_path: Path) -> None:
    """tracked openapi.json / material-fixture.json 与当前代码再生成逐字节一致
    （只读取/再生成比对，不改 tracked 产物）。"""
    regenerated_openapi = tmp_path / "openapi.json"
    regenerated_openapi.write_text(
        json.dumps(build_openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    regenerated_fixture = tmp_path / "material-fixture.json"
    regenerated_fixture.write_text(
        json.dumps(build_fixture(), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    assert regenerated_openapi.read_bytes() == (FIXTURES_DIR / "openapi.json").read_bytes()
    assert regenerated_fixture.read_bytes() == (FIXTURES_DIR / "material-fixture.json").read_bytes()


def test_fixture_restores_txt_srt_sentence_lists_on_rebuilt_database(
    tmp_path: Path,
) -> None:
    """验收点「fixture 能端到端还原 txt/srt 句子列表」：重建库经公开 API
    产出的句子/sidecar payload/词频与 tracked fixture 逐项一致。"""
    db_path = tmp_path / "development.db"
    rebuild_development_database(db_path)
    client = TestClient(create_app(f"sqlite:///{db_path}"))
    fixture = json.loads((FIXTURES_DIR / "material-fixture.json").read_text(encoding="utf-8"))

    for key, kind in (("txt", "text"), ("srt", "subtitle_video")):
        material = next(m for m in client.get("/materials").json() if m["kind"] == kind)
        expected_sentences = fixture[f"sentences/{key}"]
        sentences = client.get(f"/materials/{material['id']}/sentences").json()
        assert len(sentences) == len(expected_sentences)
        for actual, expected in zip(sentences, expected_sentences, strict=True):
            for field in (
                "index",
                "text",
                "time_start",
                "time_end",
                "translation",
                "anchor_type",
                "anchor_payload",
            ):
                assert actual[field] == expected[field], (key, field)

        sidecar = client.get(f"/materials/{material['id']}/sidecar").json()
        expected_sidecar = fixture[f"sidecar/{key}"]
        assert sidecar["content_hash"] == expected_sidecar["content_hash"]
        assert sidecar["segmenter_version"] == expected_sidecar["segmenter_version"]
        assert sidecar["tokenizer_version"] == expected_sidecar["tokenizer_version"]
        assert sidecar["analyzer_dict_version"] == expected_sidecar["analyzer_dict_version"]
        assert sidecar["payload"] == expected_sidecar["payload"]
        assert sidecar["sidecar_generation_id"] == material["current_sidecar_id"]

        counts = client.get(f"/materials/{material['id']}/lexeme-counts").json()
        expected_counts = fixture[f"lexeme-counts/{key}"]
        assert counts["sidecar_generation_id"] == sidecar["sidecar_generation_id"]
        assert [(c["lexeme_id"], c["token_count"]) for c in counts["counts"]] == [
            (c["lexeme_id"], c["token_count"]) for c in expected_counts["counts"]
        ]
