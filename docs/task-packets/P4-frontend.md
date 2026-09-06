# P4-frontend：TriagePanel 与抽取状态

## 目标

实现候选知识点待确认界面和提交反馈，保持 triage 与抽取业务规则分离。

## 必须完成

- 展示 anchor、display form、brief、surface/Span、section 来源和 salience。
- 每条候选可选择 `srs` 或 `reference`，提交状态可重试。
- 展示 unresolved/ambiguous/weak signal 等后端状态，但不在前端重新定位 Span 或决定是否重跑。
- 提交后明确显示已由用户确认；不添加未读数、红点或强制逐条处理流程。
- 组件独立于 shell，不修改 `AnalysisDocView` 以适配 triage。

## 不做

不实现 KP upsert、retention 保护、重跑判断、ReviewItem 创建或聚合计数。

## 验收

使用固定候选 fixture 验证 srs/reference、提交失败、重试、ambiguous/unresolved 展示和空状态；运行 lint、类型检查、构建。
