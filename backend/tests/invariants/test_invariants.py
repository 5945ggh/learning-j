"""§9 不变量清单的测试入口（25 条，data-model.md §9）。

每条不变量有独立测试函数；其语义按**当前契约**重写（2026-09-09 版），
不是旧 11 条的沿用。尚未实现的条目标 `pytest.mark.xfail(strict=True,
reason=...)` 并注明点亮阶段；点亮 = 移除 xfail、替换为真实断言。
strict=True 保证意外点亮或误标 pass 时 pytest 立即报错。

P0 已点亮（schema 层语义）：
- 不变量 5 —— 带三元组的记录必有非空分析器词典版本（DDL NOT NULL +
  行级断言；生产者级完整语义随 P1/P2 的写入路径扩面）；
- 不变量 14 —— pattern 必有模式版本、opaque 必有 opaque_reason
  （数据层 CHECK 全覆盖）。

P0 已覆盖数据层、但仍按 P5 排程服务语义保留 xfail：不变量 3（reference
不激活 queued/active）、不变量 4（retired ⇔ retired_at、active 须有
admitted_at；ReviewState 在首次评分时建立，准入但未首评的 active 合法，且
不得对未准入项插入 ReviewState），行为断言见 `tests/test_constraints.py`。

待点亮清单（pending-invariant ledger，点亮阶段对齐
`docs/mvp-tech-and-phases.md` §3 各阶段验收）：

| 阶段 | 不变量 |
|---|---|
| P1 | 5（生产者扩面） |
| P2 | 21 |
| P2-known-import | 22 |
| P3b | 7 |
| P4b | 1、2、6、8–13、15–17、19、20 |
| P5 | 3、4、18、23、24、25 |

旧的点亮计划（不变量 1–11 → P4、3/4 → P5、7 → P3）作废；旧壳挂在
`session_closed` / `extraction_status` 等第二状态机字段上的语义已删除
（P0 前滚迁移移除了这些列）。「表存在」不是语义完成证明；未点亮条目
不得以表结构检查替代行为断言。
"""

from __future__ import annotations

import pytest
from sqlalchemy import inspect
from sqlalchemy.engine import Engine


# ---------------------------------------------------------------------------
# P0 已点亮
# ---------------------------------------------------------------------------


def test_invariant_5_trigram_records_require_analyzer_dict_version(migrated_engine) -> None:
    """§9 不变量 5：带三元组的记录有非空分析器词典版本来源。

    P0 范围：`lexemes.first_seen_analyzer_dict_version` 与
    `known_evidence.analyzer_dict_version` 列 NOT NULL，且库内全部行非空。
    生产者级完整语义（每次写入都带当前版本）随 P1/P2 写入路径点亮。
    """
    from sqlalchemy import select

    from learningj.db.models.lexeme import KnownEvidence, Lexeme

    inspector = inspect(migrated_engine)
    lexeme_cols = {c["name"]: c for c in inspector.get_columns("lexemes")}
    ke_cols = {c["name"]: c for c in inspector.get_columns("known_evidence")}
    assert lexeme_cols["first_seen_analyzer_dict_version"]["nullable"] is False
    assert ke_cols["analyzer_dict_version"]["nullable"] is False

    from sqlalchemy.orm import Session

    with Session(migrated_engine) as session:
        lexemes = session.scalars(select(Lexeme)).all()
        assert all(
            row.normalized_form and row.pos and row.reading_form
            and row.first_seen_analyzer_dict_version
            for row in lexemes
        )
        evidence = session.scalars(select(KnownEvidence)).all()
        assert all(row.analyzer_dict_version for row in evidence)


def test_invariant_14_pattern_has_grammar_version_and_opaque_has_reason(migrated_engine) -> None:
    """§9 不变量 14：pattern KP 有模式版本；opaque KP 有 opaque_reason。

    数据层 CHECK（ck_knowledge_points_pattern_has_grammar_version /
    ck_knowledge_points_opaque_has_reason）完整覆盖该不变量。
    """
    import uuid

    from sqlalchemy import insert

    from learningj.db.base import Base

    def _insert(**overrides: object) -> None:
        row = {
            "kp_id": uuid.uuid4(),
            "anchor": f"anchor-{uuid.uuid4()}",
            "anchor_shape": "lexical",
            "anchor_payload": {"surface": "語"},
            "tags": "[]",
            "retention": "srs",
            "retention_set_by": "default",
            "origin": "extraction",
        }
        row.update(overrides)
        with migrated_engine.begin() as conn:
            conn.execute(insert(Base.metadata.tables["knowledge_points"]), [row])

    with pytest.raises(Exception, match="pattern_has_grammar_version"):
        _insert(
            anchor="pattern-anchor-missing-version",
            anchor_shape="pattern",
            anchor_payload={"elements": []},
            pattern_grammar_version=None,
        )
    with pytest.raises(Exception, match="opaque_has_reason"):
        _insert(
            anchor="opaque-anchor-missing-reason",
            anchor_shape="opaque",
            anchor_payload={"freeform": "〜"},
            opaque_reason=None,
        )
    _insert(
        anchor="pattern-anchor-ok",
        anchor_shape="pattern",
        anchor_payload={"elements": []},
        pattern_grammar_version="0.1",
    )
    _insert(
        anchor="opaque-anchor-ok",
        anchor_shape="opaque",
        anchor_payload={"freeform": "〜"},
        opaque_reason="model_chosen",
    )


