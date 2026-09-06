# P4-backend：抽取、Span、KnowledgePoint、Occurrence 与 triage API

## 读取范围

公共前言见 `_template.md`。另读 `docs/prompt-contracts.md` §5–§7、`docs/data-model.md` §1、§3、§4.2–§4.3、§9，`docs/adr.md` 的 ADR-005、ADR-009、ADR-017、ADR-019、ADR-021。

## 目标

实现抽取的唯一写入通道、后端 Span 定位、KP/Occurrence 建立、失败重跑和 triage 提交。

## 必须完成

- `extraction_v1.md` 自足：解析全文 + 形态规范 + top-k 候选即可独立调用；续轮只是快路径。
- rapidfuzz top-k=10；优先复用 anchor，不合适时按规范新建。
- surface 用 `find_all` 定位：0 次不建 Span 并记录 unresolved；1 次按 token 对齐；多次每处建 ambiguous Span；无法 token 对齐时保留 unaligned Span。
- Span 通过真实关联表引用，Occurrence 内容引用 `section_id + section_revision`，不能指向解析正文字符区间。
- KP anchor 唯一约束和幂等 upsert；Occurrence 无条件记录、永不去重。
- section_hint 匹配 heading_path，回填 kind/spans；失败按降级规则记录警告。
- 三条硬失败条件最多重跑抽取两次，不重新生成 Analysis；弱信号记录并提示。
- triage 对每条候选都写 `retention_set_by = user`；用户决定后重跑不得覆盖。
- 触发抽取即 `session_closed = true`。

## 不做

不实现 revise/merge、批量解析、写入时 alias 查重、高频语法模式匹配或 ReviewItem。

## 验收

点亮不变量 1、2、6、8、9、10、11；通过 Occurrence 删除后重建、独立调用、多命中 ambiguous、部分 unresolved、tags 并集和 retention 保护测试。
