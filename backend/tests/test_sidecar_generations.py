"""P1 sidecar 代次与内容索引（data-model §§2.5/8.3，ADR-040）。

覆盖阶段验收观察点：查询响应携带 sidecar_generation_id 且同一响应内词频
代次一致；重分词不覆盖被引用 payload，旧代次持续可读，指针原子切换后才读
新代次；材料词频与全量重建一致；发布/失败/幂等边界；txt/srt/vtt/epub 四种
素材格式的 API 集成。所有用例都跑在真实的开发基线重建库上。
"""

from __future__ import annotations

import io
import sqlite3
import uuid
import zipfile
from pathlib import Path

import msgpack
import pytest
from fastapi.testclient import TestClient

from learningj.api.app import create_app
from learningj.db.maintenance import rebuild_development_database
from learningj.ingest import service as ingest_service


@pytest.fixture()
def dev_client(tmp_path: Path) -> TestClient:
    db_path = tmp_path / "development.db"
    rebuild_development_database(db_path)
    client = TestClient(create_app(f"sqlite:///{db_path}"))
    client.app.state.db_path = db_path  # type: ignore[attr-defined]
    return client


def _epub_blob() -> bytes:
    container = """<?xml version='1.0'?><container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'><rootfiles><rootfile full-path='OEBPS/content.opf'/></rootfiles></container>"""
    opf = """<?xml version='1.0'?><package xmlns='http://www.idpf.org/2007/opf'><manifest><item id='chapter' href='chapter.xhtml' media-type='application/xhtml+xml'/></manifest><spine><itemref idref='chapter'/></spine></package>"""
    xhtml = "<html><body><p>𠮟られた。</p><p>次です。</p></body></html>"
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("META-INF/container.xml", container)
        archive.writestr("OEBPS/content.opf", opf)
        archive.writestr("OEBPS/chapter.xhtml", xhtml)
    return out.getvalue()


def _sidecar_count(conn: sqlite3.Connection, material_id: str) -> int:
    return conn.execute(
        "SELECT count(*) FROM sidecars WHERE material_id = ?",
        (material_id.replace("-", ""),),
    ).fetchone()[0]


def _counts_total(conn: sqlite3.Connection, material_id: str) -> int:
    return conn.execute(
        "SELECT count(*) FROM material_lexeme_counts WHERE material_id = ?",
        (material_id.replace("-", ""),),
    ).fetchone()[0]


def test_all_formats_publish_generation_scoped_counts(dev_client: TestClient) -> None:
    client = dev_client
    samples = [
        ("sample.txt", "𠮟られた。次は君の番です！\n向上心が熱い。", "plain_text", None),
        ("sample.srt", "1\n00:00:01,000 --> 00:00:04,200\nまた寄ってしまった。\n", "subtitle", 1000),
        ("sample.vtt", "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.200\nまた寄ってしまった。\n", "subtitle", 1000),
        ("book.epub", _epub_blob(), "epub", None),
    ]
    for filename, blob, anchor_type, time_start in samples:
        created = client.post(
            "/materials", files={"file": (filename, blob, "application/octet-stream")}
        )
        assert created.status_code == 201, filename
        material = created.json()
        material_id = material["id"]

        sentences = client.get(f"/materials/{material_id}/sentences").json()
        assert sentences[0]["anchor_type"] == anchor_type, filename
        if time_start is not None:
            assert sentences[0]["time_start"] == time_start
            assert sentences[0]["anchor_payload"]["cue_index"] == 0
        if anchor_type == "epub":
            assert sentences[0]["anchor_payload"]["spine_index"] == 0

        sidecar = client.get(f"/materials/{material_id}/sidecar").json()
        assert sidecar["material_id"] == material_id
        # 生成字段与素材当前发布指针一致。
        assert sidecar["sidecar_generation_id"] == material["current_sidecar_id"]

        counts = client.get(f"/materials/{material_id}/lexeme-counts").json()
        assert counts["material_id"] == material_id
        # 同一响应内的词频数据全部属于同一代次。
        assert counts["sidecar_generation_id"] == sidecar["sidecar_generation_id"]
        tokens = [
            token
            for group in sidecar["payload"]["sentences"]
            for token in group["tokens"]
        ]
        assert counts["counts"]
        assert sum(item["token_count"] for item in counts["counts"]) == len(tokens)
        assert all(item["token_count"] > 0 for item in counts["counts"])
        assert all(token["lexeme_id"] for token in tokens)


