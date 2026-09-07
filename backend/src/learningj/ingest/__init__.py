"""素材导入：分句、分词、sidecar。P1 实现；本阶段仅建立包边界。"""
from learningj.ingest.service import (
    SEGMENTER_VERSION,
    import_material,
    parse_source,
    parse_subtitle,
    split_plain_text,
)

__all__ = [
    "SEGMENTER_VERSION",
    "import_material",
    "parse_source",
    "parse_subtitle",
    "split_plain_text",
]
