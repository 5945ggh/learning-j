"""P2-integration cross-boundary gates.

These tests deliberately stay at the public HTTP boundary (with read-only
SQLite probes for persisted facts/query plans).  They do not change backend or
frontend implementations and provide the P3 reader contract plus experiment
11a structural evidence.
"""

from __future__ import annotations

import io
import json
import sqlite3
import zipfile
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import event, text

from conftest import build_yomitan_zip
from learningj.db.session import make_engine, make_session_factory


def _db_count(client: TestClient, table: str) -> int:
    with sqlite3.connect(client.app.state.db_path) as conn:  # type: ignore[attr-defined]
        return int(conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0])


def _txt_material(client: TestClient) -> dict[str, Any]:
    return next(row for row in client.get("/materials").json() if row["kind"] == "text")


def _sentence(client: TestClient, material: dict[str, Any], index: int = 0) -> dict[str, Any]:
    return client.get(f"/materials/{material['id']}/sentences").json()[index]


def _make_traversal_zip() -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr("index.json", json.dumps({"title": "unsafe", "revision": "1"}))
        archive.writestr("term_bank_1.json", "[]")
        archive.writestr("../escape.json", "{}")
    return out.getvalue()


def _make_duplicate_member_zip() -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr("index.json", json.dumps({"title": "dup", "revision": "1"}))
        archive.writestr("term_bank_1.json", "[]")
        archive.writestr("term_bank_1.json", "[]")
    return out.getvalue()


def test_reader_fixture_is_regenerated_from_the_real_api() -> None:
    """The tracked reader artifact is produced by the same public API we test."""
    from learningj.fixtures.reader_fixture import build_fixture

    tracked = json.loads(
        (Path(__file__).resolve().parents[1] / "fixtures" / "reader-fixture.json").read_text(
            encoding="utf-8"
        )
    )
    assert build_fixture() == tracked


def test_token_api_matches_sudachi_a_mode_and_reader_fixture_shape(
    dev_reader_environment: TestClient,
) -> None:
    """Every public token row is an exact Sudachi A-mode row, not a mock."""
    from sudachipy import Dictionary, SplitMode

    client = dev_reader_environment
    material = _txt_material(client)
    dictionary = Dictionary()
    tokenizer = dictionary.create()
    for sentence in client.get(f"/materials/{material['id']}/sentences").json():
        response = client.get(f"/sentences/{sentence['id']}/tokens")
        assert response.status_code == 200
        actual = response.json()
        expected = []
        for morpheme in tokenizer.tokenize(sentence["text"], SplitMode.A):
            expected.append(
                {
                    "surface": morpheme.surface(),
                    "normalized_form": morpheme.normalized_form(),
                    "pos": ",".join(morpheme.part_of_speech()),
                    "reading_form": morpheme.reading_form() or "",
                    "reading_source": "sudachi",
                    "char_start": morpheme.begin(),
                    "char_end": morpheme.end(),
                }
            )
        rows = actual["tokens"]
        assert len(rows) == len(expected)
        for row, reference in zip(rows, expected, strict=True):
            for field, value in reference.items():
                assert row[field] == value, (sentence["text"], field, row, reference)
            assert "".join(list(sentence["text"])[row["char_start"] : row["char_end"]]) == row["surface"]
            assert row["lexeme_id"].startswith("lx_")
        assert actual["sidecar_generation_id"] == material["current_sidecar_id"]
        assert actual["analyzer_dict_version"]


