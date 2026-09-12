"""P2 Annotation（`data-model.md` §5，ADR-030，ADR-009）。

覆盖：surface 由后端 find_all 定位（code point 半开）、切片回读等于
surface（§9 不变量 6 的生产者补测）、token 对齐（aligned/partial/unaligned）、
跨句有序 Span 数组、多命中全 ambiguous、筛选（文本/时间）与跳回原文数据、
删除与引用清理、创建/读取不产生 KP 或 KE（§9 不变量 8 的生产面）、
写后读一致。API 用例跑在真实开发基线重建库上。
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from learningj.api.app import create_app
from learningj.db.maintenance import rebuild_development_database


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    db_path = tmp_path / "development.db"
    rebuild_development_database(db_path)
    client = TestClient(create_app(f"sqlite:///{db_path}", assets_root=tmp_path / "assets"))
    client.app.state.db_path = db_path  # type: ignore[attr-defined]
    return client


@pytest.fixture()
def txt_material(client: TestClient) -> tuple[str, list[dict]]:
    materials = client.get("/materials").json()
    material = next(row for row in materials if row["kind"] == "text")
    sentences = client.get(f"/materials/{material['id']}/sentences").json()
    return material["id"], sentences


def _rows(client: TestClient, sql: str) -> list[tuple]:
    with sqlite3.connect(client.app.state.db_path) as conn:  # type: ignore[attr-defined]
        return conn.execute(sql).fetchall()


def test_annotation_span_is_located_by_backend_and_slices_back_to_surface(
    client: TestClient, txt_material
) -> None:
    """§9 不变量 6（生产者补测）：用户选区只给 surface，偏移由后端定位，
    存储后切片回读必须等于 surface；「𠮟」是单个 code point。"""
    material_id, sentences = txt_material
    response = client.post(
        f"/materials/{material_id}/annotations",
        json={"spans": [{"sentence_id": sentences[0]["id"], "surface": "𠮟られた"}]},
    )
    assert response.status_code == 201
    span = response.json()["spans"][0]
    assert span["char_start"] == 0 and span["char_end"] == 4
    assert span["alignment_status"] == "aligned"
    assert span["token_start"] == 0 and span["token_end"] == 3
    assert span["alignment_sidecar_id"]

    sentence_text = next(s for s in sentences if s["id"] == span["sentence_id"])["text"]
    sliced = "".join(list(sentence_text)[span["char_start"] : span["char_end"]])
    assert sliced == span["surface"]


def test_cross_sentence_annotation_keeps_ordered_span_array(
    client: TestClient, txt_material
) -> None:
    material_id, sentences = txt_material
    response = client.post(
        f"/materials/{material_id}/annotations",
        json={
            "spans": [
                {"sentence_id": sentences[0]["id"], "surface": "𠮟られた"},
                {"sentence_id": sentences[2]["id"], "surface": "向上心"},
            ],
            "note": "跨句划线",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert [span["sentence_id"] for span in body["spans"]] == [
        sentences[0]["id"],
        sentences[2]["id"],
    ]
    assert [span["surface"] for span in body["spans"]] == ["𠮟られた", "向上心"]

    listed = client.get(f"/materials/{material_id}/annotations").json()
    assert listed[0]["id"] == body["id"]
    assert len(listed[0]["spans"]) == 2


def test_multi_hit_surface_creates_ambiguous_spans(client: TestClient) -> None:
    materials = client.get("/materials").json()
    subtitle = next(row for row in materials if row["kind"] == "subtitle_video")
    srt_sentences = client.get(f"/materials/{subtitle['id']}/sentences").json()
    # 「また寄ってしまった。」中「っ」出现两次 → 每处一个 Span，全部 ambiguous
    response = client.post(
        f"/materials/{subtitle['id']}/annotations",
        json={"spans": [{"sentence_id": srt_sentences[0]["id"], "surface": "っ"}]},
    )
    assert response.status_code == 201
    spans = response.json()["spans"]
    assert len(spans) == 2
    assert all(span["alignment_status"] == "ambiguous" for span in spans)
    assert spans[0]["char_start"] < spans[1]["char_start"]
    for span in spans:
        sentence_text = next(
            s for s in srt_sentences if s["id"] == span["sentence_id"]
        )["text"]
        assert "".join(list(sentence_text)[span["char_start"] : span["char_end"]]) == "っ"


def test_partial_alignment_when_boundaries_miss_tokens(client: TestClient, txt_material) -> None:
    material_id, sentences = txt_material
    # 「𠮟ら」起点落在 token 边界、终点落在「られ」token 内部 → partial
    response = client.post(
        f"/materials/{material_id}/annotations",
        json={"spans": [{"sentence_id": sentences[0]["id"], "surface": "𠮟ら"}]},
    )
    assert response.status_code == 201
    span = response.json()["spans"][0]
    assert span["alignment_status"] == "partial"
    assert span["token_start"] is None and span["token_end"] is None


def test_annotation_input_validation(client: TestClient, txt_material) -> None:
    material_id, sentences = txt_material
    other_material = next(
        row for row in client.get("/materials").json() if row["id"] != material_id
    )
    other_sentences = client.get(f"/materials/{other_material['id']}/sentences").json()

    missing_surface = client.post(
        f"/materials/{material_id}/annotations",
        json={"spans": [{"sentence_id": sentences[0]["id"], "surface": "没有这句"}]},
    )
    assert missing_surface.status_code == 422
    assert "未命中" in missing_surface.json()["detail"]

    empty_surface = client.post(
        f"/materials/{material_id}/annotations",
        json={"spans": [{"sentence_id": sentences[0]["id"], "surface": ""}]},
    )
    assert empty_surface.status_code == 422

    no_spans = client.post(f"/materials/{material_id}/annotations", json={"spans": []})
    assert no_spans.status_code == 422

    cross_material = client.post(
        f"/materials/{material_id}/annotations",
        json={"spans": [{"sentence_id": other_sentences[0]["id"], "surface": "また"}]},
    )
    assert cross_material.status_code == 404

    unknown_material = client.post(
        "/materials/00000000-0000-7000-8000-000000000000/annotations",
        json={"spans": [{"sentence_id": sentences[0]["id"], "surface": "𠮟られた"}]},
    )
    assert unknown_material.status_code == 404


def test_annotation_filters_by_text_and_time(client: TestClient, txt_material) -> None:
    material_id, sentences = txt_material
    first = client.post(
        f"/materials/{material_id}/annotations",
        json={
            "spans": [{"sentence_id": sentences[0]["id"], "surface": "𠮟られた"}],
            "note": "要注意活用",
        },
    )
    assert first.status_code == 201
    second = client.post(
        f"/materials/{material_id}/annotations",
        json={
            "spans": [{"sentence_id": sentences[2]["id"], "surface": "向上心"}],
            "note": "名词",
        },
    )
    assert second.status_code == 201

    by_note = client.get(f"/materials/{material_id}/annotations", params={"q": "活用"})
    assert [row["id"] for row in by_note.json()] == [first.json()["id"]]
    by_surface = client.get(f"/materials/{material_id}/annotations", params={"q": "向上"})
    assert [row["id"] for row in by_surface.json()] == [second.json()["id"]]

    # created_at 升序边界：since 覆盖第二条之后 → 只剩第一条之后创建的
    created_second = second.json()["created_at"]
    after = client.get(
        f"/materials/{material_id}/annotations", params={"since": created_second}
    )
    assert [row["id"] for row in after.json()] == [second.json()["id"]]

    # surface 上的筛选同样支持跳回原文（span 位置数据齐全）
    by_note_body = by_note.json()[0]
    assert by_note_body["spans"][0]["char_start"] == 0


def test_delete_annotation_cleans_unreferenced_spans(client: TestClient, txt_material) -> None:
    material_id, sentences = txt_material
    created = client.post(
        f"/materials/{material_id}/annotations",
        json={"spans": [{"sentence_id": sentences[0]["id"], "surface": "𠮟られた"}]},
    )
    annotation_id = created.json()["id"]
    assert _rows(client, "SELECT count(*) FROM spans")[0][0] >= 1

    deleted = client.delete(f"/annotations/{annotation_id}")
    assert deleted.status_code == 204
    assert client.delete(f"/annotations/{annotation_id}").status_code == 404
    assert _rows(client, "SELECT count(*) FROM annotations")[0][0] == 0
    assert _rows(client, "SELECT count(*) FROM spans")[0][0] == 0
    assert _rows(client, "SELECT count(*) FROM annotation_spans")[0][0] == 0


def test_annotation_never_creates_kp_or_ke_and_reads_are_immediate(
    client: TestClient, txt_material
) -> None:
    """§9 不变量 8（生产面）：划线、筛选与读取不产生 KE 或裁定。"""
    material_id, sentences = txt_material
    client.post(
        f"/materials/{material_id}/annotations",
        json={
            "spans": [{"sentence_id": sentences[0]["id"], "surface": "𠮟られた"}],
            "note": "划一",
            "color": "yellow",
        },
    )
    client.get(f"/materials/{material_id}/annotations")
    client.get(f"/materials/{material_id}/annotations", params={"q": "划一"})
    assert _rows(client, "SELECT count(*) FROM known_evidence")[0][0] == 0
    assert _rows(client, "SELECT count(*) FROM lexeme_knowledge_decisions")[0][0] == 0
    # body 中没有学习语义：划线只是原文数据
    body = client.get(f"/materials/{material_id}/annotations").json()[0]
    assert body["note"] == "划一"
    assert {"span_id", "sentence_id", "surface", "char_start", "char_end"} <= set(
        body["spans"][0]
    )