def test_counts_match_full_payload_rebuild(dev_client: TestClient) -> None:
    """材料词频与全量重建一致：按 sidecar payload 逐 token 重算 == 稀疏索引。"""
    client = dev_client
    for material in client.get("/materials").json():
        material_id = material["id"]
        sidecar = client.get(f"/materials/{material_id}/sidecar").json()
        counts = client.get(f"/materials/{material_id}/lexeme-counts").json()
        recomputed: dict[str, int] = {}
        for group in sidecar["payload"]["sentences"]:
            for token in group["tokens"]:
                recomputed[token["lexeme_id"]] = recomputed.get(token["lexeme_id"], 0) + 1
        assert {item["lexeme_id"]: item["token_count"] for item in counts["counts"]} == recomputed
        # 稀疏性：行按词去重，少于 token 总数。
        assert len(recomputed) < sum(recomputed.values())


def test_retokenize_without_analyzer_change_publishes_nothing(dev_client: TestClient) -> None:
    client = dev_client
    material = client.get("/materials").json()[0]
    material_id = material["id"]
    current = client.get(f"/materials/{material_id}/sidecar").json()

    first = client.post(f"/materials/{material_id}/sidecar/rebuild")
    second = client.post(f"/materials/{material_id}/sidecar/rebuild")
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["sidecar_generation_id"] == current["sidecar_generation_id"]
    assert second.json()["sidecar_generation_id"] == current["sidecar_generation_id"]

    conn = sqlite3.connect(client.app.state.db_path)  # type: ignore[attr-defined]
    try:
        assert conn.execute("SELECT count(*) FROM sidecars").fetchone()[0] == 2
        assert _counts_total(conn, material_id) > 0
    finally:
        conn.close()


