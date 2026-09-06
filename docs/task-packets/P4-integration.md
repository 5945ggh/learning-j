# P4-integration：抽取与 triage 集成验收

## 验收

- 续轮与独立抽取使用同一 prompt contract，清空会话历史仍可完成抽取。
- 删除 Occurrence 后重跑能重建，Analysis 与 AnalysisSection 正文不变。
- 多命中 surface 产生多个 ambiguous Span；部分 unresolved 不触发全量重跑。
- triage 提交后的 `retention_set_by=user` 不被后续重跑覆盖。
- `session_closed` 闸门、section revision 引用和 KP anchor 唯一约束在集成测试中成立。
- 前端没有重复实现任何后端持久化规则。
