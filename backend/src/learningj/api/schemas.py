"""Pydantic API 模型（`docs/mvp-tech-and-phases.md` §3 P0 第 4 条）。

统一 Pydantic/API 模型与 OpenAPI 生成入口：现有素材端点的响应形状
在这里定义一次，路由经 `response_model` 引用，前端以后从 OpenAPI
生成类型，不再手写平行契约。P0 不定义任何 Analysis/Session/KP 模型——
不存在的能力不进契约面。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

MaterialKindLiteral = Literal["subtitle_video", "subtitle_audio", "text", "epub"]
SentenceAnchorTypeLiteral = Literal["subtitle", "plain_text", "epub"]


class MaterialOut(BaseModel):
    """`GET /materials` / `POST /materials` 的响应（data-model §8.1 +
    素材无关抽象 §8.2；`sentence_count` 是列表视图的读投影）。"""

    id: str
    title: str
    content_hash: str
    locator: str
    kind: MaterialKindLiteral
    copy_stored: bool
    sentence_count: int


class SentenceOut(BaseModel):
    """`GET /materials/{material_id}/sentences` 的响应；`text` 与
    `anchor_payload` 的偏移均为 Unicode code point（data-model §0/§8.2）。"""

    id: str
    material_id: str
    index: int
    text: str
    time_start: int | None = None
    time_end: int | None = None
    translation: str | None = None
    anchor_type: SentenceAnchorTypeLiteral
    anchor_payload: dict[str, Any] = Field(default_factory=dict)


class SidecarOut(BaseModel):
    """`GET /materials/{material_id}/sidecar` 的响应；payload 为
    msgpack 解包后的分句/分词结果（data-model §8.3）。"""

    material_id: str
    content_hash: str
    segmenter_version: str
    tokenizer_version: str
    analyzer_dict_version: str
    payload: dict[str, Any]
