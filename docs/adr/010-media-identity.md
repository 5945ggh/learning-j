---
id: ADR-010
status: partially_superseded
superseded_by: [ADR-033]
---

# ADR-010 媒体身份与存储分离
## 决策

保留 locator、规范化文本 hash、字幕和时间戳；复习按需取句级媒体。旧“不存视频副本”改为默认不复制，明确选择可管理副本。

## 理由与取舍

视频大小与本地文件访问支持本地后端；身份不应依赖是否复制一份文件。

## 当前落点

[ADR-033](033-source-storage.md)、[数据模型 §8](../data-model.md#8-素材与句子)
