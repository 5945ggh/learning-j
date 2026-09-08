---
id: ADR-006
status: accepted
---

# ADR-006 已知状态是证据上的视图
## 决策

KnownEvidence 追加保存来源、时间、置信度、Lexeme 与可选活用表层；已知状态由证据计算。

## 理由与取舍

“掌握”需要口径，不能把来源差异覆盖成一个布尔字段。证据目标是 Lexeme，不是 KP。

## 当前落点

[数据模型 §2.2](../data-model.md#22-knownevidence)
