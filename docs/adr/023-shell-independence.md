---
id: ADR-023
status: accepted
---

# ADR-023 学习组件独立于 shell
## 决策

解析文档/编辑、对话、确认、聚合、复习组件通过数据和操作接口装配；不反向依赖 reader/Study/review shell。

## 理由与取舍

复习与未来入口可复用同一底座。保持依赖方向，不将某次阶段 diff 的文件清单当成组件不能演进的永久限制。

## 当前落点

[DESIGN](../../DESIGN.md#组件)
