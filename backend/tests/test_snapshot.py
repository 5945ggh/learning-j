"""P1 全库快照导出与隔离恢复验证（plan §1.6/P1：导出可在隔离库恢复）。

快照是整个数据库的一致性 SQLite 副本 + 清单 manifest（导出时间、导出器
版本、数据库自报的 schema/契约身份、资源/sidecar 清单）。验证在隔离副本
上执行：完整性、外键、清单与身份必须逐项一致。
"""

from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from learningj.api.app import create_app
from learningj.db.maintenance import (
    DEVELOPMENT_CONTRACT_ID,
    DEVELOPMENT_SCHEMA_ID,
    export_snapshot,
    main,
    rebuild_development_database,
    verify_snapshot,
)


@pytest.fixture(scope="module")
def development_db(tmp_path_factory: pytest.TempPathFactory) -> Path:
    db_path = tmp_path_factory.mktemp("snapshot") / "development.db"
    rebuild_development_database(db_path)
    return db_path


def _read_manifest(manifest_path: Path) -> dict:
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def _write_manifest(manifest_path: Path, manifest: dict) -> None:
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def test_export_writes_inventory_manifest_and_restores_isolated(
    development_db: Path, tmp_path: Path
) -> None:
    result = export_snapshot(development_db, tmp_path / "library-snapshot.db")
    assert result.schema_id == DEVELOPMENT_SCHEMA_ID
    assert result.contract_id == DEVELOPMENT_CONTRACT_ID
    assert result.snapshot_path.is_file()
    assert result.manifest_path.is_file()

    manifest = _read_manifest(result.manifest_path)
    assert manifest["type"] == "learningj-library-snapshot"
    assert manifest["schema_id"] == DEVELOPMENT_SCHEMA_ID
    assert manifest["contract_id"] == DEVELOPMENT_CONTRACT_ID
    assert manifest["created_at_utc"].endswith("Z")
    assert manifest["app_version"]
    assert len(manifest["resources"]) == 2
    assert len(manifest["sidecars"]) == 2
    for resource in manifest["resources"]:
        assert resource["locator"] and resource["storage_mode"] in {
            "external_reference",
            "managed_copy",
        }
        assert resource["source_sha256"]
    for sidecar in manifest["sidecars"]:
        assert sidecar["payload_bytes"] > 0
        assert sidecar["analyzer_dict_version"] and sidecar["segmenter_version"]

    # 隔离恢复：快照副本在独立目录作为真实数据库打开，素材链完整可读。
    restored = tmp_path / "restored" / "library.db"
    restored.parent.mkdir()
    shutil.copy(result.snapshot_path, restored)
    client = TestClient(create_app(f"sqlite:///{restored}"))
    materials = client.get("/materials")
    assert materials.status_code == 200
    assert len(materials.json()) == 2
    for material in materials.json():
        assert client.get(f"/materials/{material['id']}/sidecar").status_code == 200
        assert client.get(f"/materials/{material['id']}/lexeme-counts").status_code == 200


def test_export_refuses_to_overwrite_existing_snapshot(
    development_db: Path, tmp_path: Path
) -> None:
    out = tmp_path / "library-snapshot.db"
    export_snapshot(development_db, out)
    before = out.read_bytes()
    with pytest.raises(FileExistsError):
        export_snapshot(development_db, out)
    assert out.read_bytes() == before


def test_verify_rejects_tampered_manifest_inventory(
    development_db: Path, tmp_path: Path
) -> None:
    result = export_snapshot(development_db, tmp_path / "library-snapshot.db")
    manifest = _read_manifest(result.manifest_path)
    manifest["resources"][0]["locator"] = "tampered-locator.txt"
    _write_manifest(result.manifest_path, manifest)
    with pytest.raises(RuntimeError, match="清单与隔离恢复副本不一致"):
        verify_snapshot(result.snapshot_path, result.manifest_path)


def test_verify_rejects_identity_mismatch(
    development_db: Path, tmp_path: Path
) -> None:
    result = export_snapshot(development_db, tmp_path / "library-snapshot.db")
    manifest = _read_manifest(result.manifest_path)
    manifest["schema_id"] = "learningj-development-schema-forged"
    _write_manifest(result.manifest_path, manifest)
    with pytest.raises(RuntimeError, match="schema/契约身份与 manifest 不一致"):
        verify_snapshot(result.snapshot_path, result.manifest_path)


def test_verify_rejects_incomplete_manifest(
    development_db: Path, tmp_path: Path
) -> None:
    result = export_snapshot(development_db, tmp_path / "library-snapshot.db")
    manifest = _read_manifest(result.manifest_path)
    del manifest["created_at_utc"]
    _write_manifest(result.manifest_path, manifest)
    with pytest.raises(ValueError, match="manifest 无效"):
        verify_snapshot(result.snapshot_path, result.manifest_path)


def test_unregistered_database_exports_null_identity(tmp_path: Path) -> None:
    """没有开发基线登记的库：身份记 null，验证要求 manifest 同样为 null。"""
    plain = tmp_path / "plain.db"
    conn = sqlite3.connect(plain)
    try:
        with conn:
            conn.execute("CREATE TABLE sentinel (value TEXT NOT NULL)")
    finally:
        conn.close()
    result = export_snapshot(plain, tmp_path / "plain-snapshot.db")
    assert result.schema_id is None and result.contract_id is None
    report = verify_snapshot(result.snapshot_path, result.manifest_path)
    assert report["schema_id"] is None and report["contract_id"] is None


def test_cli_rebuild_export_verify_roundtrip(tmp_path: Path) -> None:
    db_path = tmp_path / "cli-development.db"
    snapshot = tmp_path / "cli-snapshot.db"
    assert main(["rebuild-development-db", "--db", str(db_path)]) == 0
    assert main(["export-snapshot", "--db", str(db_path), "--out", str(snapshot)]) == 0
    assert main(["verify-snapshot", "--snapshot", str(snapshot)]) == 0
    assert snapshot.is_file() and Path(str(snapshot) + ".manifest.json").is_file()
