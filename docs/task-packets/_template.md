# {阶段}-{职责}：{任务名称}

将本文件开头的公共前言与本文件全文一起交给 subagent。阶段细节以对应的 `docs/` 文件为准。

## 公共前言

你正在参与 LearningJ 的实现。这是一个日语沉浸式学习辅助工具，核心链路是：素材导入 → 算法解析 → AI 解析 → 用户触发抽取 → 知识点沉淀 → 再遇与复习。

开始前按以下顺序阅读：

1. `docs/LearningJ-plan-v5.md`：只读本阶段涉及章节、§14 MVP 边界、§15 未决事项。
2. `docs/adr.md`：只读本任务点名的 ADR。
3. `docs/data-model.md`：只读本任务涉及实体和 §9 不变量清单。
4. `docs/prompt-contracts.md`：凡涉及解析、追问、抽取、记忆注入时必须阅读。
5. `docs/mvp-tech-and-phases.md`：确认技术栈与阶段验收。

发生冲突时，以当前 `docs/` 中的 `data-model.md` 与 `prompt-contracts.md` 为字段和输入输出契约，以 `adr.md` 为决策理由，以 `LearningJ-plan-v5.md` 为产品范围。不得以 `references/` 中的旧内容覆盖 `docs/`。

你不得修改 `docs/`、`references/`、`DESIGN.md` 或本任务未授权的目录。发现冲突、缺字段、无法满足的约束时，暂停受影响实现并在报告中说明，不自行选一个解释继续。

全项目硬约束：永不原地改写；外部资源记录必须有版本戳；字符偏移使用 Unicode code point；上层不得按素材类型分支；算法负责可校验的形态内容，模型只给语义和原文子串；Lexeme 统计与 KnowledgePoint 进度永不相加；不引入未经批准的依赖。

## 本任务

- 阶段：{P0–P5}
- 职责：{backend | frontend | integration}
- 目标：{一句话}
- 依赖：{上一阶段的 public contract}
- 可写范围：{明确目录}
- 禁写范围：{明确目录}

## 执行要求

开始编码前，先列出已确认契约、任务外内容和潜在阻塞。先写或补充行为测试，再实现代码。不要顺手重构相邻模块，不要用放宽契约的方式解决集成问题。

## 验收

- {验收项}

## 报告

使用 `docs/task-packets/README.md` 规定的交接报告格式。
