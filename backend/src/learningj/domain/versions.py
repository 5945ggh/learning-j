"""版本戳的统一来源（`data-model.md` §0 版本戳约束）。

`analyzer_dict_version`（SudachiDict）与释义词典来源版本
（`DictionarySource.source_version`）属于不同命名空间，不得复用同一含义；
本模块只提供分析器词典版本的读取入口，释义词典版本始终来自被导入档案
自身的 `index.json`。
"""

from __future__ import annotations

import importlib.metadata

_ANALYZER_DICT_PACKAGE = "SudachiDict-core"


def analyzer_dict_version() -> str:
    """当前安装的 SudachiDict 版本（sidecar / KE / 裁定共用的口径戳）。"""
    return importlib.metadata.version(_ANALYZER_DICT_PACKAGE)
