---
id: ADR-036
status: superseded
superseded_by: [ADR-037, ADR-038]
---

# ADR-036 独立 Study 与旧收件入口多视图
## 决策

保留独立 Study、异步发起、准确返回原文与组件复用的方向。旧“收件箱统一查询 Analysis/KP”不再定义学习活动生命周期。

## 理由与取舍

该方案没有独立表达从准备、讨论到本次确认的会话完成；全局 KP 意愿也不能替代会话进度。当前以学习会话、学习队列、学习记录、知识库重新分工。

## 当前落点

[ADR-037](../037-study-session.md)、[ADR-038](../038-document-agent.md)
