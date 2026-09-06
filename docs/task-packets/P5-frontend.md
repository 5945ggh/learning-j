# P5-frontend：ReviewCard、AggregateCard 与复习 shell

## 目标

实现复习视图和聚合视图，并验证 ADR-023 的组件独立性。

## 必须完成

- 新增 `ReviewCard`：正面 anchor + 例句 Span 高亮 + 可选音频，背面引用的 AnalysisSection。
- 新增 `AggregateCard`：并置历次 Occurrence；分别显示“被讲解过 n 次”和“在材料中出现过 m 次”，各带来源标签。
- 新增 review shell，队列状态由 shell 管理，卡片通过 props 工作。
- 音频缺失时保留完整卡片，不渲染坏链接或空白控件。
- 在不修改已有 `src/components/**` 文件的前提下装配 review shell；P5 的 components diff 只能包含新增 ReviewCard 与 AggregateCard（以及必要的测试/导出文件）。
- 不添加未读数、红点或逐条处理强制流程。

## 不做

不修改 `AnalysisDocView`、`TriagePanel` 来迁就 review shell；不合并两个计数；不让组件读取 shell 内部状态。

## 验收

运行 lint、类型检查、构建和组件测试；额外输出 `git diff --stat -- frontend/src/components`，确认没有修改已有组件。
