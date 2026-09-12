"""全部 ORM 模型的聚合入口。

import 本模块即可把所有表注册到 `Base.metadata`；Alembic 的
`env.py` 与测试都从这里取 metadata。

表清单（对应 `docs/data-model.md` 各节）：

- §8  素材与句子：`materials` / `sentences` / `sidecars`
- §1  Span：`spans` + 三张关联表 `occurrence_spans` /
  `analysis_section_spans` / `annotation_spans`
- §2  词典与 Lexeme：`dictionary_*` 五表、`lexemes` / `known_evidence`
- §3  知识点：`knowledge_points` / `aliases` / `occurrences`
- §4  解析文档：`analyses` / `extraction_runs` / `analysis_sections` /
  `analysis_messages`
- §5  划线：`annotations`
- §6  记忆：`material_notes` / `learner_profile_notes`
- §7  SRS：`review_items` / `review_states`
- §9  不变量的数据层触发器：`triggers.py`
"""

from learningj.db.models.analysis import (
    Analysis,
    AnalysisMessage,
    AnalysisSection,
    ExtractionRun,
)
from learningj.db.models.annotation import Annotation
from learningj.db.models.dictionary import (
    DictionaryAsset,
    DictionaryDefinition,
    DictionaryEntry,
    DictionaryImportRun,
    DictionarySource,
)
from learningj.db.models.invariant_triggers import install_invariant_triggers
from learningj.db.models.knowledge import Alias, KnowledgePoint, Occurrence
from learningj.db.models.lexeme import KnownEvidence, Lexeme
from learningj.db.models.material import Material, MaterialLexemeCount, Sentence, Sidecar
from learningj.db.models.memory import LearnerProfileNote, MaterialNote
from learningj.db.models.span import (
    Span,
    analysis_section_spans,
    annotation_spans,
    occurrence_spans,
)
from learningj.db.models.srs import ReviewItem, ReviewState

__all__ = [
    "Analysis",
    "AnalysisMessage",
    "AnalysisSection",
    "Alias",
    "Annotation",
    "DictionaryAsset",
    "DictionaryDefinition",
    "DictionaryEntry",
    "DictionaryImportRun",
    "DictionarySource",
    "ExtractionRun",
    "KnownEvidence",
    "KnowledgePoint",
    "LearnerProfileNote",
    "Lexeme",
    "Material",
    "MaterialLexemeCount",
    "MaterialNote",
    "Occurrence",
    "ReviewItem",
    "ReviewState",
    "Sentence",
    "Sidecar",
    "Span",
    "analysis_section_spans",
    "annotation_spans",
    "install_invariant_triggers",
    "occurrence_spans",
]
