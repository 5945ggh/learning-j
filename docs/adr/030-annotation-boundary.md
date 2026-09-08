---
id: ADR-030
status: accepted
---

# ADR-030 Annotation 不自动提升为 KP
## 决策

Annotation 是原文划线、自由批注、列表检索与返回位置；不连 KP/SRS。学习内容来自解析小节，想进一步学习应回到原文创建会话。

## 理由与取舍

直接提升批注会引入无规范的 KP 内容来源；整理、学习讲解与排程需要各自的边界。Annotation 自身允许编辑，不受全面不可变规则限制。

## 当前落点

[数据模型 §5](../data-model.md#5-annotation)、[ADR-005](005-kp-identity.md)
