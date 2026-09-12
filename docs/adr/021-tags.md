---
id: ADR-021
status: accepted
---

# ADR-021 知识内容使用多值标签
## 决策

标签可重叠、为空、后加；MVP 先保证 grammar 标签。标签、`anchor_shape`、KP `default_retention` 默认策略与 Occurrence `retention_override` 局部覆盖各司其职。

## 理由与取舍

不存在不杂不漏的语言学单值分类；payload 格式判别式不是语言学判断，复习意愿更不属于内容类型。

## 当前落点

[数据模型 §3.1](../data-model.md#31-knowledgepoint)
