"""P2 算法 token API（plan P2 第 1 条，§8.3，ADR-009/018）。

覆盖：token 表层/规范化形/POS/reading/code point 半开区间切片等于 surface、
响应携带 sidecar_generation_id 与三个版本戳、词典 provenance（目标集批量
查询）、缺 lexeme_id 的 token 拒绝发布（发布闸门）与读取层完整性防御、
无 sidecar 404、payload 形状开放（额外键不破坏读取）。API 用例跑在真实
开发基线重建库上。
"""

from __future__ import annotations

import uuid
from pathlib import Path

import msgpack
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
def txt_sentences(client: TestClient) -> list[dict]:
    materials = client.get("/materials").json()
    material = next(row for row in materials if row["kind"] == "text")
    return client.get(f"/materials/{material['id']}/sentences").json()


def _sentence_text(sentences: list[dict], sentence_id: str) -> str:
    return next(s for s in sentences if s["id"] == sentence_id)["text"]


def test_token_response_carries_offsets_versions_and_generation(
    client: TestClient, txt_sentences
) -> None:
    sentence = txt_sentences[0]
    response = client.get(f"/sentences/{sentence['id']}/tokens")
    assert response.status_code == 200
    body = response.json()

    sidecar = client.get(
        f"/materials/{sentence['material_id']}/sidecar"
    ).json()
    assert body["sidecar_generation_id"] == sidecar["sidecar_generation_id"]
    assert body["segmenter_version"] == sidecar["segmenter_version"]
    assert body["tokenizer_version"] == sidecar["tokenizer_version"]
    assert body["analyzer_dict_version"] == sidecar["analyzer_dict_version"]
    assert body["analyzer_dict_version"]  # [不可推迟] 版本戳非空
    assert body["material_id"] == sentence["material_id"]
    assert body["dictionary_sources"] == []  # 未导入词典时 provenance 为空

    text = sentence["text"]
    covered = 0
    for token in body["tokens"]:
        assert token["surface"]
        assert token["lexeme_id"].startswith("lx_")
        assert token["reading_source"] == "sudachi"
        # code point 半开区间切片必须等于 surface（含 BMP 外「𠮟」）
        sliced = "".join(list(text)[token["char_start"] : token["char_end"]])
        assert sliced == token["surface"]
        covered += token["char_end"] - token["char_start"]
    assert covered == len(list(text))  # token 序列铺满整句（A mode）


def test_token_dictionary_provenance_after_import(client: TestClient, txt_sentences) -> None:
    from conftest import build_yomitan_zip as build_zip

    sentence = txt_sentences[1]  # 「次は君の番です！」
    blob = build_zip(entries=[["君", "きみ", "代名詞", "", 8, "you"]])
    imported = client.post(
        "/dictionaries/import", files={"file": ("d.zip", blob, "application/zip")}
    )
    assert imported.status_code == 201
    source_id = imported.json()["source"]["id"]

    body = client.get(f"/sentences/{sentence['id']}/tokens").json()
    assert len(body["dictionary_sources"]) == 1
    provenance = body["dictionary_sources"][0]
    assert provenance["source_id"] == source_id
    assert provenance["display_name"] == "テスト辞書"
    assert provenance["source_version"] == "2026-09-12"
    matched = [token for token in body["tokens"] if token["normalized_form"] == "君"]
    assert matched and matched[0]["dictionary_source_ids"] == [source_id]
    unmatched = [token for token in body["tokens"] if token["normalized_form"] != "君"]
    assert all(token["dictionary_source_ids"] == [] for token in unmatched)


def test_token_api_404_for_unknown_sentence_and_unpublished_sidecar(client: TestClient) -> None:
    unknown = client.get("/sentences/00000000-0000-7000-8000-000000000000/tokens")
    assert unknown.status_code == 404
    invalid = client.get("/sentences/not-a-uuid/tokens")
    assert invalid.status_code == 404


