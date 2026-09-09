---
id: ADR-011
status: partially_superseded
superseded_by: [ADR-040]
---

# ADR-011 互操作分期，证据先行
## 决策

已知词表导入进入 Lexeme 证据层；互操作按功能分期，不把全部导入能力当成阅读可用前提。

## 理由与取舍

互操作加速冷启动，但导入不是对某处知识的显式指认。旧“阅读行为也可积累证据”由 ADR-040 替代：阅读／查词仅可能进入后置活动统计，不产生 KnownEvidence。已知词表单独记录可审计、可撤回的导入来源，不把全部牌组词条自动认作已知。

## 当前落点

[产品规划 §10](../LearningJ-plan-v5.md#10-互操作)、[数据模型 §2.3](../data-model.md#23-已知词表导入与消解)、[ADR-040](040-evidence-and-query-projections.md)
