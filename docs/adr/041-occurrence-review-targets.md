---
id: ADR-041
status: accepted
---

# ADR-041 Occurrence 级复习对象与双层复习意愿

## 决策

复习内容以 Occurrence 为粒度。ReviewItem 必须引用一个固定的 `occurrence_id`；`kp_id` 作为归属、聚合和查询索引保留，但不再决定 ReviewItem 的唯一性。同一 KP 下的多个 Occurrence 可以在用户明确选择后分别进入复习。

KP 的 `retention` 对用户称为“默认复习策略”，字段名保留；Occurrence 表示具体例句或讲解实例的局部决定。Occurrence 的决定支持 `inherit`、`srs`、`reference` 三态；`inherit` 使用其原始 `kp_id` 对应 KP 的当前默认策略。局部选择不会无提示地修改 KP。用户若要同时修改 KP 默认策略，必须明确选择该附加操作。

用户是否确认与局部 retention 值分开记录。默认 `inherit` 不代表用户已选择，明确沿用也须针对具体 Occurrence 记录确认与当次有效值。确认 reference 而没有 ReviewItem 的 Occurrence，不因未来 KP 改为 srs 自动获得建卡授权。

会话内的确认记录本身就是加入学习的审计事实，不为同一动作重复写一条通用日志。知识库直接修改局部意愿时，才追加紧凑的 `OccurrenceRetentionDecision(occurrence_id, previous_retention, retention, source, operation_key, created_at)`；相同值的重复写入不产生事件。系统不引入通用事件溯源或逐次 UI 操作日志。

用户在学习会话确认阶段明确选择某个 Occurrence 加入学习时，立即创建对应的 ReviewItem；每日配额不足时以 `queued` 状态等待，不丢失用户决定。ReviewItem 的状态与意愿分离：`active`、`paused`、`retired`（以及配额等待用的 `queued`）不改写 ReviewEvent 或 Occurrence 历史。

加入决定与 ReviewItem 的创建／复用必须原子且幂等；正常流程不存在“已加入但尚未建卡”。每日配额控制已有 queued 项首次进入排程。KP 从 reference 改为 srs，只恢复受该策略影响的既有非退役项；未获配额的回到 queued，已获配额的恢复原进度，不重复消耗配额。无 ReviewItem 的 Occurrence 仍须用户明确加入。

KP 合并／撤销不迁移 ReviewItem，不改写其原始引用或复习事件。查询通过 canonical 归属聚合；这种聚合不自动切换默认策略来源，也不覆盖 Occurrence 的局部决定。统一默认策略或改变局部选择须作为另一个明确、可审计的用户操作。

ReviewItem 是复习调度绑定，不等同于最终渲染卡片。卡片内容定义可以在未来作为独立的 CardDefinition 扩展；当前 ReviewItem 只承担 Occurrence 到复习排程的映射，不把 KP 唯一性写入卡片身份。

## 理由与取舍

Occurrence 才同时固定了例句、Span、具体解析小节版本和讲解摘要，适合作为站内复习和 Anki 导出的稳定内容引用。KP 继续承担知识库聚合、合并和全局意愿管理。这样既支持同一知识点的多个语境分别复习，也避免每次再遇自动生成卡片。

KP 的全局 `reference` 可让继承状态的 Occurrence 默认不可选或呈灰色，但用户必须能明确选择局部例句。反向地，KP 意愿变化不删除或退役既有卡片；仅影响继承该意愿的卡片，暂停与恢复保留排程和历史。

## 当前落点

[产品规划 §8](../LearningJ-plan-v5.md#8-复习与再遇)、[数据模型 §3.1、§4.2、§7](../data-model.md#7-srs)、[模型契约 §6](../prompt-contracts.md#6-确认与排程边界)
