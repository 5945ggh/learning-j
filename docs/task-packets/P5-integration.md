# P5-integration：复习视图最终验收

## 验收

- P5 components diff 只包含新增 ReviewCard、AggregateCard 及必要测试/导出，不包含对 AnalysisDocView/TriagePanel 的修改。
- `no-restricted-paths` 没有 disable 或豁免。
- reference KP 没有有效 ReviewItem；retired ReviewItem 保留 ReviewState。
- ReviewCard 的背面引用 section revision，音频缺失路径可用。
- AggregateCard 的两个计数分别显示、分别标注来源；静态检查和测试确认不存在算术合并或互相校验。
- 执行后端测试、前端 lint/typecheck/build、集成测试，并在报告中列出剩余风险。
