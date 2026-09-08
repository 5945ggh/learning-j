---
id: ADR-033
status: accepted
---

# ADR-033 原始资源与派生索引分层
## 决策

原始资源、规范化 logical text、sidecar 与用户状态分层。视频默认 external_reference，所有素材都可明确选择 managed_copy；管理副本不改源文件。content_hash 仍指规范文本，source_sha256 校验原文件。

## 理由与取舍

外部引用省空间但可能失去布局资源；管理副本有存储成本但便于稳定离线展示。导入必须说明大小与可用性影响。

Sidecar 可含原生 ruby hints、结构边界、句/token 范围，不存 XPath、DOM path 或渲染 span。应用展示适配不能修改原始文件；文本锚点保持 shell 无关。

## 当前落点

[数据模型 §8](../data-model.md#8-素材与句子)、[ADR-010](010-media-identity.md)