def test_zip_safety_and_archive_import_idempotency_at_api_boundary(
    dev_reader_environment: TestClient,
) -> None:
    client = dev_reader_environment
    cases = (
        ("unsafe.zip", _make_traversal_zip(), "escape.json"),
        ("absolute.zip", build_yomitan_zip(extra_files={"/escape.json": b"{}"}), "成员"),
        ("backslash.zip", build_yomitan_zip(extra_files={"a\\b.json": b"{}"}), "成员"),
        ("drive.zip", build_yomitan_zip(extra_files={"C:/escape.json": b"{}"}), "成员"),
        ("duplicate.zip", _make_duplicate_member_zip(), "重复"),
        ("missing-index.zip", build_yomitan_zip(omit={"index.json"}), "index.json"),
        ("missing-bank.zip", build_yomitan_zip(omit={"term_bank_1.json"}), "term bank"),
        ("unknown-format.zip", build_yomitan_zip(index={"title": "x", "revision": "1", "format": 3}), "format"),
        ("invalid-row.zip", build_yomitan_zip(entries=[["走る", "はしる"]]), "term bank"),
        ("corrupt.zip", b"not-a-zip", "损坏"),
    )
    for filename, payload, marker in cases:
        before = {
            table: _db_count(client, table)
            for table in ("dictionary_sources", "dictionary_entries", "dictionary_import_runs", "dictionary_assets")
        }
        unsafe = client.post(
            "/dictionaries/import",
            files={"file": (filename, payload, "application/zip")},
        )
        assert unsafe.status_code == 422, (filename, unsafe.text)
        assert marker in unsafe.json()["detail"]
        assert {
            table: _db_count(client, table)
            for table in before
        } == before
    assert _db_count(client, "dictionary_sources") == 0
    assert _db_count(client, "dictionary_import_runs") == 0

    blob = build_yomitan_zip(entries=[["君", "きみ", "代名詞", "", 8, "you"]])
    first = client.post(
        "/dictionaries/import", files={"file": ("first.zip", blob, "application/zip")}
    )
    replay = client.post(
        "/dictionaries/import", files={"file": ("replay.zip", blob, "application/zip")}
    )
    assert first.status_code == 201
    assert replay.status_code == 200
    assert first.json()["idempotent_replay"] is False
    assert replay.json()["idempotent_replay"] is True
    assert replay.json()["source"]["id"] == first.json()["source"]["id"]
    assert _db_count(client, "dictionary_sources") == 1
    assert _db_count(client, "dictionary_entries") == 1
    assert _db_count(client, "dictionary_import_runs") == 2


def test_reader_lookup_annotation_and_playback_free_reads_create_no_learning_facts(
    dev_reader_environment: TestClient,
) -> None:
    """Reading/lookup paths are observational; annotation remains separate."""
    client = dev_reader_environment
    material = _txt_material(client)
    sentence = _sentence(client, material, 1)
    before = {
        table: _db_count(client, table)
        for table in (
            "known_evidence",
            "lexeme_knowledge_decisions",
            "annotations",
            "spans",
            "annotation_spans",
        )
    }
    client.get(f"/materials/{material['id']}/sentences")
    client.get(f"/materials/{material['id']}/sidecar")
    client.get(f"/materials/{material['id']}/lexeme-counts")
    tokens = client.get(f"/sentences/{sentence['id']}/tokens").json()
    client.get("/dictionaries/lookup", params={"expression": tokens["tokens"][0]["normalized_form"]})
    client.get("/dictionaries/search", params={"query": tokens["tokens"][0]["normalized_form"]})
    after_reads = {table: _db_count(client, table) for table in before}
    assert after_reads == before
    with sqlite3.connect(client.app.state.db_path) as conn:  # type: ignore[attr-defined]
        domain_tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
                "('knowledge_points', 'review_items')"
            )
        }
    # P2's designated baseline does not create these future producers as a
    # side effect of reading (ReviewItem/KP production belongs to later phases).
    assert not domain_tables

    created = client.post(
        f"/materials/{material['id']}/annotations",
        json={"spans": [{"sentence_id": sentence["id"], "surface": sentence["text"]}], "note": "read"},
    )
    assert created.status_code == 201
    assert _db_count(client, "known_evidence") == before["known_evidence"]
    assert _db_count(client, "lexeme_knowledge_decisions") == before["lexeme_knowledge_decisions"]
    assert created.json()["spans"][0]["surface"] == sentence["text"]


