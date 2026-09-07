"""§9 不变量清单的测试壳（P0：十一条全部 xfail(strict=True)）。

任务包要求：每条不变量有独立测试函数，尚未实现的标
`pytest.mark.xfail(strict=True, reason=...)` 并注明点亮阶段。

点亮计划（对应 `docs/mvp-tech-and-phases.md` 各阶段验收）：

- 不变量 5 —— P1（任何带三元组的记录必有非空 analyzer_dict_version）
- 不变量 1、2、6、8、9、10、11 —— P4（抽取与 Span 定位落地）
- 不变量 3、4 —— P5（ReviewItem / 复习队列落地）
- 不变量 7 —— P3（记忆槽位写入路径落地）

strict=True：一旦某条不变量在后续阶段意外点亮（测试不再 xfail），
或壳被误标为 pass，pytest 会立即报错，防止「点亮」被静默吞掉。
点亮方式：把对应测试的 xfail 标记移除，替换为真实断言。
"""

from __future__ import annotations

import pytest

# P0 阶段没有任何不变量被点亮；以下壳全部 strict xfail。

@pytest.mark.xfail(strict=True, reason="点亮阶段 P4：Occurrence/KP 外键存在性 + 合并不改写指向")
def test_invariant_1_occurrence_kp_exists_and_merge_does_not_rewrite() -> None:
    """任何 `Occurrence.kp_id` 指向的 KP 存在；KP 被合并后该指向不改写。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4：section_id+revision 版本引用存在且未被删除")
def test_invariant_2_occurrence_section_reference_resolves() -> None:
    """任何 `Occurrence.section_id + section_revision` 指向的 AnalysisSection
    版本存在且未被删除（可被 superseded_by 标记，但记录仍在）。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P5：reference KP 无有效 ReviewItem（触发器已就位，测试待业务路径）")
def test_invariant_3_reference_kp_has_no_active_review_item() -> None:
    """`retention = reference` 的 KP 不存在对应 `retired_at IS NULL` 的有效
    ReviewItem。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P5：每 KP 至多一条有效 ReviewItem，多于一条必有用户显式操作记录")
def test_invariant_4_at_most_one_active_review_item_per_kp() -> None:
    """同一 kp_id 的有效 ReviewItem（retired_at IS NULL）默认至多一条，
    多于一条时必有用户显式操作记录。"""
    raise NotImplementedError


def test_invariant_5_trigram_records_require_analyzer_dict_version(migrated_engine) -> None:
    """任何带三元组的记录必有非空 `analyzer_dict_version`。"""
    from sqlalchemy.orm import Session
    from sqlalchemy import select
    from learningj.db.models.lexeme import Lexeme

    with Session(migrated_engine) as session:
        rows = session.scalars(select(Lexeme)).all()
        assert all(
            row.normalized_form and row.pos and row.reading_form
            and row.first_seen_analyzer_dict_version
            for row in rows
        )


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4：Span 偏移合法且切片回读等于 surface")
def test_invariant_6_span_offsets_slice_back_to_surface() -> None:
    """任何 Span 的 `char_start < char_end`，且落在其 sentence 的 code point
    长度内；`sentence.text[char_start:char_end] == span.surface`。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P3：记忆槽位由写入路径强制，不由清理任务保证")
def test_invariant_7_memory_slot_limit_enforced_on_write() -> None:
    """MaterialNote 与 LearnerProfileNote 的条数不超过配置上限——由写入路径
    保证。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4：Lexeme 不进 Alias 表；KP 不出现在 KnownEvidence target 位")
def test_invariant_8_id_spaces_do_not_leak() -> None:
    """Lexeme 不出现在 Alias 表中；KnowledgePoint 不出现在 KnownEvidence 的
    target 位。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4：session_closed 后不再新增 AnalysisMessage")
def test_invariant_9_closed_session_accepts_no_new_messages() -> None:
    """`Analysis.session_closed = true` 的记录不再新增 AnalysisMessage。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4：extraction done 时所有当前 section 的 kind 非空且合法")
def test_invariant_10_done_extraction_implies_kinded_sections() -> None:
    """当 `Analysis.extraction_status = done` 时，其所有当前 AnalysisSection
    的 kind 非空且属于「九个模块 + takeaway + qa」；抽取前允许为空。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4：anchor 唯一 + 幂等 upsert/冲突重试收敛（数据层唯一约束已就位）")
def test_invariant_11_anchor_unique_with_idempotent_upsert() -> None:
    """KnowledgePoint.anchor 在本地库内具有唯一约束；并发抽取与重试必须
    通过幂等 upsert / 冲突重试收敛到同一 KP。"""
    raise NotImplementedError