def test_retokenize_after_analyzer_upgrade_publishes_new_generation(
    dev_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """词典升级代次切换：新代次原子发布，旧代次行保留且不被覆盖。"""
    client = dev_client
    material = client.get("/materials").json()[0]
    material_id = material["id"]
    old = client.get(f"/materials/{material_id}/sidecar").json()

    real_tokenize = ingest_service._tokenize

    def upgraded_tokenize(sentences, analyzer_dict_version=None):
        payload, tokenizer_version, _ = real_tokenize(sentences, analyzer_dict_version)
        return payload, tokenizer_version, "sudachidict-core-99990101"

    monkeypatch.setattr(ingest_service, "_tokenize", upgraded_tokenize)
    rebuilt = client.post(f"/materials/{material_id}/sidecar/rebuild")
    assert rebuilt.status_code == 200
    new = rebuilt.json()
    assert new["sidecar_generation_id"] != old["sidecar_generation_id"]
    assert new["analyzer_dict_version"] == "sudachidict-core-99990101"
    assert new["content_hash"] == old["content_hash"]

    # 指针原子切换后，公开读取面只见新代次。
    assert client.get(f"/materials/{material_id}/sidecar").json()[
        "sidecar_generation_id"
    ] == new["sidecar_generation_id"]
    assert client.get(f"/materials/{material_id}/lexeme-counts").json()[
        "sidecar_generation_id"
    ] == new["sidecar_generation_id"]
    after = {m["id"]: m for m in client.get("/materials").json()}
    assert after[material_id]["current_sidecar_id"] == new["sidecar_generation_id"]

    # 旧代次持续可读：行未被覆盖或删除，两代词频并存，读者按代次取数。
    conn = sqlite3.connect(client.app.state.db_path)  # type: ignore[attr-defined]
    try:
        generations = conn.execute(
            "SELECT id, analyzer_dict_version, length(payload) FROM sidecars"
            " WHERE material_id = ? ORDER BY created_at",
            (material_id.replace("-", ""),),
        ).fetchall()
        assert [row[1] for row in generations] == [
            old["analyzer_dict_version"],
            "sudachidict-core-99990101",
        ]
        for sidecar_id, _, payload_bytes in generations:
            assert payload_bytes and payload_bytes > 0
            total = conn.execute(
                "SELECT coalesce(sum(token_count), 0) FROM material_lexeme_counts"
                " WHERE sidecar_id = ?",
                (sidecar_id,),
            ).fetchone()[0]
            assert total > 0
    finally:
        conn.close()


def test_failed_publication_preserves_current_generation(
    dev_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """崩溃恢复：提交前失败回滚，旧代次仍是当前代次，无半批产物。"""
    client = dev_client
    material = client.get("/materials").json()[0]
    material_id = material["id"]
    old = client.get(f"/materials/{material_id}/sidecar").json()

    conn = sqlite3.connect(client.app.state.db_path)  # type: ignore[attr-defined]
    try:
        sidecars_before = conn.execute("SELECT count(*) FROM sidecars").fetchone()[0]
        counts_before = conn.execute(
            "SELECT count(*) FROM material_lexeme_counts"
        ).fetchone()[0]
    finally:
        conn.close()

    real_publish = ingest_service._publish_generation
    real_tokenize = ingest_service._tokenize

    def upgraded_tokenize(sentences, analyzer_dict_version=None):
        # 让候选代次与当前代次不同，发布路径才会被触发（否则走幂等早退）。
        payload, tokenizer_version, _ = real_tokenize(sentences, analyzer_dict_version)
        return payload, tokenizer_version, "sudachidict-core-99990101"

    def crash_after_write(session, **kwargs):
        real_publish(session, **kwargs)  # 全部写入完成、指针已切换，但未提交
        raise RuntimeError("simulated crash before commit")

    monkeypatch.setattr(ingest_service, "_tokenize", upgraded_tokenize)
    monkeypatch.setattr(ingest_service, "_publish_generation", crash_after_write)
    response = client.post(f"/materials/{material_id}/sidecar/rebuild")
    assert response.status_code == 422
    assert "simulated crash" in response.json()["detail"]

    conn = sqlite3.connect(client.app.state.db_path)  # type: ignore[attr-defined]
    try:
        assert conn.execute("SELECT count(*) FROM sidecars").fetchone()[0] == sidecars_before
        assert conn.execute("SELECT count(*) FROM material_lexeme_counts").fetchone()[0] == counts_before
        assert conn.execute(
            "SELECT current_sidecar_id FROM materials WHERE id = ?",
            (material_id.replace("-", ""),),
        ).fetchone()[0] == old["sidecar_generation_id"].replace("-", "")
    finally:
        conn.close()


def test_sidecar_rows_reject_update_and_delete(dev_client: TestClient) -> None:
    """不可变 sidecar：UPDATE/DELETE 触发器全部拒绝，重分词只能插入新代次。"""
    client = dev_client
    conn = sqlite3.connect(client.app.state.db_path)  # type: ignore[attr-defined]
    try:
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            conn.execute("UPDATE sidecars SET analyzer_dict_version = 'rewritten'")
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            conn.execute("DELETE FROM sidecars")
    finally:
        conn.close()


def test_rebuild_unknown_material_returns_404(dev_client: TestClient) -> None:
    client = dev_client
    response = client.post(f"/materials/{uuid.uuid4()}/sidecar/rebuild")
    assert response.status_code == 404
