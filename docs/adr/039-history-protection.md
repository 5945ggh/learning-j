---
id: ADR-039
status: accepted
decided_at: 2026-09-08
---

# ADR-039 分级历史保护与可更新当前状态
## 决策

保护被引用的解析版本、学习事实与来源；允许更新当前状态、文档指针、用户意愿、笔记及 SRS 投影。有效文档编辑版本化变化的小节；提取固定 manifest，未引用草稿可有限保留。KP 的 `default_retention`、Occurrence 的 `retention_override` 和确认时的 `effective_retention_at_confirmation`／`retention_override_at_confirmation` 分别表达当前默认、局部选择和历史快照，不以字段状态替代用户授权。

## 理由与取舍

全面“永不原地改写”混淆内容引用、用户授权和运行状态，增加存储及查询负担。禁止自动覆盖用户决定不意味着禁止用户修改。

KP 意愿/合并更新附简短决策事件，Occurrence 原引用不改。reference 暂停复习，srs 恢复原进度；真正退役仍单向且与暂停分开。ReviewEvent 保存事实，ReviewState 更新当前值。会话中首次明确加入新 ReviewItem 时恰有一条对应授权事实；复用非退役 ReviewItem 不新增授权或重置状态；退役后再次加入使用 `explicit_readd`，可由会话确认反向追溯。协议日志与调试数据按用途保留，不要求保存隐藏推理或每轮完整注入。用户明确删除个人数据另走引用处理，不以历史保护无限禁止删除。KE 来源撤回、当前词汇裁定与可重建摘要由 ADR-040 细化，仍遵守事实追加、投影可更新的边界。开发 schema 的显式重建边界与真实数据基线见 ADR-042。

## 当前落点

[数据模型 §§0.1、4、7](../data-model.md#01-历史与当前状态)、[开发 schema 基线 ADR-042](042-development-schema-baseline.md)
