---
id: ADR-034
status: accepted
---

# ADR-034 结构化模式语言与 shape
## 决策

KP 存 pattern/lexical/entity/opaque payload，后端版本化派生自然键。pattern 存有序字面量与槽位；实例绑定存 Occurrence。slot id 不参与身份，标签与 shape 分离。

## 理由与取舍

自由命名可能合法但不稳定；结构化输出能检查字面量顺序、槽位定位与 POS 相容性，把部分静默错误变成可检测失败。entity 身份不能用这些规则校验，这是明确代价。

逃生舱区分 model_chosen（覆盖缺口）和 validation_failed（校验失败），不能合并统计。零槽位恰为一个 lexeme 时应 lexical；form 不可靠时 warning。暂不实现 optional/repeat、折叠映射或语法关系图；六 category、八 form 的边界由实验 2 定案。

模式与绑定支持未来 cloze，但不能据此宣称自动语法再遇已实现。多槽位需要多个 Span，取代旧“MVP 恒为一个 Span”的限制。小版本增加枚举，大版本改变键算法；历史键迁移需显式映射与冲突合并，不能覆盖旧身份。维护一门小语言有长期成本，须以覆盖与校验数据控制扩展。

## 当前落点

[数据模型 §§0、3、9](../data-model.md#3-knowledgepoint-层)、[模型契约 §7](../prompt-contracts.md#7-模式语言)、[实验 2](../spike-checklist.md#2-模式语言的可校验性与身份稳定性)
