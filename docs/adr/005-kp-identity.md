---
id: ADR-005
status: accepted
---

# ADR-005 知识点的身份模型
## 决策

Lexeme 是算法身份，KP 由显式提取构成；各次语境记为 Occurrence。KP 使用自签发 ID 与形式级自然键，义项不参与身份；别名和可撤销合并归一锚点，不归一内容。

## 理由与取舍

自动分词无法确定“此处讲的是什么”；共用两层 ID 会让读过或导入的每个词变成知识点。否决词典义项挖矿作为 KP 内容来源：词典厂商的切分不应成为学习内容边界。

模型命名的漂移由 ADR-034 的结构化 payload 缓解，不能仅凭形状相同就宣称同一性已经解决；种子、候选召回与后续人工合并仍有作用。canonical_id 可更新并记录合并事件，旧 Occurrence 原始指向保留。

## 当前落点

[数据模型 §§2–3](../data-model.md#3-knowledgepoint-层)、[ADR-034](034-pattern-language.md)、[ADR-039](039-history-protection.md)
