"""素材 fixture 生成（`docs/mvp-tech-and-phases.md` §3 P0 第 4 条）。

用真实 API（TestClient → 路由 → Pydantic response_model）导入固定样本，
把随机的 UUID 归一成确定性占位 id 后输出 JSON。两次运行字节相同，
前端测试可以锁定该文件（P1 验收将用它端到端还原 txt/srt 句子列表）。

命令（backend/ 目录下执行）::

    uv run python -m learningj.fixtures.material_fixture \
        --out fixtures/material-fixture.json
"""

from __future__ import annotations

import argparse
import json
import re
import tempfile
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from learningj.api.app import create_app

# 覆盖 BMP 外字符（𠮟/𩸽）与中英混排；code point 偏移 fixture 的关键样本。
_FIXTURE_TXT = "𠮟られた。次は君の番です！\n\n向上心が熱い。"
_FIXTURE_SRT = """1
00:00:01,000 --> 00:00:04,200
また寄ってしまった。

2
00:00:04,400 --> 00:00:08,000
今日も頑張ろう。
"""

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def _normalize_ids(node: Any, mapping: dict[str, str]) -> Any:
    """把遍历中出现的 UUID 字符串替换为确定性占位 id（首现顺序）。"""
    if isinstance(node, dict):
        return {key: _normalize_ids(value, mapping) for key, value in node.items()}
    if isinstance(node, list):
        return [_normalize_ids(item, mapping) for item in node]
    if isinstance(node, str) and _UUID.fullmatch(node):
        if node not in mapping:
            mapping[node] = f"fixture-id-{len(mapping) + 1:03d}"
        return mapping[node]
    return node


def build_fixture() -> dict[str, Any]:
    """导入 txt/srt 样本素材，返回归一后的 API 响应结构。"""
    from learningj.db.base import Base
    from learningj.db.models.invariant_triggers import install_invariant_triggers

    mapping: dict[str, str] = {}
    with tempfile.TemporaryDirectory(prefix="lj-fixture-") as tmp:
        client = TestClient(create_app(f"sqlite:///{tmp}/fixture.db"))
        engine = client.app.state.engine  # type: ignore[attr-defined]
        Base.metadata.create_all(engine)
        install_invariant_triggers(engine)
        responses: dict[str, Any] = {}
        for key, filename, blob in (
            ("txt", "fixture-sample.txt", _FIXTURE_TXT.encode("utf-8")),
            ("srt", "fixture-sample.srt", _FIXTURE_SRT.encode("utf-8")),
        ):
            created = client.post(
                "/materials",
                files={"file": (filename, blob, "text/plain")},
            )
            created.raise_for_status()
            material_id = created.json()["id"]
            responses[f"materials/{key}"] = created.json()
            sentences = client.get(f"/materials/{material_id}/sentences")
            sentences.raise_for_status()
            responses[f"sentences/{key}"] = sentences.json()
            sidecar = client.get(f"/materials/{material_id}/sidecar")
            sidecar.raise_for_status()
            responses[f"sidecar/{key}"] = sidecar.json()
    return _normalize_ids(responses, mapping)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="learningj.fixtures.material_fixture",
        description="生成前端可锁定的素材 fixture（确定性输出）",
    )
    parser.add_argument("--out", type=Path, required=True, help="输出 JSON 路径")
    args = parser.parse_args(argv)

    fixture = build_fixture()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(fixture, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"素材 fixture 已生成: {args.out.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
