---
id: ADR-006
status: accepted
---

# ADR-006 已知状态是证据上的视图
## 决策

KnownEvidence 追加保存来源、时间、置信度、Lexeme 与可选活用表层；已知状态由证据计算。来源、用户裁定与可重建查询投影由 ADR-040 细化；不把派生状态写成 Lexeme 上唯一真相的布尔字段。

## 理由与取舍

“掌握”需要口径，不能把来源差异覆盖成一个布尔字段。证据目标是 Lexeme，不是 KP。追加保存的是观测事实，并不意味着当前判断永远不变；撤回和新裁定保留历史同时支持纠错。

## 当前落点

[数据模型 §2.2](../data-model.md#22-knownevidence-与用户裁定)、[ADR-040](040-evidence-and-query-projections.md)
