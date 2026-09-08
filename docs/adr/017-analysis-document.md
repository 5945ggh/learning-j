---
id: ADR-017
status: partially_superseded
superseded_by: [ADR-038, ADR-039]
---

# ADR-017 解析是文档，提取为第二阶段
## 决策

保留自由讲解文档与结构化提取两阶段。第一阶段用最小 heading-id 辅助寻址，允许后端降级；提取从确定的完整文档版本产生 KP/Occurrence。

## 理由与取舍

要求第一阶段直出知识 JSON、硬标题语义层级或文末哨兵块，会反向绑架讲解。文档与对话并存能容纳用户困惑产生的补充。

旧“只追加小节”“不依赖工具操作”“内部工具轨迹一律不存”不再约束讨论 Agent；当前工具和上下文规则见 ADR-038。用户结束讨论固定文档供提取，旧小节引用保护见 ADR-039。续轮仅为优化，自足提取必须保留。

## 当前落点

[ADR-038](038-document-agent.md)、[ADR-039](039-history-protection.md)、[模型契约](../prompt-contracts.md)
