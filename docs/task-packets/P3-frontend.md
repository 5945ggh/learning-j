# P3-frontend：AnalysisDocView 与一次追问

## 目标

实现独立的 `AnalysisDocView`：按后端 section 渲染解析、提供一次追问输入、显示 note 写回和不可用状态。

## 必须完成

- 小节渲染只消费 `body_md` 和 section metadata，不在前端重新切 heading。
- 明确区分算法来源和模型来源。
- 追问输入有 generating/ready/error/closed 状态；session closed 后不能继续提交。
- note 写回成功、拒绝和槽位已满都有可见反馈。
- 组件不引用 shell，不直接读取路由或全局隐式状态。
- BYOK 缺失时入口置灰或显示明确不可用状态，但 reader/algorithmic surface 不受影响。

## 不做

不实现 extraction、triage、ReviewCard 或前端 section revise/merge。

## 验收

使用 fake API 验证首轮、追问、closed、note rejection、loading/error 和 Markdown 渲染；运行 lint、类型检查、构建。
