---
id: ADR-037
status: accepted
decided_at: 2026-09-08
---

# ADR-037 学习会话、队列与知识库
## 决策

引入 StudySession，解析队列查询未完成会话，材料会话列表提供按材料筛选的同一视图；准备中可打开，经历讨论、固定版本提取、本次确认后完成，完成记录保留。知识库独立管理长期 KP、来源、关系和复习意愿。

## 理由与取舍

等待生成和继续讨论属于同一学习活动，按 KP default 筛选无法表达其生命周期。SessionConfirmation 固定本次提取结果上的选择，知识库后续变更不复活旧会话。

已完成会话需要修改解析时创建新的关联 StudySession，以 `parent_session_id + source_analysis_revision_id` 表达同一来源句／revision 的后续研究；不合并原会话的生命周期、确认、Occurrence 或 ReviewItem。

普通多选创建多个可讨论的单句会话；automatic 必须显式选择，只跳过讨论，所有模式新卡均须用户明确 srs 决定。这替代 ADR-019/022 旧自动建卡与批量禁止讨论的组合。导航与关窗不提取，搁置可恢复；推荐队列仍后置。

## 当前落点

[数据模型 §4](../data-model.md#4-学习会话工作文档与提取)、[产品规划 §3](../LearningJ-plan-v5.md#3-阅读学习会话知识库与复习)、[DESIGN](../../DESIGN.md#解析队列与学习记录)