def test_unknown_precedence_and_clear_semantics_are_visible_through_api(
    dev_reader_environment: TestClient,
) -> None:
    client = dev_reader_environment
    material = _txt_material(client)
    token = client.get(f"/sentences/{_sentence(client, material, 1)['id']}/tokens").json()["tokens"][0]
    lexeme_id, surface = token["lexeme_id"], token["surface"]
    engine = make_engine(client.app.state.db_path)  # type: ignore[attr-defined]
    factory = make_session_factory(engine)
    try:
        with factory() as session:
            session.execute(
                text(
                    "INSERT INTO known_evidence "
                    "(id, lexeme_id, conjugated_form, scope_form_key, source, confidence, "
                    "observed_at, observed_at_basis, analyzer_dict_version, resolver_version, "
                    "input_surface, input_reading, material_id, operation_key, created_at, updated_at) "
                    "VALUES (:id, :lexeme, NULL, 'lexeme:', 'import_anki', 0.8, "
                    "CURRENT_TIMESTAMP, 'external', 'fixture-analyzer', 'fixture-resolver', "
                    ":surface, NULL, NULL, :op, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {"id": "11111111-1111-7111-8111-111111111111", "lexeme": lexeme_id, "surface": surface, "op": "integration-import"},
            )
            from learningj.evidence import service as evidence_service

            evidence_service.rebuild_summaries(session, lexeme_ids=[lexeme_id])
            session.commit()
    finally:
        engine.dispose()

    imported = client.post("/lexemes/known-views/batch", json={"items": [{"lexeme_id": lexeme_id}]})
    assert imported.status_code == 200
    assert imported.json()["items"][0]["effective"]["state"] == "known"
    unknown = client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={"decision": "unknown", "input_surface": surface, "operation_key": "integration-unknown", "expected_decision_seq": 0},
    )
    assert unknown.status_code == 201
    view = client.post("/lexemes/known-views/batch", json={"items": [{"lexeme_id": lexeme_id}]})
    assert view.json()["items"][0]["effective"]["state"] == "unknown"
    assert view.json()["items"][0]["effective"]["basis"] == "lexeme_decision"

    clear = client.post(
        f"/lexemes/{lexeme_id}/decisions",
        json={"decision": "clear", "input_surface": surface, "operation_key": "integration-clear", "expected_decision_seq": 1},
    )
    assert clear.status_code == 201
    restored = client.post("/lexemes/known-views/batch", json={"items": [{"lexeme_id": lexeme_id}]})
    assert restored.json()["items"][0]["effective"] == {
        "state": "known",
        "basis": "import_evidence",
        "decision_id": None,
        "evidence_id": None,
    }
    # A clear never revives the previous user_asserted KE; only imported support remains.
    before_rebuild = client.get(f"/lexemes/{lexeme_id}/evidence-summary").json()
    assert before_rebuild["scopes"][0]["current_decision"] == "clear"

    # 11a incremental/full projection equivalence: reconstruct the same target
    # from facts at the same input revision and require every public field,
    # including input_revision, to remain identical.
    from learningj.evidence import service as evidence_service

    engine = make_engine(client.app.state.db_path)  # type: ignore[attr-defined]
    try:
        with make_session_factory(engine)() as session:
            revision = before_rebuild["projection_revision"]
            for scope in before_rebuild["scopes"]:
                evidence_service.recompute_scope_summary(
                    session, lexeme_id=lexeme_id,
                    scope_form_key=scope["scope_form_key"], revision=revision
                )
            session.commit()
    finally:
        engine.dispose()
    assert client.get(f"/lexemes/{lexeme_id}/evidence-summary").json() == before_rebuild


