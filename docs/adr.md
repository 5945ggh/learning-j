# LearningJ 架构决策索引

本页只导航决策理由；当前字段、流程和协议分别以 [数据模型](data-model.md)、[模型契约](prompt-contracts.md) 与 [DESIGN](../DESIGN.md) 为准。未决事项只在 [产品规划 §15](LearningJ-plan-v5.md#15-未决事项) 维护。

每篇 ADR 顶部的 YAML front matter 是机器可读元数据，状态值使用 `proposed`、`accepted`、`deferred`、`rejected`、`partially_superseded`、`superseded`、`merged`。`docs/adr/archived/` 只存不再属于当前决策面的历史条目；需要追溯历史时再读取。

2026-09-08 将原单文件按编号拆分并精简；001–036 编号和合并关系保留，新增 037–039；2026-09-09 新增 ADR-040，细化证据与查询投影。被替代的条目只保留历史判断与新落点，不构成并行的现行要求。阶段计划已按当前核心契约校准，task-packets 尚未单独同步。

| 编号 | 决策 | 状态 |
|---|---|---|
| <a id="adr-001"></a>ADR-001 | [受众与留存阶段](adr/001-audiences.md) | 已接受 |
| <a id="adr-002"></a>ADR-002 | [否决一般层／实例层解析](adr/002-reject-general-instance.md) | 已否决 |
| <a id="adr-003"></a>ADR-003 | [暂缓解析共享缓存](adr/003-defer-sharing.md) | 暂缓 |
| <a id="adr-004"></a>ADR-004 | [KP 全局身份与出现](adr/archived/004-redirect-005.md) | 已并入 |
| <a id="adr-005"></a>ADR-005 | [知识点的身份模型](adr/005-kp-identity.md) | 已接受；历史写入措辞由 ADR-039 更新 |
| <a id="adr-006"></a>ADR-006 | [已知状态是证据上的视图](adr/006-known-evidence.md) | 已接受；证据来源／投影由 ADR-040 细化 |
| <a id="adr-007"></a>ADR-007 | [已知状态的词形粒度](adr/archived/007-redirect-006.md) | 已并入 |
| <a id="adr-008"></a>ADR-008 | [推荐卡片流](adr/archived/008-redirect-022.md) | 已并入 |
| <a id="adr-009"></a>ADR-009 | [可校验内容由算法处理并区分来源](adr/009-algorithm-provenance.md) | 已接受 |
| <a id="adr-010"></a>ADR-010 | [媒体身份与存储分离](adr/010-media-identity.md) | 部分替代：复制策略见 ADR-033 |
| <a id="adr-011"></a>ADR-011 | [互操作分期，证据先行](adr/011-interop-evidence.md) | 部分替代：阅读活动边界见 ADR-040 |
| <a id="adr-012"></a>ADR-012 | [不为应试单建课程能力](adr/012-exam-boundary.md) | 已接受 |
| <a id="adr-013"></a>ADR-013 | [Anki 导出保留显式选择](adr/013-anki-confirmation.md) | 已接受 |
| <a id="adr-014"></a>ADR-014 | [可疑句发现后置](adr/014-suspicious-highlights.md) | 提议；不在 MVP |
| <a id="adr-015"></a>ADR-015 | [核心分词不依赖 jpdb](adr/archived/015-redirect-018.md) | 已并入 |
| <a id="adr-016"></a>ADR-016 | [TTS 与原声使用不同证据来源](adr/016-tts-evidence.md) | 部分替代：区分保留，证据生产边界见 ADR-040；选型后置 |
| <a id="adr-017"></a>ADR-017 | [解析是文档，提取为第二阶段](adr/017-analysis-document.md) | 部分替代：讨论与持久化见 ADR-038/039 |
| <a id="adr-018"></a>ADR-018 | [Sudachi A mode 与确定性词形身份](adr/018-sudachi-identity.md) | 已接受 |
| <a id="adr-019"></a>ADR-019 | [知识保留与复习闸门](adr/019-review-gates.md) | 部分替代：自动建卡策略见 ADR-037 |
| <a id="adr-020"></a>ADR-020 | [Python 后端与本地密钥边界](adr/020-local-backend.md) | 已接受；分发方式未定 |
| <a id="adr-021"></a>ADR-021 | [知识内容使用多值标签](adr/021-tags.md) | 已接受 |
| <a id="adr-022"></a>ADR-022 | [推迟推荐卡片流](adr/022-defer-recommendation.md) | 部分替代：多选行为见 ADR-037 |
| <a id="adr-023"></a>ADR-023 | [学习组件独立于 shell](adr/023-shell-independence.md) | 已接受 |
| <a id="adr-024"></a>ADR-024 | [解析语言独立于 UI 国际化](adr/024-analysis-language.md) | 已接受 |
| <a id="adr-025"></a>ADR-025 | [依存分析按 GiNZA 整体成本评估](adr/025-dependency-analysis.md) | 提议；尚未拍板 |
| <a id="adr-026"></a>ADR-026 | [Lexeme 与 KP 分层](adr/archived/026-redirect-005.md) | 已并入 |
| <a id="adr-027"></a>ADR-027 | [显式指认](adr/archived/027-redirect-005.md) | 已并入 |
| <a id="adr-028"></a>ADR-028 | [文档与最小寻址](adr/archived/028-redirect-017.md) | 已并入 |
| <a id="adr-029"></a>ADR-029 | [作品笔记与学习者画像](adr/029-memory.md) | 已接受；工具与历史规则见 ADR-038/039 |
| <a id="adr-030"></a>ADR-030 | [Annotation 不自动提升为 KP](adr/030-annotation-boundary.md) | 已接受 |
| <a id="adr-031"></a>ADR-031 | [显著性与每 KP 一卡](adr/archived/031-redirect-019.md) | 已并入 |
| <a id="adr-032"></a>ADR-032 | [词典交换格式与 Provider 隔离](adr/032-dictionary-provider.md) | 已接受 |
| <a id="adr-033"></a>ADR-033 | [原始资源与派生索引分层](adr/033-source-storage.md) | 已接受；统一旧视频复制措辞 |
| <a id="adr-034"></a>ADR-034 | [结构化模式语言与 shape](adr/034-pattern-language.md) | 已接受；枚举与严格度待实验 |
| <a id="adr-035"></a>ADR-035 | [身份消解条件触发](adr/035-identity-resolution.md) | 已接受 |
| <a id="adr-036"></a>ADR-036 | [独立 Study 与旧收件入口多视图](adr/archived/036-study-inbox-views.md) | 已被 ADR-037/038 替代 |
| <a id="adr-037"></a>ADR-037 | [学习会话、队列与知识库](adr/037-study-session.md) | 已接受（2026-09-08） |
| <a id="adr-038"></a>ADR-038 | [可编辑解析文档与讨论 Agent](adr/038-document-agent.md) | 已接受（2026-09-08） |
| <a id="adr-039"></a>ADR-039 | [分级历史保护与可更新当前状态](adr/039-history-protection.md) | 已接受（2026-09-08） |
| <a id="adr-040"></a>ADR-040 | [证据、用户裁定与查询投影](adr/040-evidence-and-query-projections.md) | 已接受（2026-09-09） |