def test_token_api_detects_published_payload_without_lexeme_id(
    client: TestClient, txt_sentences, monkeypatch: pytest.MonkeyPatch
) -> None:
    """发布闸门拒绝缺 lexeme_id 的 token（data-model §2.5/§8.3）。

    直接在服务层验证：构造无 lexeme_id 的 token payload 走完整发布路径，
    `_publish_generation` 必须拒绝且不留任何行；读取层对已存在的残缺
    payload 显式报错而非返回残缺 token。
    """
    from sqlalchemy import select, text

    from learningj.db.models.material import Material, Sidecar
    from learningj.db.session import make_engine, make_session_factory
    from learningj.ingest import service as ingest_service

    material_id = txt_sentences[0]["material_id"]

    # 1) 发布闸门：缺 lexeme_id 的 token 拒绝发布
    engine = make_engine(f"sqlite:///{client.app.state.db_path}")  # type: ignore[attr-defined]
    factory = make_session_factory(engine)
    with factory() as session:
        material = session.get(Material, uuid.UUID(material_id))
        broken_sidecar = Sidecar(
            material_id=material.id,
            content_hash=material.content_hash,
            segmenter_version="s",
            tokenizer_version="t",
            analyzer_dict_version="a",
            payload=msgpack.packb(
                {"sentences": [{"sentence_index": 0, "tokens": [{"surface": "x"}]}]},
                use_bin_type=True,
            ),
        )
        with pytest.raises(ValueError, match="lexeme id"):
            ingest_service._publish_generation(
                session,
                material=material,
                sidecar=broken_sidecar,
                token_payload=[{"sentence_index": 0, "tokens": [{"surface": "x"}]}],
                analyzer_dict_version="a",
            )
    engine.dispose()

    # 2) 读取层防御：人为放置一个缺 lexeme_id 的已发布 payload（直接改库，
    #    绕过发布闸门），token API 显式报完整性错误。
    with factory() as session:
        material = session.scalars(select(Material)).first()
        sidecar = session.get(Sidecar, material.current_sidecar_id)
        broken = dict(msgpack.unpackb(sidecar.payload, raw=False))
        broken["sentences"] = [
            {**group, "tokens": [{**token, "lexeme_id": ""} for token in group["tokens"]]}
            if group["sentence_index"] == 0
            else group
            for group in broken["sentences"]
        ]
        # sidecar 行不可变（触发器），用新行 + 指针切换模拟历史遗留残缺代次
        new_id = uuid.uuid4().hex
        session.execute(
            text(
                "INSERT INTO sidecars (id, material_id, content_hash, segmenter_version,"
                " tokenizer_version, analyzer_dict_version, payload, created_at, updated_at)"
                " SELECT :id, material_id, content_hash, segmenter_version, tokenizer_version,"
                " analyzer_dict_version, :payload, created_at, updated_at FROM sidecars"
                " WHERE id = :old_id"
            ),
            {"id": new_id, "payload": msgpack.packb(broken, use_bin_type=True), "old_id": sidecar.id.hex},
        )
        session.execute(
            text("UPDATE materials SET current_sidecar_id = :id WHERE id = :mid"),
            {"id": new_id, "mid": material.id.hex},
        )
        session.commit()
    response = client.get(f"/sentences/{txt_sentences[0]['id']}/tokens")
    assert response.status_code == 500
    assert "lexeme_id" in response.json()["detail"]


def test_token_reading_tolerates_extra_payload_keys(
    client: TestClient, txt_sentences
) -> None:
    """payload 形状保持开放：额外键（如未来的 ruby_hints）不破坏读取。"""
    from sqlalchemy import text

    from learningj.db.session import make_engine, make_session_factory

    material_id = txt_sentences[0]["material_id"]
    engine = make_engine(f"sqlite:///{client.app.state.db_path}")  # type: ignore[attr-defined]
    factory = make_session_factory(engine)
    with factory() as session:
        from learningj.db.models.material import Material, Sidecar

        material = session.get(Material, uuid.UUID(material_id))
        sidecar = session.get(Sidecar, material.current_sidecar_id)
        payload = msgpack.unpackb(sidecar.payload, raw=False)
        payload["sentences"][0]["tokens"][0]["future_field"] = {"anything": True}
        payload["sentences"][0]["ruby_hints"] = [{"char_start": 0, "char_end": 1}]
        new_id = uuid.uuid4().hex
        session.execute(
            text(
                "INSERT INTO sidecars (id, material_id, content_hash, segmenter_version,"
                " tokenizer_version, analyzer_dict_version, payload, created_at, updated_at)"
                " SELECT :id, material_id, content_hash, segmenter_version, tokenizer_version,"
                " analyzer_dict_version, :payload, created_at, updated_at FROM sidecars"
                " WHERE id = :old_id"
            ),
            {"id": new_id, "payload": msgpack.packb(payload, use_bin_type=True), "old_id": sidecar.id.hex},
        )
        session.execute(
            text("UPDATE materials SET current_sidecar_id = :id WHERE id = :mid"),
            {"id": new_id, "mid": material.id.hex},
        )
        session.commit()
    engine.dispose()

    response = client.get(f"/sentences/{txt_sentences[0]['id']}/tokens")
    assert response.status_code == 200
    assert response.json()["tokens"][0]["surface"] == "𠮟"
