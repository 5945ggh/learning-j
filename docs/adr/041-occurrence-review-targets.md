---
id: ADR-041
status: accepted
decided_at: 2026-09-10
---

# ADR-041 Occurrence 级复习对象与双层复习意愿

## 决策

复习内容以 Occurrence 为粒度。ReviewItem 必须引用一个固定的 `occurrence_id`；`kp_id` 作为归属、聚合和查询索引保留，但不再决定 ReviewItem 的唯一性。同一 KP 下的多个 Occurrence 可以在用户明确选择后分别进入复习。

当前流程不支持把既有 ReviewItem 换绑到新的 Occurrence；若旧数据或迁移中存在换例句痕迹，只作为历史资格核对输入，不改变固定引用、复习事件或排程状态。

KP 的 `default_retention` 对用户称为“默认复习策略”；Occurrence 使用 `retention_override` 表示具体例句或讲解实例的局部覆盖。覆盖支持 `inherit`、`srs`、`reference` 三态；`inherit` 使用其原始 `kp_id` 对应 KP 的当前 `default_retention`。局部选择不会无提示地修改 KP。用户若要同时修改 KP 默认策略，必须明确选择该附加操作。

没有 `KnowledgePointRetentionDecision` 时，初始化的 `default_retention = srs` 只是默认值，不能作为 `inherit` 的用户授权。用户首次明确接受该默认值也追加决定，即使新旧值同为 `srs`；只有已有决定后的同值重复设置才不追加。决定记录的 `previous_default_retention`／`default_retention` 与 KP 当前值同一事务更新。

用户是否确认与局部覆盖值分开记录。默认 `inherit` 不代表用户已选择，明确沿用也须针对具体 Occurrence 记录确认与当次有效值；沿用确认引用对应的 `KnowledgePointRetentionDecision`，直接确认由 `SessionConfirmation` 自身承载。合法确认组合只有 `(user, srs, NULL)`、`(user, reference, NULL)`、`(inherited, inherit, current_kp_decision_id)`，且 inherited 必须引用同一原始 KP 的当前有效决定；没有决定记录时不能把初始化 `srs` 当作沿用授权。确认 reference 而没有 ReviewItem 的 Occurrence，不因未来 KP 改为 srs 自动获得建卡授权。

会话内的确认记录本身就是加入学习的审计事实，不为同一动作重复写一条通用日志。知识库直接修改局部意愿时，才追加紧凑的 `OccurrenceRetentionDecision(occurrence_id, previous_retention_override, retention_override, source, operation_key, created_at)`；相同值的重复写入不产生事件。新建 ReviewItem 恰好一条对应的 `ReviewItemAdmissionDecision`；知识库内的明确逐例句加入使用 `source = knowledge_base`，退役后再次加入使用 `source = explicit_readd`，均不要求先改变 `retention_override`。系统不引入通用事件溯源或逐次 UI 操作日志。

用户在学习会话确认阶段明确选择某个 Occurrence 加入学习时，立即创建或复用对应的 ReviewItem；新建项恰好记录一条 `ReviewItemAdmissionDecision(source = session_confirmation)`，其 `target_review_item_id` 唯一且与 Occurrence 一致。每日配额不足时新建项以 `queued` 状态等待，不丢失用户决定；复用既有非 retired 项不新增授权、不初始化或丢弃其状态与进度，但仍可依据有效策略正常转换状态。ReviewItem 的状态与意愿分离：`active`、`paused`、`retired`（以及配额等待用的 `queued`）不改写 ReviewEvent 或 Occurrence 历史。

知识库直接加入使用 `source = knowledge_base` 且不关联会话；退役后再次加入使用 `source = explicit_readd`，必须指向同一 Occurrence 已退役的旧项。若再次加入／重建由会话触发，可选填写 `session_confirmation_id` 追溯该会话；普通知识库操作保持为空。两种再次加入都不要求先改变局部覆盖值。

加入决定与 ReviewItem 的创建／复用必须原子且幂等；正常流程不存在“已加入但尚未建卡”。每日配额控制已有 queued 项首次进入排程。KP 从 `reference` 改为 `srs`，只恢复受该策略影响的既有非 retired 项；未获配额的回到 queued，已获配额的恢复原进度，不重复消耗配额。有效策略为 reference 时，既有非 retired 项可暂停，retired 项保持 retired；新建项仍按确认与排程进入 queued。无 ReviewItem 的 Occurrence 仍须用户明确加入；已退役项若要重建，必须另有明确再次加入授权，不把同值覆盖设置当作授权。

KP 合并／撤销不迁移 ReviewItem，不改写其原始引用或复习事件。查询通过 canonical 归属聚合；这种聚合不自动切换默认策略来源，也不覆盖 Occurrence 的局部覆盖。统一默认策略或改变局部选择须作为另一个明确、可审计的用户操作。

ReviewItem 是复习调度绑定，不等同于最终渲染卡片。卡片内容定义可以在未来作为独立的 CardDefinition 扩展；当前 ReviewItem 只承担 Occurrence 到复习排程的映射，不把 KP 唯一性写入卡片身份。

## 理由与取舍

Occurrence 才同时固定了例句、Span、具体解析小节版本和讲解摘要，适合作为站内复习和 Anki 导出的稳定内容引用。KP 继续承担知识库聚合、合并和默认策略管理。这样既支持同一知识点的多个语境分别复习，也避免每次再遇自动生成卡片。

KP 的全局 `reference` 可让继承状态的 Occurrence 默认不可选或呈灰色，但用户必须能明确选择局部例句。反向地，KP 意愿变化不删除或退役既有卡片；仅影响继承该意愿的卡片，暂停与恢复保留排程和历史。

## 当前落点

[产品规划 §8](../LearningJ-plan-v5.md#8-复习与再遇)、[数据模型 §3.1、§4.2、§7](../data-model.md#7-srs)、[模型契约 §6](../prompt-contracts.md#6-确认与排程边界)
