---
id: ADR-018
status: accepted
---

# ADR-018 Sudachi A mode 与确定性词形身份
## 决策

采用 SudachiPy + SudachiDict A mode，以 normalized_form + POS + reading_form 派生 Lexeme ID；词典版本独立记录，不将 Sudachi 内部 word id 作为持久身份。

## 理由与取舍

原选型评估认为包体积与 Python 生态更合适，代价是没有 UniDic 語彙素严格对应。Anki/jpdb/Yomitan 不共享该 ID，因此主要风险是站内规范形漂移，须留版本来源与迁移映射。

## 当前落点

[数据模型 §2.1](../data-model.md#21-lexeme)