def test_11a_target_set_queries_use_sparse_indexes_and_one_generation(
    dev_reader_environment: TestClient,
) -> None:
    """Structural 11a gate: target predicates hit composite indexes, no full scan."""
    client = dev_reader_environment
    material = _txt_material(client)
    counts = client.get(f"/materials/{material['id']}/lexeme-counts").json()
    lexemes = [item["lexeme_id"] for item in counts["counts"][:3]]
    assert lexemes
    trace: list[tuple[str, Any]] = []
    engine = client.app.state.engine  # type: ignore[attr-defined]

    def capture(_conn, _cursor, statement, parameters, _context, _executemany):  # noqa: ANN001
        if statement.lstrip().upper().startswith("SELECT"):
            trace.append((statement, parameters))

    event.listen(engine, "before_cursor_execute", capture)
    try:
        batch = client.post(
            "/lexemes/known-views/batch",
            json={"items": [{"lexeme_id": lexeme_id} for lexeme_id in lexemes]},
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert batch.status_code == 200
    assert len(batch.json()["items"]) == len(lexemes)
    summary_selects = [
        (statement, parameters)
        for statement, parameters in trace
        if "LEXEME_EVIDENCE_SUMMARIES" in statement.upper()
    ]
    # This is deliberately an assertion on the real endpoint, not a hand-written
    # equivalent query: one target-set read must serve the whole page.
    assert len(summary_selects) == 1, [statement for statement, _ in summary_selects]

    conn = sqlite3.connect(client.app.state.db_path)  # type: ignore[attr-defined]
    try:
        actual_summary_plan = conn.execute(
            f"EXPLAIN QUERY PLAN {summary_selects[0][0]}", summary_selects[0][1]
        ).fetchall()
        plans = {
            "summary": conn.execute(
                "EXPLAIN QUERY PLAN SELECT * FROM lexeme_evidence_summaries WHERE lexeme_id IN (?, ?, ?)",
                lexemes,
            ).fetchall(),
            "counts": conn.execute(
                "EXPLAIN QUERY PLAN SELECT * FROM material_lexeme_counts WHERE material_id = ? AND sidecar_id = ?",
                (material["id"].replace("-", ""), counts["sidecar_generation_id"].replace("-", "")),
            ).fetchall(),
            "decisions": conn.execute(
                "EXPLAIN QUERY PLAN SELECT * FROM lexeme_knowledge_decisions WHERE lexeme_id = ? AND scope_form_key = ? ORDER BY decision_seq DESC",
                (lexemes[0], "lexeme:"),
            ).fetchall(),
        }
    finally:
        conn.close()
    rendered = {name: " ".join(str(part) for row in rows for part in row).upper() for name, rows in plans.items()}
    rendered["actual_summary"] = " ".join(str(part) for row in actual_summary_plan for part in row).upper()
    assert all("SCAN" not in plan or "SCAN CONSTANT ROW" in plan for plan in rendered.values()), rendered
    assert "USING" in rendered["summary"] or "INDEX" in rendered["summary"]
    assert "SCAN LEXEME_EVIDENCE_SUMMARIES" not in rendered["actual_summary"]
    assert "USING" in rendered["counts"] or "INDEX" in rendered["counts"]
    assert "USING" in rendered["decisions"] or "INDEX" in rendered["decisions"]
    # A single response carries one current sidecar generation throughout.
    sidecar = client.get(f"/materials/{material['id']}/sidecar").json()
    assert sidecar["sidecar_generation_id"] == counts["sidecar_generation_id"] == material["current_sidecar_id"]


def test_11a_targeted_summary_rebuild_does_not_scan_unrelated_facts(
    dev_reader_environment: TestClient,
) -> None:
    """The target-scoped rebuild must push lexeme predicates into SQL."""
    from learningj.evidence import service as evidence_service

    client = dev_reader_environment
    material = _txt_material(client)
    lexeme_id = client.get(
        f"/materials/{material['id']}/lexeme-counts"
    ).json()["counts"][0]["lexeme_id"]
    engine = client.app.state.engine  # type: ignore[attr-defined]
    statements: list[str] = []

    def capture(_conn, _cursor, statement, _parameters, _context, _executemany):  # noqa: ANN001
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        with make_session_factory(engine)() as session:
            evidence_service.rebuild_summaries(session, lexeme_ids=[lexeme_id])
            session.commit()
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    unrelated_scans = [
        statement
        for statement in statements
        if (
            "from known_evidence" in statement.lower()
            or "from lexeme_knowledge_decisions" in statement.lower()
        )
        and "where" not in statement.lower()
    ]
    assert not unrelated_scans, unrelated_scans
