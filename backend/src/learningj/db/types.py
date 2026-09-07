"""SQLAlchemy 列类型辅助。

- `str_enum` 生成以枚举**值**（小写字符串）入库的 VARCHAR 列，并附带
  CHECK 约束把取值域锁在数据库层（SQLite 无原生 ENUM）；
- `json_of` 为 JSON 列提供显式类型（SQLite 的 JSON 存 TEXT）。
"""

from __future__ import annotations

from enum import Enum
from typing import Any, TypeVar

from sqlalchemy import JSON
from sqlalchemy import Enum as SaEnum
from sqlalchemy.types import TypeEngine

E = TypeVar("E", bound=Enum)


def str_enum(enum_cls: type[E], *, name: str) -> SaEnum[E]:
    """构造非原生 ENUM 列类型：VARCHAR + CHECK，存 `.value`。"""
    return SaEnum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        validate_strings=True,
        values_callable=lambda cls: [member.value for member in cls],
    )


class JsonListOf(JSON):
    """JSON 数组列（元素任意），映射为 Python `list`。"""

    def __init__(self) -> None:
        super().__init__()
        self.json_serializer = _dumps
        self.json_deserializer = _loads

    def __repr__(self) -> str:  # 让 Alembic/日志输出可读
        return "JsonListOf()"


class JsonDictOf(JSON):
    """JSON 对象列，映射为 Python `dict`。"""

    def __init__(self) -> None:
        super().__init__()
        self.json_serializer = _dumps
        self.json_deserializer = _loads

    def __repr__(self) -> str:
        return "JsonDictOf()"


def _dumps(obj: Any) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _loads(s: str | bytes) -> Any:
    import json

    if isinstance(s, bytes):
        s = s.decode("utf-8")
    return json.loads(s)


def json_list() -> TypeEngine[Any]:
    return JsonListOf()


def json_dict() -> TypeEngine[Any]:
    return JsonDictOf()

