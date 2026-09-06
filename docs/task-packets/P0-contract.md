# P0-contract：契约启动检查

这是实现前的一次只读检查。它不修改文档、不写业务代码，目的是让 P0 后端和前端拿到同一版契约。

## 交给 agent 的任务

阅读 `docs/LearningJ-plan-v5.md` 的 §14–§15、`docs/adr.md` 中 ADR-005、ADR-009、ADR-017、ADR-020、ADR-023、ADR-032、`docs/data-model.md` 全文尤其 §0、§1、§8、§9，以及 `docs/prompt-contracts.md` 的相关章节。

输出一份只读检查报告，确认：

- Span 使用独立不可变 `spans` 表，并由 Occurrence、AnalysisSection、Annotation 等显式关联表通过真实外键引用；禁止 `owner_type/owner_id` 多态外键。
- MVP 词典交换格式为 Yomitan ZIP，内部使用 canonical dictionary model；不要按 JMdict-only 设计。
- MVP 素材包含字幕、纯文本、EPUB；PDF 走纯文本降级。若 P1 先分批实现 EPUB，必须登记为后续硬性交付，而不是移出 MVP。
- P0 迁移需要一次建出 `docs/data-model.md` 中的全部实体。
- 前端组件与 shell 的边界、code point 文本切片规则和 BYOK 降级路径明确。
- P0 实现包不需要修改 `docs/`；任何文档缺口只进入报告。

## 验收

报告必须逐项引用文件和章节，并标出 `clear`、`needs-owner-decision` 或 `blocked`。出现 `blocked` 时不要派依赖该决定的实现任务。
