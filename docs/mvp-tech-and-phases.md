# LearningJ MVP 第一阶段：技术选型与校准后的阶段计划

> **计划基线（2026-09-10）：** 本文按最新核心契约校准，含 [ADR-041](adr/041-occurrence-review-targets.md) 对 P0/P4b/P5 的边界调整（Occurrence 级确认、P4b 创建 queued ReviewItem、P5 负责首次准入排程）；任务包目录 [CURRENT-PACKETS.md](task-packets/CURRENT-PACKETS.md) 已同步。现行行为以 [产品规划](LearningJ-plan-v5.md)、[数据模型](data-model.md)、[模型与 Agent 契约](prompt-contracts.md)、[ADR 索引](adr.md) 和 [DESIGN](../DESIGN.md) 为准；本文负责排列实施顺序，不复制第二份字段或状态机定义。
>
> 当前仓库处于“旧 P0/P1 实现切片已存在、当前契约迁移尚未完成”的状态。P0-backend 已派发过一轮实现，但按 ADR-041 同步前的语义完成：ReviewItem 仍为 active/paused/retired 三态、缺 queued 与 admitted_at，需要返工校准后才验收。旧阶段验收通过不等于当前 P0/P1 完成；本文的阶段状态以 §2 为准。

## 1. 技术选型与贯穿约束

### 1.1 后端

| 层 | 选型 | 约束 |
|---|---|---|
| 语言／框架 | Python 3.11 + FastAPI | 本地后端路线已定，分发形态仍按 ADR-020 的未决项处理 |
| 包管理 | uv | 沿用现有后端基线 |
| 数据库 | SQLite（WAL） | 单用户本地数据集；不以实体数量推断性能，必须落实稀疏索引、增量摘要、短事务和版本发布 |
| ORM／迁移 | SQLAlchemy 2.0 + Alembic | 当前旧 schema 只能前滚迁移，不能删除重建或清空历史 |
| 契约建模 | Pydantic v2 | API、Agent 工具、提取输入输出和 JSON Schema 共享模型 |
| 分词 | SudachiPy + SudachiDict-core，A mode | Lexeme ID 由规范化形／词性／读音确定性派生；分析器词典版本独立保存 |
| 词典 | Yomitan ZIP → canonical dictionary model | 业务层不得泄漏 term_bank 等交换格式；定义保留纯文本投影、structured content、资源和来源版本 |
| Sidecar | msgpack | sidecar 不可变；重分词生成新 ID，不能覆盖被引用版本 |
| LLM | 自有薄 provider 层 + 官方 SDK adapter | 业务层只依赖内部 ChatResult；秘密不进入普通配置、日志、Analysis 或运行结果 |
| 结构化输出 | JSON → 必要时 repair → Pydantic 校验 | 不把任一 provider 的 tool calling 当作领域契约 |
| 模糊召回 | rapidfuzz，有界 top-k | 仅用于 KP 身份候选召回；不在每次页面查询中全表加载 |
| SRS | py-fsrs（FSRS-5） | ReviewState 是当前投影，ReviewEvent 是追加事实；算法与参数版本可追溯 |

### 1.2 前端

| 层 | 选型 | 约束 |
|---|---|---|
| 框架 | Vite + React 18 + TypeScript strict | shell 负责装配，组件只通过 props 和回调工作 |
| 样式 | Tailwind + shadcn/ui 源码 | 以 DESIGN.md 为唯一视觉与交互依据 |
| 数据请求 | 后端 OpenAPI 生成类型 + fixture | 不手写与后端平行的 Analysis、Session 或 retention 契约 |
| 路由／状态 | React Router + 少量 Zustand | 不把会话状态藏在路由或组件 timer 中 |
| Markdown | react-markdown + remark-gfm | 后端已切好的 body_md 按 section 渲染，前端不重新猜 heading 或 Span |