# ---------------------------------------------------------------------------
# 待点亮（strict xfail；点亮阶段见 reason 与模块 docstring）
# ---------------------------------------------------------------------------


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4b：Occurrence/KP 外键存在性 + 合并不改写指向 + canonical 无环")
def test_invariant_1_occurrence_kp_exists_and_merge_does_not_rewrite() -> None:
    """任何 `Occurrence.kp_id` 指向存在的 KP；合并不改写 Occurrence 原
    kp_id，canonical 指针无环（data-model §9.1）。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4b：Occurrence 引用其 run 固定 AnalysisRevision 内存在且未清理的小节版本")
def test_invariant_2_occurrence_section_reference_resolves() -> None:
    """Occurrence 引用存在的小节版本，且该版本属于其 ExtractionRun 固定
    输入的 AnalysisRevision；被引用内容不得覆盖或清理（§9.2 / §4.3）。
    旧语义（superseded_by 标记）已随契约废除。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P5：reference 排程服务语义与复习历史保留；P0 已覆盖相关数据库写路径")
def test_invariant_3_reference_kp_has_no_active_review_item() -> None:
    """`retention = reference` 的 KP 没有 active ReviewItem；paused 卡片及
    复习历史保留（§9.3 / §7.1 / ADR-041）。P0 数据层守卫：reference 的
    active INSERT／UPDATE 与 KP 意愿切换三条写路径全部由触发器拒绝，paused
    合法，且 reference 不得激活 queued 项；完整排程服务语义待 P5。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P5：Occurrence 唯一性口径 + 排程服务落地；P5 前滚迁移须把 (kp_id, occurrence_id) 唯一键改为 occurrence 粒度、限定 status != 'retired' 的部分唯一索引")
def test_invariant_4_at_most_one_default_review_item_per_kp() -> None:
    """同一 Occurrence 默认至多一条非 retired ReviewItem，同一 KP 下不同
    Occurrence 可各自建卡，额外卡片必须有用户显式操作记录；status=retired 与
    retired_at 非空等价，暂停恢复不改变退役标记（§9.4 / §7.1 / ADR-041）。
    P0 数据层守卫：retired 等价 CHECK + retired_at/admitted_at 单向触发器 +
    active 须有 admitted_at；ReviewState 在首次评分时建立，P0 不实现排程
    （见 test_constraints）。已知缺口：当前
    `UniqueConstraint("kp_id", "occurrence_id")` 是 ADR-041 之前的形状——它比
    §7.1 更严（挡住 retired 后为同一 Occurrence 另建卡），又不等于 Occurrence
    唯一（同句挂不同 kp_id 仍可两条）。**P5 前滚迁移**须把它换成
    `occurrence_id` 粒度、`WHERE status != 'retired'` 的部分唯一索引；P0 不
    改产品唯一性口径。额外卡片授权由 P5 排程服务强制。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4b：Span 偏移合法且切片回读等于 surface（后端 find_all 落地）")
def test_invariant_6_span_offsets_slice_back_to_surface() -> None:
    """任何 Span 的 code point 半开区间非空、在原句内，
    `sentence.text[char_start:char_end] == span.surface`（§9.6 / §1）。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P3b：记忆槽位由写入路径强制，不由清理任务保证")
def test_invariant_7_memory_slot_limit_enforced_on_write() -> None:
    """MaterialNote 与 LearnerProfileNote 的条数上限 N 与单条长度 M 由
    写入路径强制（§9.7 / §6 / ADR-029）。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4b：全部证据生产者落地后验证查词/播放/阅读/评分不产 KE")
def test_invariant_8_id_spaces_do_not_leak() -> None:
    """Lexeme 不进 Alias，KP 不成为 KnownEvidence 的 target；查词、播放、
    阅读曝光和评分不产生 KE（§9.8 / §2.2 / ADR-040）。数据层 FK 已隔离
    身份空间；行为边界待生产者落地后验证。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4b：StudySession 阶段门控与提取输入固定（P3a/P3b 落机制）")
def test_invariant_9_discussion_runs_bound_to_active_discussion_phase() -> None:
    """只有 active + discussion 的会话接受新的讨论运行；切换阶段须先结束
    或确认取消在途文档写操作；提取输入不随当前文档变化（§9.9 / §4.1）。
    旧语义（Analysis.session_closed）已随第二状态机删除。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4b：ExtractionSection 落地（P4a）后验证成功 run 的全小节 kind 映射")
