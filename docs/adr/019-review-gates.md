---
id: ADR-019
status: partially_superseded
superseded_by: [ADR-037]
---

# ADR-019 知识保留与复习闸门
## 决策

Occurrence 与有效提取的 KP 保留；新卡受每日配额、按 Occurrence 的显式选择及 salience/FIFO 优先级控制。所有会话模式新建复习项都须用户明确选择，取代旧 batch/background 默认自动建卡；ReviewItem 的 Occurrence 粒度、KP `default_retention` 默认策略与 Occurrence `retention_override` 局部覆盖见 ADR-041。默认策略不等于逐例句建卡授权。

## 理由与取舍

应控制复习增长，不因排程容量丢弃新语境。默认意愿不等于用户确认；暂停恢复不消耗新卡配额。

## 当前落点

[数据模型 §7](../data-model.md#7-srs)、[ADR-037](037-study-session.md)、[ADR-039](039-history-protection.md)、[ADR-041](041-occurrence-review-targets.md)