保留两条硬规则：src/components/** 不得依赖 src/shells/**；持久化文本区间使用 code point 和半开区间，前端通过 sliceByCodePoint() 适配，禁止裸 String.prototype.slice() 承担业务偏移。

### 1.3 数据、执行与写入边界

- 解析队列查询 StudySession，不是 Inbox 实体，也不是内部执行任务队列。
- 一次会话拥有一份 Analysis 工作文档；当前文档由 AnalysisRevision manifest 指向小节版本。被引用版本不可覆盖。
- AgentRun、用户可见 AnalysisMessage、AgentToolCall 和工具副作用记录分开；工具写入由统一执行器做版本检查和 (agent_run_id, call_id, input_hash) 幂等。
- 提取只接受固定、完整的 AnalysisRevision。ExtractionRun 固定输入版本，ExtractionSection 承担本次 kind/Span 映射；不得把旧小节映射套到新正文。
- SessionConfirmation 按本次 run 的每个不同 Occurrence 记录用户决定。KP 的全局意愿、会话完成、ReviewItem 排程是三个不同维度；UI 按 KP 折叠展示不改变 Occurrence 确认粒度。
- KnownEvidence 只面向 Lexeme；查词、阅读、播放、Annotation、SRS 评分不自动写 KE。用户 known/unknown/clear、来源撤回和投影失效必须走明确写路径。
- ReviewItem 仅在用户明确加入 Occurrence 时创建；status 为 queued/active/paused/retired，按数据模型 §7 与 ADR-041 表达——queued 无 ReviewState 且 admitted_at 为空，active 必须已有 admitted_at 与 ReviewState，retired_at 只表达真正退役；reference 是暂停（paused），不是退役，也不激活 queued 项。
- **模型调用不得在数据库事务内执行。** Provider I/O 在事务外；每次持久写入是短事务，携带 expected_revision 或等价版本检查。冲突必须返回给 Agent 刷新，不能长事务锁住 SQLite。
- 多个会话的生成可以并行排队，但写入争用必须有明确边界：SQLite busy 重试有上限且可取消，持久写入按短事务串行化或有界重试，不依靠内存 asyncio 任务维持业务状态。

### 1.4 本地持久任务队列

StudySession 的 preparation、普通多选分别排队和崩溃恢复需要持久任务记录。该队列是内部执行机制，不是产品 Inbox：

- 记录任务类型、目标 session/agent run、queued/running/succeeded/failed/cancelled 状态、尝试次数、错误摘要、checkpoint 和版本；
- bounded concurrency 由配置控制；重启时孤儿 running 任务变为可恢复的 failed/retryable 状态，不能重复提交同一个 revision 或工具副作用；
- 取消只阻止未提交工作，已提交的用户事实和文档编辑保留；搁置前必须完成或明确取消在途写入；
- 队列状态、恢复进度、取消和失败原因都能被 API 查询，不能仅存在前端 timer 或内存队列。

### 1.5 证据与查询性能的接入点

以下是 [ADR-040](adr/040-evidence-and-query-projections.md) 和 [数据模型 §§2、10–11](data-model.md#22-knownevidence-与用户裁定) 的阶段约束，不是可选的后期缓存工作：

| 接入时点 | 同步交付 |
|---|---|
| P1 内容索引／重分词 | 不可变 sidecar 身份、MaterialLexemeCount 的正反向稀疏索引、完整版本发布和重建边界 |
| P2 词汇判断／查词 | KE、词形／Lexeme 作用域裁定、撤回、按词摘要、写后读一致；查词不产生 KE |
| 已知词表独立切片 | KnownImportRun/Entry、原始输入复用、规则版本幂等消解、未消解反馈、暂存／原子发布／批量撤回 |
| P3 Agent 上下文 | 只批量读取当前句相关 Lexeme 的索引和有界摘要，区分讲解、人工裁定、导入支持和 SRS 估计，不自动写判断 |
| P5 SRS／聚合 | ReviewEvent 资格、ReviewLexemeEligibility、带 as_of 的相关卡片估计；与显式证据覆盖分开 |
| 每条写路径 | 同事务失效记录、版本检查、暂停／崩溃恢复和幂等重试；重建期间不显示假零或混合代次 |

实验 11 拆为两个门：P2 结束时做结构性验证，及 P5 结束时做真实规模端到端验证。前者提前证伪查询形状，后者才测预算、批大小和最终缓存策略；未完成对应实测时不宣称性能达标。

### 1.6 Prompt、备份、导出与迁移纪律

- prompt 是版本化产物，新增 analysis_v1.md、extraction_v1.md 等文件，禁止原地改写既有版本。
- schema 迁移从当前旧库前滚；不得用删除重建、清空历史或“把旧字段当新状态”规避迁移债。
- 每次迁移前自动生成带 schema/应用版本和时间戳的数据库备份，并在回归样本上验证备份可打开；迁移失败保留备份和诊断。
- P1/P2 提供用户可触发的全库快照导出：包含数据库文件或等价逻辑快照、契约/schema 版本、sidecar/资源清单和导出时间；恢复验证在隔离数据库执行，不把导出与 Anki 外部发送混为一谈。
- 自动处理不得覆盖用户决定；解析版本、提取结果、Occurrence、KnownEvidence 和 ReviewEvent 的历史引用必须保留。
- 阶段任务包是交接材料，不是契约来源。任务包必须先同步本文和核心契约，才可派发；当前任务包的观察结果见 §6。

## 2. 现状基线与重新排期

### 2.1 已核对的代码现状

| 范围 | 当前事实 | 按本计划的判断 |
|---|---|---|
| 后端素材链 | txt/srt/vtt/epub ingest、NFC/LF、code point 分句、Sudachi A mode、sidecar、Lexeme 幂等，以及 materials/sentences/sidecar API 已存在 | 旧 P0/P1 的实现切片可复用；当前 P1 的内容索引、版本发布、备份导出和 OpenAPI fixture 仍欠交付 |
| 后端 schema | P0-backend 已派发一轮：前滚迁移清理旧表与旧状态字段、迁移前备份/恢复、OpenAPI/fixture 生成与不变量测试入口已存在；但仍按 ADR-041 前语义实现，ReviewItem 为 active/paused/retired 三态、缺 queued 与 admitted_at，枚举与 CHECK 约束需调整；缺当前会话、文档 manifest、AgentRun、ExtractionSection 和 ReviewEvent 等阶段实体 | P0-backend 需按 ADR-041 以返工包补齐 queued/admitted_at 状态与约束并重跑验收后方视为完成；新实体 DDL 仍随实际使用它的阶段落地 |
| 前端 | Vite/React/TS/Tailwind、素材和句子浏览及 code point 规则存在；MaterialWorkspace 还内嵌旧 AnalysisPanel，analysis.ts 调用后端不存在的分析／追问／抽取／retention 端点 | 前端基础可保留；旧 AI 原型不得作为新 Study 资产或完成证据，应删除／隔离 |
| P2 | 没有算法解析、Yomitan importer、Annotation 或词汇判断入口 | 未开始 |
| P3 | 没有 provider、版本化 analysis prompt、StudySession、持久生成队列或 Agent 执行器 | 未开始 |
| P4 | 没有固定 revision 提取、ExtractionSection、KP/Occurrence 写入和 SessionConfirmation | 未开始；拆为 P4a/P4b，实验 2 在中间运行 |
| P5 | 没有 ReviewEvent、FSRS、资格摘要、独立聚合查询或 Anki 导出 | 未开始；实验 11 的规模验证在本阶段末 |

### 2.2 当前执行顺序

旧代码的“P0→P1”标签不能作为新的依赖图。当前执行顺序是：

P0 契约迁移与基线修复 → P1 内容索引、素材浏览与快照导出 → P2 算法阅读器、词典与 Lexeme 证据入口 → P3a StudySession、持久队列、初始生成与只读 Study → P3b Agent 编辑与上下文执行器 → P4a 提取骨架、Lexical/Opaque 产物与种子库 → 实验 2 → P4b Pattern 严格校验与本次确认 → P5 SRS、ReviewEvent、知识聚合、复习与 Anki 导出。

P2 结束时运行实验 11a；P5 结束时运行实验 11b。已知词表导入是独立切片，可在 P2 之后并行，但不得阻塞阅读和词汇判断，也不得与 Yomitan 释义导入混为一谈。条件式的 GiNZA/依存分析不属于本计划；若进入 MVP，另排独立切片，不改变 P1–P5 依赖图。

## 3. 阶段定义与验收边界

每个阶段以“可运行 + 可验收 + 能交给下一阶段的 Public contract”为完成条件。新实体的 DDL 跟随首次真实使用它的阶段；旧任务包中的冲突条目不具有效力。

### P0　契约迁移与基线修复

**目标：** 拆除旧实现的契约负债，建立安全前滚、备份、OpenAPI/fixture 和不变量验证基线；不提前创建尚未有真实使用场景的新领域表。

**必须完成：**

1. 停止旧 Analysis 上 session_closed、turn_count、extraction_status、extraction_trigger 等第二份状态机参与新的领域读写；为已有历史保留兼容读取/迁移说明，能安全移除的旧字段通过前滚迁移处理，不能无损映射的内容报告而不猜测。
2. 修复当前既有表的约束：ReviewItem 的 status 枚举（queued/active/paused/retired）与 admitted_at/retired_at 语义按数据模型 §7 和 ADR-041 在现有表和迁移工具中建立——queued 无 ReviewState 且 admitted_at 为空，active 必须已有 admitted_at 与 ReviewState，retired 等价 retired_at 非空，reference 走 paused；P0 不创建 ReviewItem 行、不实现配额或排程。ExtractionRun.analysis_revision_id 作为兼容迁移字段保留，最终外键约束在 AnalysisRevision 随 P3a/P4a 落地时完成，不用 P0 创建空的 AnalysisRevision 表。
3. 建立迁移开发规范、迁移前自动备份、旧库回归样本、隔离恢复检查和失败诊断；空库及当前旧库均以前滚方式验证。
4. 统一 Pydantic/API 模型与 OpenAPI 生成入口，提供前端可锁定的素材 fixture。不存在的分析端点不能继续被前端原型调用。
5. 移除或隔离 analysis.ts、内嵌旧 AnalysisPanel 及其不存在端点调用；不把它改名后当作新 Study 实现。保留素材浏览的独立组件和 shell 边界。
6. 将 data-model §9 当前 1–25 条不变量映射到测试入口，重写旧 xfail 的语义；不把旧数量或“表存在”当作语义完成证明。

**验收：** 迁移前备份可打开且包含版本标记；空库和旧库升级成功；新 API 不再暴露旧第二状态机作为权威；ReviewItem 新 status 语义约束测试通过（含 queued 无 ReviewState、active 必须已有 admitted_at 与 ReviewState、retired 等价 retired_at 非空、reference 走 paused）；OpenAPI/fixture 生成可复现；前端 lint/build/test 通过且不请求不存在的 AI 端点；未实现不变量明确标为待点亮。P0 不验收未来空表的 introspect。

**Public contract：** 前滚迁移规范、备份/恢复检查、OpenAPI 生成命令、素材 fixture、旧状态兼容策略、当前不变量测试入口。

**不在 P0：** 不创建 StudySession、AnalysisRevision、AgentRun、ExtractionSection 或 ReviewEvent 等新领域表；不创建 ReviewItem 行、不实现配额/FSRS 排程或视觉页面，也不实现 LLM、Yomitan、算法词典或提取。

### P1　素材导入、Sidecar、内容索引与快照导出

**目标：** 在保留现有 ingest 主链的基础上，完成当前素材数据模型、不可变 sidecar 身份、材料词频查询底座和用户可恢复的快照导出。

**必须完成：**

- txt/srt/vtt/epub 的规范化、分句、定位、时间戳、EPUB spine 锚点、Sudachi A mode 和 Lexeme 确定性继续由同一素材无关链路处理；PDF 只走纯文本降级。
- Material/Sidecar 补齐 storage_mode、source_sha256、current_sidecar_id 等当前契约需要的版本和资源边界；重分词不得覆盖被引用 sidecar。
- 建立 MaterialLexemeCount 正向／反向稀疏索引。新 sidecar 的完整词频和索引通过校验后与 current 指针同次发布；导入、重建、取消、崩溃恢复和代次切换可观察且幂等。
- 提供 materials、sentences、sidecar 和 fixture 的 OpenAPI 类型；素材列表、句子列表、加载／空／错误状态保持可用，未配置 BYOK 不影响浏览。
- 提供全库快照导出和隔离恢复检查。导出包含 schema/契约版本、资源与 sidecar 清单及时间戳；不承诺已实现 Anki 外部发送。
- 前端只做 Library/reader 的素材浏览和定位准备，不实现 AI 学习、候选、复习或假造阅读活动统计。

**验收：** 现有 txt/srt/vtt/epub、幂等、Unicode code point、素材类型无关性测试继续通过；材料词频与全量重建一致；查询响应携带 sidecar_generation_id，且同一响应内所有词频数据 generation 相同；重建期间旧代次持续可读，指针原子切换后才读新代次；fixture 能端到端还原 txt/srt 句子列表；导出可在隔离库恢复；组件无 shell 反向依赖。

**Public contract：** Material/Sentence/Sidecar API、不可变 sidecar 版本、sidecar_generation_id、材料词频索引查询、素材浏览 fixture、快照导出/恢复格式。

### P2　算法阅读器、Yomitan 与 Lexeme 证据入口

**目标：** 交付不依赖 BYOK 的算法阅读能力，并把“认识／不认识”落实为独立的 Lexeme 证据写路径。

**必须完成：**

- GET /sentences/{id}/analysis/algorithmic 或等价当前 API：token 表层、规范化形、POS、reading、code point 区间、sidecar/analyzer 版本和词典来源/version provenance。
- Yomitan ZIP 安全导入、archive hash 幂等、canonical dictionary model、精确查找/FTS5、结构化定义降级；词典导入不创建 KP。
- Annotation 独立保存 Span，支持跨句有序范围、筛选和跳回原文；查词、Annotation、阅读和播放不创建 KP、ReviewItem 或 KE。
- 提供 Lexeme 级和词形级 known/unknown/clear 当前裁定、user_asserted KE、来源撤回、写后读一致和投影失效；unknown 的优先级、clear 不复活旧断言等按 ADR-040 执行。
- 前端阅读器按 DESIGN 支持 token 点击/键盘查词、来源区分、无词典/无结果/错误/响应式状态；没有 BYOK 时算法区仍可用。

**测试边界：** P2 的“unknown 压过导入与 SRS”用测试夹具直接构造合成的 import/SRS 事实，验证裁定优先级；不因此提前实现 KnownImportRun 或 ReviewEvent 生产者。实际已知词表导入是独立切片，实际 SRS 资格在 P5 再做端到端验证。

**独立切片：** Anki/jpdb 已知词表导入可在本阶段后并行实现 KnownImportRun/Entry。它必须有版本化幂等消解、未发布暂存、未消解报告和撤回边界；普通牌组不得自动视为已知词表。

**验收：** token 与 Sudachi A mode 逐 token 对拍；词典来源和版本可见；ZIP 安全/幂等通过；Annotation/查词不产生 KP 或 KE；误点撤回、合成来源下的 unknown 优先级、clear 不复活旧人工 KE、词形/Lexeme 作用域和增量摘要测试通过；reader fixture 不依赖 provider。P2 末尾完成实验 11a：查询计划无全扫描、目标集合批量读取、代次可见性和增量/全量一致性通过，但不把 11a 当最终性能预算。

**Public contract：** algorithmic response、dictionary provenance、Annotation API、Lexeme evidence/decision API、按词摘要查询、sidecar generation 约束及 reader fixtures。

### P3a　StudySession、持久队列、初始生成与只读 Study

**目标：** 先交付真正可运行的学习会话和 AI 解析价值；对话区先支持只读问答，工具编辑不与初始生成绑在同一全有或全无交付中。

**必须完成：**

- 落地 StudySession、source sentence 关联、phase/status、return_position 和当前运行指针。创建即 active + preparation，可从素材卡、阅读器和全局队列打开；支持 parked 与学习记录查询。
- 落地内部持久任务队列：queued/running/failed/cancelled/succeeded、bounded concurrency、checkpoint、busy 重试、取消和重启孤儿恢复。普通多选创建多个 interactive 单句会话，分别排队；automatic 只能显式选择，不能由多选或默认值推断。
- 落地 provider profile/密钥边界、provider 能力检测和只读降级；没有 BYOK 时 reader/P1/P2 仍可用，Study 明确不可用或失败，不伪装为已生成。
- 落地版本化 analysis_v1.md、初始完整解析、三级 section 切分和降级。初始提交形成首个 AnalysisRevision 与 manifest；流式草稿不可提取。
- Study 主区渲染当前文档，右侧对话支持只读问答；AnalysisMessage 保存用户原始消息和可见回复，不把自动注入的文档正文写回用户消息。导航、切换句子、返回素材或关闭应用不结束讨论、不自动提取。
- 新实体只落地实际需要的最小字段；P3b 使用工具循环后再以迁移扩展 AgentRun/AnalysisMessage 运行审计字段，不把未经使用的未来形状当作 P0 基线。

**搁置验收：** 运行中的生成/问答写入必须先完成或明确取消，之后才能 parked；parked 从默认 active 队列消失但可从学习记录恢复到保存阶段。重启后任务状态可解释，不能留下隐藏后台写入。

**机器验收：** fake provider 证明模型调用发生在数据库事务外；同一任务重试不重复提交同一首稿；队列重启将孤儿 running 变为可恢复状态；查询响应返回真实 session phase/status、任务进度和 generation，而不是前端 timer 推导。

**不在 P3a：** 文档编辑工具、笔记写工具、ExtractionRun 产物、KP/Occurrence、SessionConfirmation、ReviewItem。

**Public contract：** StudySession 生命周期和查询、持久任务队列状态/恢复 API、首个 AnalysisRevision、只读问答 API、解析队列/记录 fixture、Study shell props。

### P3b　Agent 编辑、工具执行器与上下文控制

**目标：** 在 P3a 的真实 provider 和持久会话上增加可验证的文档编辑、笔记工具和多轮上下文，而不复制业务写入路径。

**必须完成：**

- AgentRun、AgentToolCall 和必要运行审计字段随真实工具循环落地；工具以 (agent_run_id, call_id, input_hash) 幂等，结果与副作用记录分离。
- 文档工具支持添加、替换、删除、移动／合并小节；每次有效编辑新增 AnalysisRevision 和变化的小节版本，携带 expected_revision，过期写入拒绝覆盖。
- 作品笔记／画像工具沿用同一写入闸门，强制作用域、槽位、长度、版本和可见反馈；失败不能在回复中描述成成功。
- 每轮上下文组装当前文档一次、必要的有界历史、学习上下文和用户原始消息；工具调用与结果成对裁切。当前文档块在运行注入记录中恰好出现一次，历史消息不含重复文档正文。
- Provider 不支持可靠工具时明确只读降级；不维持第二套 provider 专属业务写入路径。预算耗尽暂停并保留现场，不自动提取。

**机器验收：** fake provider 在事务外运行；一次成功工具调用重试不产生第二次 revision/笔记副作用；同 call 不同 input_hash 报协议冲突；并发编辑用 expected_revision 产生可见冲突；注入记录中当前文档出现次数为 1，持久化用户消息不含自动文档块；部分工具成功和失败均可见。

**不在 P3b：** 固定 revision 提取、KP/Occurrence、SessionConfirmation、ReviewItem。P3 不再保留“一次追问”或“只允许 add”作为产品限制。

**Public contract：** 多轮 AgentRun/Message/Tool API、AnalysisRevision 编辑语义、笔记工具边界、上下文组装与预算状态、冲突/部分失败 fixture。

### P4a　提取骨架、Lexical/Opaque 产物与种子库

**开工条件：** P3a 已提供可提交的 AnalysisRevision；P4a 不等待实验 2，且不把 pattern DSL 当作冻结契约。

**目标：** 先让固定版本提取、Span 定位和可运行的 lexical/opaque 路径真实存在，使实验 2 有可观察的运行基础。

**必须完成：**

- 落地 AnalysisRevision 到 ExtractionRun 的最终外键和固定输入版本；落地 ExtractionSection 及其有序 Span 关联。提取输入含原句、sidecar、完整 revision、section_id/revision 和当前临时形态规范。
- 支持 standalone 与 continued_turn 两条路径，使用同一 extraction_v1 输入契约；continued_turn 只是快路径，不能成为唯一能力。
- 后端执行 find_all 和 token 对齐，分类 0/1/>1 与 aligned/partial/ambiguous/unaligned；部分 surface/模式失败可记录，不能由模型提供偏移。
- 只允许 lexical 和 opaque 两种产物进入 KP/Occurrence 写入。模型输出的 pattern-like payload 进入记录和离线诊断，不通过 pattern 严格校验器，也不以 pattern shape 建 KP；离线临时检查认为会失败的项记录 validation_failed，并降级为 opaque。
- KP anchor 幂等 upsert；Occurrence 每个有效完整出现追加，引用 section_id + section_revision 和具体 run；同一 run 重试不复制，新的成功 run 不覆盖旧引用。
- 建立实验 2 所需的 seed 候选库导入：使用版本化、带 hash 的离线 JLPT/种子 fixture 写入 Alias，source=seed；保留数据集版本与来源，不把普通词表或词典释义当作 seed。

**验收：** 固定 revision 不会随当前文档指针变化；重复 surface 的 ambiguous Span、无法对齐仍保留的 Span、部分 unresolved 和 lexical/opaque 写入通过；删除 Occurrence 后重跑不改 AnalysisRevision 正文；Alias seed 可按版本重建；实验样本能同时跑 standalone/continued_turn。P4a 不验收 pattern 槽位完整性、pattern anchor 序列化或严格枚举。

**Public contract：** ExtractionRun/ExtractionSection、standalone/continued extraction API、lexical/opaque KP/Occurrence、Span 分类、Alias seed fixture 和离线 pattern 诊断记录。

### 实验 2　模式语言可校验性与身份稳定性

**运行位置：** P4a 之后、P4b 之前。实验使用 P4a 的真实 extraction runner、P3a 的 AnalysisRevision 和 Alias seed 库；不再形成 P4 ← 实验 2 ← P4 的循环。

**方法与交付：**

- 在 JLPT seed 与前 20 句建立候选库，在剩余 30–80 句比较 standalone/continued_turn；模型可输出临时结构化 pattern，但 P4a 只记录候选和离线诊断，不能因临时规则拒绝整次提取。
- 统计字面量顺序、槽位定位、POS/category 相容、可校验 form、零槽位 lint、model_chosen/validation_failed、键碰撞、复用、完整 surface 与槽位范围关系，以及无关历史与重复命中的影响。
- 交付 grammar_enums_v1.yaml、validation_strictness_v1.json、grammar_decision_table_v0.md 和带模型/prompt/DSL/分析器词典/AnalysisRevision/seed 版本的实验报告。
- “实验 2 完成”意味着数据、复现方法和决策记录齐全；只有在结果被接受后，P4b 才能开放 pattern shape 和严格校验。实验失败也必须产出“不开放哪些规则”的结论，而不是静默放宽门槛。

### P4b　Pattern 严格校验、身份消解与本次确认

**开工条件：** 实验 2 的报告和三个版本化交付物已登记；未完成时只能继续 P4a 的 lexical/opaque 路径。

**目标：** 在实证结果约束下开放 pattern shape，并完成固定 revision 提取、KP/Occurrence 和 SessionConfirmation 的用户闭环。

**必须完成：**

- pattern 只能使用实验接受的 category/form、序列化和严格度版本；anchor 等于按 pattern_grammar_version 序列化的 payload。身份召回使用有界 top-k，近邻才触发额外消解调用。
- 完整 surface 与 slot surface 分开定位；槽位完整、有序且跨槽位不相交，完整 Span 可以包含槽位 Span。任一槽位无法唯一绑定时该次 pattern 出现降级/拒绝并记录 unresolved_patterns，其余完整命中仍可提交。
- 提取失败按当前 prompt contract 区分 schema/整体失败和部分候选失败；整体失败最多追加两次同 revision 重试，不重新生成 Analysis；成功候选与诊断在原子边界内提交。
- interactive 会话由用户明确结束讨论后固定 revision；automatic 只能来自显式创建，跳过 discussion 但仍生成、固定、提取和确认。提取期间禁用讨论写入，导航/关窗不触发提取。
- SessionConfirmation 按当前 run 的每个不同 Occurrence 记录局部 retention（inherit/srs/reference）与当次有效意愿快照，决定来源为 user 或继承已有明确用户决定的 KP 意愿（inherited）；default/inherit 初值不是用户决定，reference 也是有效确认而不是排除候选。UI 可按 KP 折叠展示，不改变 Occurrence 确认粒度；KP 的全局修改是独立的明确操作。允许部分确认、稍后继续、沿用已有用户决定；零候选需用户明确完成。
- 当次有效值为 srs 的明确加入与 ReviewItem 的创建／复用同一事务提交，status = queued；不消耗每日配额、不创建 ReviewState、不执行 FSRS 排程。有效值为 reference 的确认对应 ReviewItem 进入 paused；无 ReviewItem 的 Occurrence 不因未来 KP 改为 srs 自动建卡。确认记录本身就是会话内审计事实（data-model §4.2），不重复写通用操作日志。完成会话不等待 P5 配额。

**机器验收：** analysis_revision_id 与每个 ExtractionSection 属于同一 session/analysis；同一 run 提交幂等；重试保持 revision 不变；slot_bindings 的值均在 Occurrence.spans 中；用户确认写后立即可读且重跑不覆盖；同一 Occurrence 从材料或全局视图确认后退出所有待确认查询，会话完成按当前 run 的所有不同 Occurrence 判断；确认、局部意愿与 ReviewItem 创建（queued）同一事务提交，不存在“已加入但尚未建卡”的中间状态；会话完成不依赖全局 retention、不等待配额。P4b 点亮不变量 1、2、6、8–17、19–20，并完成不变量 18 的“明确 Occurrence 加入决定 + 原子建卡”部分（配额首次准入与暂停恢复不重复消耗由 P5 完成）。

**Public contract：** pattern extraction API、grammar/strictness 版本、ExtractionSection/Span/KP/Occurrence、SessionConfirmation、ReviewItem queued 创建绑定、提取/确认状态查询和 Study 候选 fixture。

### P5　SRS、复习、知识聚合与互操作

**目标：** 在用户确认之后实现受配额控制的复习状态、追加复习事实、来源可解释的聚合和显式 Anki 导出。

**必须完成：**

- 只有用户明确加入的 Occurrence 才创建 ReviewItem，创建即 queued；默认值或 KP 默认策略不授权建卡。已有卡在 reference 时暂停（paused），改回 srs 仅恢复既有非退役项：admitted_at 非空的恢复原 ReviewState 与进度、不重复消耗新卡配额，admitted_at 为空的回到 queued 仍须首次配额；没有 ReviewItem 的历史 Occurrence 不因 KP 改为 srs 自动补建。
- ReviewItem 实现 queued/active/paused/retired 与 admitted_at/retired_at 等价约束；queued 无 ReviewState，active 必须已有 admitted_at 与 ReviewState，retired 等价 retired_at 非空；ReviewState 保存当前 FSRS 投影，ReviewEvent 追加保存当时 Occurrence、评分、算法/参数和幂等键。
- 配额按 salience 优先、同级 FIFO，只决定 queued 首次进入 active（写入 admitted_at 并初始化 ReviewState），不决定 ReviewItem 行是否创建；准入前再次核对最新有效意愿，reference 不得因旧队列状态激活 queued。Study、知识库和复习入口区分“用户选择 srs”“等待排程（queued）”“已加入复习”。会话完成不等待配额。
- ReviewLexemeEligibility 和带 as_of 的相关卡片估计只使用合格的实际复习 Occurrence 及完整累计历史；不创建 srs_matured KE，不把 SRS 估计并入证据覆盖。
- 知识库/材料聚合分别返回 KP、Occurrence“被讲解次数”、当前 sidecar“材料出现次数”、证据覆盖率和 SRS 估计；不同口径带来源，API、UI、导出均不得相加或互相校验。
- Anki 导出只从用户明确选择的 ReviewItem/Occurrence 生成，字段映射和外部发送确认独立；音频等资源缺失不阻止导出。
- 在 P5 末尾完成实验 11b：使用 10⁴/10⁵/10⁶ 级证据与评分历史、约 10⁵ token 材料和并行导入/重建/评分场景，验证查询计划、无关历史增长、写事务、代次切换、dirty 恢复、动态 as_of 缓存和最终聚合物化取舍。

**验收：** reference 无有效 active 卡但保留 paused 卡、ReviewState 和 ReviewEvent，且不激活 queued 项；queued 卡不被误认为 active、没有 ReviewState，配额不足时 ReviewItem 行仍然存在；暂停恢复不重置进度；KP 改为 srs 只能恢复既有 ReviewItem，无 ReviewItem 的 Occurrence 不批量补建；ReviewEvent 不能跨 KP/Occurrence 传播不合格 SRS 信号；聚合的两个计数独立且标明来源；重建不显示假零；Anki 缺媒体仍生成可用卡，导出快照固定 review_item_id、occurrence_id、字段映射、解析小节版本、媒体引用及导出/外部发送时间与结果；P5 相关不变量 3、4、18、23–25 点亮；实验 11b 报告明确参考硬件、预算、批大小、缓存有效期和剩余风险。

**Public contract：** ReviewItem/State/Event、配额、eligibility、知识聚合、证据覆盖查询、复习 shell、Anki 导出格式和确认边界。

## 4. 可机检的关键观察点

散文验收必须至少落成以下观察点；其余产品要求可继续保留为场景描述：

| 约束 | 最小可机检断言 |
|---|---|
| sidecar 代次 | 查询响应携带 sidecar_generation_id；同一响应所有词频项值相同；重建期间旧代次可读，指针原子切换后才出现新代次 |
| 会话队列 | 重启后 running 任务进入可恢复状态；同一任务重试不复制 revision 或副作用；parked 不出现在 active 队列但可恢复 |
| 事务边界 | fake provider 在事务外调用；数据库只在短写事务中提交结果；busy 重试有上限且可取消 |
| 文档上下文 | 运行注入记录中当前文档块出现次数为 1；AnalysisMessage 的用户原始消息不含自动拼接文档正文 |
| revision 冲突 | 过期 expected_revision 写入必定拒绝；并发编辑不能覆盖已提交 revision |
| 固定提取 | ExtractionRun 的 analysis_revision_id 不随当前指针变化；retry_of 使用同一 revision；旧正文和旧 Span 引用不被覆盖 |
| 确认边界 | SessionConfirmation 必须属于当前成功 run 的 Occurrence；default/inherit 不生成用户决定；用户写后读立即可见；会话完成按当前 run 的所有不同 Occurrence 判断 |
| 审计最小集 | 会话内加入动作仅由 SessionConfirmation 记录，不重复写通用操作日志；知识库直接修改 Occurrence retention 时才追加紧凑的 OccurrenceRetentionDecision；相同值的重复写入不产生事件；不保存逐次 UI 操作、完整页面状态或重复内容 |
| 统计口径 | “被讲解次数”“材料出现次数”“证据覆盖”“SRS 估计”由独立字段返回，静态检查和测试确认不存在相加/互校验路径 |

## 5. 阶段间的验证与交接纪律

1. 每阶段先锁定当前契约对应的不变量测试，再改实现；旧 xfail 不能机械沿用，不能通过改测试绕过行为。
2. 每阶段必须输出 Public contract、fixture、启动命令、迁移 revision、已验证命令、备份/恢复检查和已知缺口。下一阶段只依赖上一阶段报告明确列出的内容。
3. 模型 I/O 永远在事务外；所有写入路径都验证原子性、版本冲突、幂等和崩溃恢复。取消只停止未提交工作，不撤销已经提交的用户事实。
4. 文档 revision、ExtractionRun、Occurrence、SessionConfirmation、KnownEvidence、ReviewEvent 的历史引用不得被自动清理或覆盖；当前状态允许更新但不能破坏引用完整性。
5. 前端组件必须 shell-independent；Study、Reader、Knowledge、Review 由 shell 装配同一批组件，不在路由中复制状态机。
6. 条件式 GiNZA/依存分析若被纳入，必须作为独立切片重新评估，不得塞入 P2 或改变既有依赖图。
7. 任何 spec/实现冲突先停受影响部分并报告；不得修改 docs 或 prompt 来迁就代码。阶段计划中本文是获授权校准的阶段文档；任务包目录已按 ADR-041 同步（2026-09-10），实现任务仍不得修改 docs、prompt 或 DESIGN。

## 6. 任务包同步前的明确结论

docs/task-packets/ 当前仍是旧交接协议，不能直接派发：

| 任务包范围 | 观察到的旧假设 | 同步方向 |
|---|---|---|
| P0 | 把旧表形和“全部实体首日建表”当作当前完成标准 | 收缩为既有表拆债、前滚迁移规范、自动备份、OpenAPI/fixture 和不变量入口；新实体 DDL 随 owning phase 落地 |
| P1 | ingest 主链基本对应现状，但没有当前内容索引、发布屏障、快照导出和 fixture 生成机制 | 保留已通过的素材链，补 MaterialLexemeCount、代次、备份/导出、OpenAPI 和前端旧 AI 原型隔离 |
| P2 | 算法／Yomitan 方向大体可用，但缺 ADR-040 的 KE/裁定/撤回与查询边界 | 补证据入口、Annotation、按词摘要、合成来源优先级测试和 P2 结构性实验 11 |
| P3 | 仍以 Analysis 状态、一次追问和 add 为中心 | 拆为 P3a 的会话/队列/生成/只读 Study 与 P3b 的可编辑 Agent/工具执行器 |
| P4 | 仍含旧 batch/background、section_hint、默认自动建卡和旧收件箱语义 | 拆为 P4a 提取骨架 + lexical/opaque + seed，实验 2 后再做 P4b pattern 严格校验与 SessionConfirmation |
| P5 | 仍以 retired_at 表达 reference，并沿用旧批量排程口径 | 重写为 paused/retired 分离、ReviewEvent/资格摘要、证据与 SRS 分列、Anki 确认和 P5 规模实验 11 |

在这些包完成同步、各包的读取范围链接到当前 ADR 单篇文件后，才可按本计划重新派工。P0-backend 已在本次同步前完成一轮实现且为旧语义，同步后以返工/校准包执行，不重复派发全新 P0-backend；P4b/P5 在同步完成前不得派发。本文不把任务包的旧验收文字当作阶段完成证明。