def test_invariant_10_successful_run_maps_all_sections() -> None:
    """成功 ExtractionRun 对其输入版本的全部小节都有合法
    ExtractionSection.kind；提取前无映射合法，提取不修改小节正文
    （§9.10 / §4.6）。旧语义（Analysis.extraction_status = done）已删除。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4b：并发 upsert 收敛与同 run 幂等提交（唯一约束已就位，见 test_constraints）")
def test_invariant_11_anchor_unique_with_idempotent_upsert() -> None:
    """KP.anchor 唯一，并发 upsert 收敛；同一运行的重复提交不复制产物
    （§9.11 / §3.1）。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4b：anchor 派生器与 pattern 序列化落地")
def test_invariant_12_pattern_anchor_matches_serialized_payload() -> None:
    """pattern KP 的 anchor 等于按其 pattern_grammar_version 序列化的
    payload（§9.12 / §0 anchor_key 规范）。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4b：slot_bindings 完整性校验落地")
def test_invariant_13_slot_bindings_match_pattern_slots() -> None:
    """pattern Occurrence 的 slot_bindings 键集合等于模式槽位集合；其他
    shape 为空对象（§9.13 / §3.3 约束 4–5）。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4b：槽位定位与跨槽位校验落地")
def test_invariant_15_slot_order_and_disjoint_spans() -> None:
    """槽位顺序与模式一致，跨槽位 Span 不相交；完整匹配 Span 可以包含
    槽位 Span（§9.15 / prompt-contracts §5.2）。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4b：slot_bindings 值引用校验落地")
def test_invariant_16_slot_bindings_reference_occurrence_spans() -> None:
    """每个 slot_bindings 值均在该 Occurrence.spans 中；spans 是有序数组，
    不限长度 1（§9.16 / §1 物理存储）。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4b：SessionConfirmation 与会话完成逻辑落地")
def test_invariant_17_completion_from_current_run_confirmation_only() -> None:
    """会话完成只依据当前成功 run 的本次确认（零候选须明确完成），不依据
    KP 当前全局 retention；后续意愿修改不复活旧会话（§9.17 / §4.2 /
    ADR-037）。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P5：配额与排程服务落地（P4b 提供决定接口）")
def test_invariant_18_new_review_items_require_user_decision_and_quota() -> None:
    """任意模式的新建复习项均有针对具体 Occurrence 的明确加入决定，并与该
    决定原子提交；default 或 KP 策略变化不构成授权。首次准入排程须满足
    配额，未准入项为 queued；已准入项的暂停恢复不重复消耗配额、不清除进度
    （§9.18 / §7.1 / ADR-041）。P0 数据层已区分 queued 与 active 的
    admitted_at 语义（ReviewState 与首条 ReviewEvent 由首次评分在 P5 建立）；
    授权与配额服务待 P5。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4b：提取/确认/工具副作用原子提交与幂等执行器落地")
def test_invariant_19_atomic_idempotent_write_paths() -> None:
    """提取、确认、Agent 工具副作用与复习提交各自原子且幂等；失败不得
    留下宣称成功的部分产物（§9.19 / §0.1 / §4.6）。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P4b：版本化更新与历史引用保护落地（ADR-039）")
def test_invariant_20_updates_preserve_history_references() -> None:
    """当前状态可更新；历史引用、用户决定保护和关联完整性不因更新而
    失效（§9.20 / §0.1）。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P2：Lexeme 证据入口与裁定/撤回写路径落地（ADR-040）")
def test_invariant_21_user_decisions_scope_and_precedence() -> None:
    """用户当前裁定按作用域生效，unknown 压过导入和 SRS；clear 不复活旧
    用户 KE。撤回保留来源历史，并与失效记录原子提交（§9.21 / §2.2）。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P2-known-import 切片：KnownImportRun/Entry 落地")
def test_invariant_22_known_import_idempotent_publish_boundary() -> None:
    """已知词表同操作幂等；未发布、失败、取消和被撤回来源不贡献已知
    状态，未唯一消解输入不拆成多个已知词（§9.22 / §2.3）。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P5：ReviewEvent 与资格摘要落地")
def test_invariant_23_srs_cross_layer_signal_eligibility() -> None:
    """SRS 跨层信号有实际评分 Occurrence 与完整累计状态的资格依据；合并
    或换例句不能转授旧评分，不合格状态不影响原有排程（§9.23 / §2.4）。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P5：按词摘要/稀疏索引/增量一致性完整语义（P2 实验 11a 做结构验证）")
def test_invariant_24_hot_queries_use_target_set_indexes() -> None:
    """高频查询使用目标集合的摘要／索引，不全扫历史或解包全部 sidecar；
    增量结果与相同规则、来源版本和 as_of 的重建结果一致（§9.24 / §11）。"""
    raise NotImplementedError


@pytest.mark.xfail(strict=True, reason="点亮阶段 P5：时间有效性与代次一致性完整语义（P1 提供代次前提）")
def test_invariant_25_time_valid_results_and_generation_consistency() -> None:
    """时间相关结果不因无写入而无限有效；过期或重建中结果有明确状态，
    读请求不混合投影代次，不能把重建空窗显示为真实零值（§9.25 / §11）。"""
    raise NotImplementedError
