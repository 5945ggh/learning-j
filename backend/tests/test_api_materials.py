from __future__ import annotations

from fastapi.testclient import TestClient

from learningj.api.app import create_app
from learningj.db.base import Base
from learningj.db.models.invariant_triggers import install_invariant_triggers
from learningj.db.session import make_engine


def test_material_api_lists_and_reads_sentences(tmp_path):
    db_path = tmp_path / "api.db"
    engine = make_engine(db_path)
    Base.metadata.create_all(engine)
    install_invariant_triggers(engine)
    client = TestClient(create_app(f"sqlite:///{db_path}"))

    response = client.post(
        "/materials",
        files={"file": ("lesson.txt", "𠮟られた。次です！", "text/plain")},
    )
    assert response.status_code == 201
    material = response.json()
    assert material["kind"] == "text"
    assert material["sentence_count"] == 2

    listed = client.get("/materials")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == material["id"]
    sentences = client.get(f"/materials/{material['id']}/sentences")
    assert sentences.status_code == 200
    assert [item["text"] for item in sentences.json()] == ["𠮟られた。", "次です！"]
    sidecar = client.get(f"/materials/{material['id']}/sidecar").json()
    assert sidecar["analyzer_dict_version"]
    assert sidecar["payload"]["sentences"][0]["tokens"]


def test_material_api_rejects_unknown_extension(tmp_path):
    db_path = tmp_path / "api.db"
    engine = make_engine(db_path)
    Base.metadata.create_all(engine)
    install_invariant_triggers(engine)
    client = TestClient(create_app(f"sqlite:///{db_path}"))
    response = client.post("/materials", files={"file": ("bad.pdf", b"x", "application/pdf")})
    assert response.status_code == 415
