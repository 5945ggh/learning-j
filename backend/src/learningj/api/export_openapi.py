"""OpenAPI 生成入口（`docs/mvp-tech-and-phases.md` §3 P0 第 4 条）。

把当前 API 契约导出为确定性 JSON：路由集合固定、响应全部来自
`learningj.api.schemas` 的 Pydantic 模型，两次运行字节相同，前端可据此
生成并锁定类型。P0 的 OpenAPI 不含任何 Analysis/Session/KP 端点。

命令（backend/ 目录下执行）::

    uv run python -m learningj.api.export_openapi --out fixtures/openapi.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from learningj.api.app import create_app


def build_openapi() -> dict[str, Any]:
    """构造应用并导出 OpenAPI 文档（内存库，不落盘）。"""
    app = create_app("sqlite://")
    return app.openapi()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="learningj.api.export_openapi",
        description="导出确定性 OpenAPI 文档（P0 契约面）",
    )
    parser.add_argument("--out", type=Path, required=True, help="输出 JSON 路径")
    args = parser.parse_args(argv)

    spec = build_openapi()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(spec, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"OpenAPI 已导出: {args.out.resolve()}（{len(spec['paths'])} 个路径）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
