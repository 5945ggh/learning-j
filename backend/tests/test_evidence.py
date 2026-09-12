"""P2 Lexeme 证据与用户裁定（`data-model.md` §2.2/§2.5，ADR-040，§9 不变量 21）。

覆盖：scope_form_key 派生规则（lexeme:/form:+NFC、空词形拒绝、不折叠）、
known 与 user_asserted KE 同事务产生、unknown 压过合成导入事实（测试夹具
直接构造 import_anki KE，不提前实现 KnownImportRun 或 ReviewEvent 生产者）、
clear 不复活旧人工 KE、词形→Lexeme 回退、撤回保历史并原子失效（同事务
追加 clear）、operation_key 幂等/冲突、写后读一致与同事务投影失效、
摘要可重建。
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from learningj.api.app import create_app
from learningj.db.maintenance import rebuild_development_database
from learningj.domain.scopes import (
    FORM_SCOPE_PREFIX,
    LEXEME_SCOPE_KEY,
    derive_scope_form_key,
)


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    db_path = tmp_path / "development.db"
    rebuild_development_database(db_path)
    client = TestClient(create_app(f"sqlite:///{db_path}", assets_root=tmp_path / "assets"))
    client.app.state.db_path = db_path  # type: ignore[attr-defined]
    return client


@pytest.fixture()
def material_and_lexeme(client: TestClient) -> tuple[str, str, str]:
    """(material_id, lexeme_id, surface)——取 fixture 句子的第一个真实词元。"""
    materials = client.get("/materials").json()
    material = next(row for row in materials if row["kind"] == "text")
    sentence = client.get(f"/materials/{material['id']}/sentences").json()[0]
    tokens = client.get(f"/sentences/{sentence['id']}/tokens").json()["tokens"]
    token = tokens[0]
    return material["id"], token["lexeme_id"], token["surface"]


def _rows(client: TestClient, sql: str) -> list[tuple]:
    with sqlite3.connect(client.app.state.db_path) as conn:  # type: ignore[attr-defined]
        return conn.execute(sql).fetchall()


def _synthetic_import_ke(client: TestClient, lexeme_id: str) -> str:
    """按 plan P2 测试边界直接构造合成导入事实（不实现 KnownImportRun）。

    import_anki KE 须带 analyzer_dict_version/resolver_version/scope 等契约
    字段；插入后重建该词元的摘要投影（合成事实绕过服务写路径）。
    """
    from sqlalchemy import text

    from learningj.db.session import make_engine, make_session_factory
    from learningj.domain import versions
    from learningj.evidence import service as evidence_service

    engine = make_engine(f"sqlite:///{client.app.state.db_path}")  # type: ignore[attr-defined]
    with make_session_factory(engine)() as session:
        session.execute(
            text(
                "INSERT INTO known_evidence (id, lexeme_id, conjugated_form, scope_form_key,"
                " source, confidence, observed_at, observed_at_basis, analyzer_dict_version,"
                " resolver_version, input_surface, input_reading, operation_key,"
                " created_at, updated_at)"
                " VALUES (:id, :lexeme_id, NULL, 'lexeme:', 'import_anki', 0.8, :observed,"
                " 'external', :adv, :rv, '合成输入', NULL, :op, :observed, :observed)"
            ),
            {
                "id": uuid.uuid4().hex,
                "lexeme_id": lexeme_id,
                "observed": datetime.now(timezone.utc).isoformat(),
                "adv": versions.analyzer_dict_version(),
                "rv": "learningj-scope-resolver-v1",
                "op": f"synthetic-import-{lexeme_id[:12]}",
            },
        )
        session.commit()
        evidence_service.rebuild_summaries(session, lexeme_ids=[lexeme_id])
        session.commit()
    engine.dispose()
    return lexeme_id


def test_scope_key_derivation_rules() -> None:
    assert derive_scope_form_key(None) == "lexeme:"
    assert derive_scope_form_key("走った") == f"{FORM_SCOPE_PREFIX}走った"
    # NFC 归一化（が → U+304C 单码点）
    assert derive_scope_form_key("が") == f"{FORM_SCOPE_PREFIX}が"
    with pytest.raises(ValueError):
        derive_scope_form_key("")
    # 不 trim、不做宽窄折叠
    assert derive_scope_form_key(" 走 ") == f"{FORM_SCOPE_PREFIX} 走 "
    assert derive_scope_form_key("ＡＢ") == f"{FORM_SCOPE_PREFIX}ＡＢ"


def test_known_decision_creates_referenced_user_asserted_ke_in_same_transaction(
    client: TestClient, material_and_lexeme
) -> None:
    material_id, lexeme_id, surface = material_and_lexeme
    response = client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "known",
            "input_surface": surface,
            "material_id": material_id,
            "operation_key": "op-known-1",
            "expected_decision_seq": 0,
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["created"] is True
    assert body["scope_form_key"] == "lexeme:"
    assert body["decision_seq"] == 1
    assert body["evidence_id"]

    evidence = _rows(
        client,
        f"SELECT source, confidence, observed_at_basis, analyzer_dict_version,"
        f" resolver_version, input_surface FROM known_evidence"
        f" WHERE id = '{body['evidence_id'].replace('-', '')}'",
    )[0]
    assert evidence[0] == "user_asserted"
    assert evidence[1] == 1.0
    assert evidence[2] == "user_action"
    assert evidence[3] and evidence[4]  # 版本戳非空（§9 不变量 5 的 KE 侧生产面）
    assert evidence[5] == surface

    # 摘要与写事务同步更新：立即读取可见（写后读一致）
    summary = client.get(f"/lexemes/{lexeme_id}/evidence-summary").json()
    scope = next(s for s in summary["scopes"] if s["scope_form_key"] == "lexeme:")
    assert scope["current_decision"] == "known"
    assert scope["valid_source_counts"] == {"user_asserted": 1}
    assert scope["input_revision"] == summary["projection_revision"]


def test_decision_operation_key_idempotency_and_conflict(
    client: TestClient, material_and_lexeme
) -> None:
    _, lexeme_id, surface = material_and_lexeme
    payload = {
        "decision": "unknown",
        "input_surface": surface,
        "operation_key": "op-x",
        "expected_decision_seq": 0,
    }
    first = client.post(f"/lexemes/{lexeme_id}/decisions", json=payload)
    replay = client.post(f"/lexemes/{lexeme_id}/decisions", json=payload)
    assert first.status_code == 201 and replay.status_code == 200
    assert replay.json()["created"] is False
    assert replay.json()["decision_id"] == first.json()["decision_id"]
    # 同键同输入不再追加决定
    assert _rows(client, "SELECT count(*) FROM lexeme_knowledge_decisions")[0][0] == 1

    conflicting = client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "known",
            "input_surface": surface,
            "operation_key": "op-x",
            "expected_decision_seq": 0,
        },
    )
    assert conflicting.status_code == 409

    unknown_lexeme = "lx_" + "0" * 64
    assert (
        client.post(
            f"/lexemes/{unknown_lexeme}/decisions",
            json={
                "decision": "unknown",
                "input_surface": "x",
                "operation_key": "op-y",
                "expected_decision_seq": 0,
            },
        ).status_code
        == 404
    )
    empty_form = client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "unknown",
            "input_surface": "x",
            "conjugated_form": "",
            "operation_key": "op-z",
            "expected_decision_seq": 0,
        },
    )
    assert empty_form.status_code == 422


def test_known_replay_reads_input_from_referenced_evidence_and_expected_seq(
    client: TestClient, material_and_lexeme
) -> None:
    _, lexeme_id, surface = material_and_lexeme
    missing_token = client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={"decision": "unknown", "input_surface": surface, "operation_key": "op-missing-seq"},
    )
    assert missing_token.status_code == 422
    payload = {
        "decision": "known",
        "input_surface": surface,
        "operation_key": "op-known-replay",
        "expected_decision_seq": 0,
    }
    first = client.post(f"/lexemes/{lexeme_id}/decisions", json=payload)
    replay = client.post(f"/lexemes/{lexeme_id}/decisions", json=payload)
    assert first.status_code == 201 and replay.status_code == 200
    assert replay.json()["decision_id"] == first.json()["decision_id"]

    # A stale optimistic-concurrency token is a visible conflict, not a
    # database UNIQUE/IntegrityError response.
    stale = client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "unknown",
            "input_surface": surface,
            "operation_key": "op-stale-seq",
            "expected_decision_seq": 0,
        },
    )
    assert stale.status_code == 409

    fresh = client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "unknown",
            "input_surface": surface,
            "operation_key": "op-fresh-seq",
            "expected_decision_seq": 1,
        },
    )
    assert fresh.status_code == 201 and fresh.json()["decision_seq"] == 2

    changed_surface = client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={**payload, "input_surface": "不同表层"},
    )
    assert changed_surface.status_code == 409


def test_unknown_overrides_synthetic_import_facts(
    client: TestClient, material_and_lexeme
) -> None:
    """§9 不变量 21：unknown 是当前明确否认，压过该作用域的导入估计；
    不伪造负向 KE，不删除历史。"""
    _, lexeme_id, surface = material_and_lexeme
    _synthetic_import_ke(client, lexeme_id)

    before = client.post(
        "/lexemes/known-views/batch", json={"items": [{"lexeme_id": lexeme_id}]}
    ).json()["items"][0]
    assert before["effective"]["state"] == "known"
    assert before["effective"]["basis"] == "import_evidence"

    unknown = client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "unknown",
            "input_surface": surface,
            "operation_key": "op-unknown",
            "expected_decision_seq": 0,
        },
    )
    assert unknown.status_code == 201
    after = client.post(
        "/lexemes/known-views/batch", json={"items": [{"lexeme_id": lexeme_id}]}
    ).json()["items"][0]
    assert after["effective"]["state"] == "unknown"
    assert after["effective"]["basis"] == "lexeme_decision"
    # 导入事实保留（未被删除），只是被裁定压过
    lexeme_scope = after["lexeme_scope"]
    assert lexeme_scope["valid_source_counts"]["import_anki"] == 1
    assert _rows(client, "SELECT count(*) FROM known_evidence WHERE source='import_anki'")[0][0] == 1


def test_clear_removes_user_override_without_reactivating_old_user_ke(
    client: TestClient, material_and_lexeme
) -> None:
    _, lexeme_id, surface = material_and_lexeme
    known = client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "known",
            "input_surface": surface,
            "operation_key": "op-k1",
            "expected_decision_seq": 0,
        },
    ).json()
    client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "clear",
            "input_surface": surface,
            "operation_key": "op-c1",
            "expected_decision_seq": 1,
        },
    )
    view = client.post(
        "/lexemes/known-views/batch", json={"items": [{"lexeme_id": lexeme_id}]}
    ).json()["items"][0]
    # clear 后回到其他来源求值：无导入 → 无有效状态；旧 user_asserted KE
    # 仍是有效历史（未撤回）但不再贡献——只有被当前 known 引用的用户来源贡献。
    assert view["effective"]["state"] is None
    assert view["lexeme_scope"]["valid_source_counts"] == {"user_asserted": 1}
    assert view["lexeme_scope"]["current_decision"] == "clear"

    # re-known 建立新 KE + 新决定（纠错不改写原记录）
    reknown = client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "known",
            "input_surface": surface,
            "operation_key": "op-k2",
            "expected_decision_seq": 2,
        },
    ).json()
    assert reknown["evidence_id"] != known["evidence_id"]
    assert reknown["decision_seq"] == 3
    view2 = client.post(
        "/lexemes/known-views/batch", json={"items": [{"lexeme_id": lexeme_id}]}
    ).json()["items"][0]
    assert view2["effective"]["state"] == "known"


def test_clear_falls_back_to_import_but_unknown_beats_it(
    client: TestClient, material_and_lexeme
) -> None:
    _, lexeme_id, surface = material_and_lexeme
    _synthetic_import_ke(client, lexeme_id)
    client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "unknown",
            "input_surface": surface,
            "operation_key": "op-u1",
            "expected_decision_seq": 0,
        },
    )
    client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "clear",
            "input_surface": surface,
            "operation_key": "op-c1",
            "expected_decision_seq": 1,
        },
    )
    view = client.post(
        "/lexemes/known-views/batch", json={"items": [{"lexeme_id": lexeme_id}]}
    ).json()["items"][0]
    # clear 只清除人工覆盖 → 回到导入支持
    assert view["effective"] == {
        "state": "known",
        "basis": "import_evidence",
        "decision_id": None,
        "evidence_id": None,
    }


def test_word_form_scope_precedence_and_lexeme_summary_isolation(
    client: TestClient, material_and_lexeme
) -> None:
    _, lexeme_id, surface = material_and_lexeme
    form = surface
    client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "known",
            "input_surface": surface,
            "operation_key": "op-lex",
            "expected_decision_seq": 0,
        },
    )
    client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "unknown",
            "input_surface": form,
            "conjugated_form": form,
            "operation_key": "op-form",
            "expected_decision_seq": 0,
        },
    )
    view = client.post(
        "/lexemes/known-views/batch",
        json={"items": [{"lexeme_id": lexeme_id, "form": form}]},
    ).json()["items"][0]
    # 词形 unknown 先于 Lexeme 级 known
    assert view["effective"]["state"] == "unknown"
    assert view["effective"]["basis"] == "form_decision"
    assert view["form_scope"]["scope_form_key"] == f"{FORM_SCOPE_PREFIX}{form}"
    assert view["lexeme_scope"]["current_decision"] == "known"
    # Lexeme 级摘要不受词形裁定影响（词形不提升/不压低整词结论）：
    # lexeme 作用域摘要只计 Lexeme 级证据与裁定。
    summary = client.get(f"/lexemes/{lexeme_id}/evidence-summary").json()
    lexeme_scope = next(s for s in summary["scopes"] if s["scope_form_key"] == "lexeme:")
    assert lexeme_scope["current_decision"] == "known"
    assert lexeme_scope["valid_source_counts"] == {"user_asserted": 1}
    assert lexeme_scope["scope_form_key"] == "lexeme:"

    # clear 词形 → 回退 Lexeme 级裁定
    client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "clear",
            "input_surface": form,
            "conjugated_form": form,
            "operation_key": "op-form-clear",
            "expected_decision_seq": 1,
        },
    )
    view2 = client.post(
        "/lexemes/known-views/batch",
        json={"items": [{"lexeme_id": lexeme_id, "form": form}]},
    ).json()["items"][0]
    assert view2["effective"]["state"] == "known"
    assert view2["effective"]["basis"] == "lexeme_decision"


def test_retraction_keeps_history_and_atomically_appends_clear(
    client: TestClient, material_and_lexeme
) -> None:
    _, lexeme_id, surface = material_and_lexeme
    decision = client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "known",
            "input_surface": surface,
            "operation_key": "op-k1",
            "expected_decision_seq": 0,
        },
    ).json()
    evidence_id = decision["evidence_id"]

    retracted = client.post(
        f"/known-evidence/{evidence_id}/retractions",
        json={"reason": "误点", "operation_key": "op-r1"},
    )
    assert retracted.status_code == 201
    assert retracted.json()["appended_clear"] is True

    # 同事务效果：撤回后立即读 → known 已被 clear 替代，不回退更旧决定
    view = client.post(
        "/lexemes/known-views/batch", json={"items": [{"lexeme_id": lexeme_id}]}
    ).json()["items"][0]
    assert view["effective"]["state"] is None
    assert view["lexeme_scope"]["current_decision"] == "clear"
    assert view["lexeme_scope"]["current_decision_seq"] == 2

    # 历史保留：KE 与两个决定都在，撤回是追加记录
    assert _rows(client, "SELECT count(*) FROM known_evidence")[0][0] == 1
    assert _rows(client, "SELECT count(*) FROM lexeme_knowledge_decisions")[0][0] == 2
    assert _rows(client, "SELECT count(*) FROM known_evidence_retractions")[0][0] == 1
    listing = client.get(f"/lexemes/{lexeme_id}/evidence").json()["items"]
    assert listing[0]["retracted"] is True and listing[0]["retraction_id"]

    # 撤回后的同键重试返回原结果并说明已撤回
    replay = client.post(
        f"/known-evidence/{evidence_id}/retractions",
        json={"reason": "误点", "operation_key": "op-r1"},
    )
    assert replay.status_code == 200
    assert replay.json()["created"] is False
    changed_reason = client.post(
        f"/known-evidence/{evidence_id}/retractions",
        json={"reason": "不同原因", "operation_key": "op-r1"},
    )
    assert changed_reason.status_code == 409
    # 换键重复撤回同一证据 → 冲突
    second_key = client.post(
        f"/known-evidence/{evidence_id}/retractions",
        json={"operation_key": "op-r2"},
    )
    assert second_key.status_code == 409
    # unknown 之后撤回旧 KE 不追加 clear（当前决定不是引用它的 known）
    other = client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "known",
            "input_surface": surface,
            "operation_key": "op-k2",
            "expected_decision_seq": 2,
        },
    ).json()
    client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "unknown",
            "input_surface": surface,
            "operation_key": "op-u1",
            "expected_decision_seq": 3,
        },
    )
    retract_other = client.post(
        f"/known-evidence/{other['evidence_id']}/retractions",
        json={"operation_key": "op-r3"},
    )
    assert retract_other.status_code == 201
    assert retract_other.json()["appended_clear"] is False
    # 当前裁定保持 unknown（不因撤回回退），全部 KE 均已撤回 → 有效支持为空
    summary = client.get(f"/lexemes/{lexeme_id}/evidence-summary").json()
    scope = next(s for s in summary["scopes"] if s["scope_form_key"] == "lexeme:")
    assert scope["current_decision"] == "unknown"
    assert scope["valid_source_counts"] == {}


def test_retraction_internal_clear_key_does_not_collide_with_user_key(
    client: TestClient, material_and_lexeme
) -> None:
    _, lexeme_id, surface = material_and_lexeme
    known = client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "known",
            "input_surface": surface,
            "operation_key": "op-r-clear",
            "expected_decision_seq": 0,
        },
    ).json()
    # Occupy the old `{operation_key}#clear` spelling in an unrelated scope.
    occupied = client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "unknown",
            "input_surface": surface,
            "conjugated_form": "其他作用域",
            "operation_key": "op-r-clear#clear",
            "expected_decision_seq": 0,
        },
    )
    assert occupied.status_code == 201
    retracted = client.post(
        f"/known-evidence/{known['evidence_id']}/retractions",
        json={"operation_key": "op-r-clear"},
    )
    assert retracted.status_code == 201
    assert retracted.json()["appended_clear"] is True


def test_projection_revision_records_every_write_atomically(
    client: TestClient, material_and_lexeme
) -> None:
    _, lexeme_id, surface = material_and_lexeme
    base = client.get(f"/lexemes/{lexeme_id}/evidence-summary").json()["projection_revision"]
    client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "known",
            "input_surface": surface,
            "operation_key": "op-r1",
            "expected_decision_seq": 0,
        },
    )
    after_known = client.get(f"/lexemes/{lexeme_id}/evidence-summary").json()["projection_revision"]
    assert after_known == base + 1
    evidence_id = _rows(client, "SELECT id FROM known_evidence LIMIT 1")[0][0]
    client.post(
        f"/known-evidence/{evidence_id}/retractions", json={"operation_key": "op-r2"}
    )
    after_retract = client.get(f"/lexemes/{lexeme_id}/evidence-summary").json()["projection_revision"]
    assert after_retract == after_known + 1
    # 同键重放不再递增
    evidence_hex = str(evidence_id).replace("-", "")
    client.post(
        f"/known-evidence/{evidence_hex}/retractions", json={"operation_key": "op-r2"}
    )
    assert client.get(f"/lexemes/{lexeme_id}/evidence-summary").json()["projection_revision"] == after_retract


def test_summaries_are_rebuildable_from_facts(client: TestClient, material_and_lexeme) -> None:
    from sqlalchemy import text

    from learningj.db.session import make_engine, make_session_factory
    from learningj.evidence import service as evidence_service

    _, lexeme_id, surface = material_and_lexeme
    client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={
            "decision": "known",
            "input_surface": surface,
            "operation_key": "op-k1",
            "expected_decision_seq": 0,
        },
    )
    evidence_hex = _rows(client, "SELECT id FROM known_evidence LIMIT 1")[0][0]
    client.post(
        f"/known-evidence/{evidence_hex}/retractions", json={"operation_key": "op-r1"}
    )

    before = client.get(f"/lexemes/{lexeme_id}/evidence-summary").json()["scopes"]

    engine = make_engine(f"sqlite:///{client.app.state.db_path}")  # type: ignore[attr-defined]
    with make_session_factory(engine)() as session:
        session.execute(text("DELETE FROM lexeme_evidence_summaries"))
        session.commit()
        rebuilt = evidence_service.rebuild_summaries(session)
        session.commit()
    engine.dispose()
    assert rebuilt >= 1
    after = client.get(f"/lexemes/{lexeme_id}/evidence-summary").json()["scopes"]
    # input_revision 随重建递增；其余字段（决定、撤回效果、计数、版本）逐项一致
    def without_revision(scope: dict) -> dict:
        return {key: value for key, value in scope.items() if key != "input_revision"}

    assert [without_revision(s) for s in before] == [without_revision(s) for s in after]
    # 撤回与 clear 的效果在重建后保持
    assert after[0]["current_decision"] == "clear"
    assert after[0]["valid_source_counts"] == {}
