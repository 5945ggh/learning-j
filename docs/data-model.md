# LearningJ 数据模型契约

> 面向实现（含委托给 coding agent 的场景）。本文规定**是什么**；**为什么**在 `adr.md`。二者冲突时及时报告。
> 标注 **[不可推迟]** 的字段与约束，若在第一版遗漏，后补的代价是全量数据迁移或历史数据重算。
> 本文规定当前目标契约，不表示对应实现或阶段验收已完成。2026-09-08 的学习会话、Agent 与历史保护迁移已反映在当前契约和阶段计划中。
> 2026-09-09 补充证据纠错、导入、受控 SRS 信号与查询性能契约，见 [ADR-040](adr/040-evidence-and-query-projections.md)；不表示实现已完成。
> 未决事项只在 [产品规划 §15](LearningJ-plan-v5.md#15-未决事项) 维护。

---

## 0. 全局约定

- 所有实体带 `id`（UUIDv7 或等价的单调递增 ID）、`created_at`、`updated_at`。下文不再重复列出。
- 所有时间为 UTC 时间戳。
- **文本规范化**：进入 `Material` / `Sentence` 的文本统一采用 Unicode NFC；换行统一为 LF；不做全角／半角折叠、不删除原文空白。`Sentence.text` 是模型输入、`surface` 定位和前端展示共用的规范文本。`content_hash` 对规范化后的素材文本计算。
- **字符偏移**：所有持久化 `char_start` / `char_end` 均以 Unicode code point 计，使用半开区间 `[start, end)`。浏览器 DOM 的 UTF-16 偏移只能在渲染适配层转换，业务代码不得直接把持久化偏移交给 `String.slice` 或 `Range`。
- **分级历史保护**：已被提取、Occurrence 或复习引用的解析版本与来源不得覆盖；KnownEvidence、Occurrence、完成的抽取结果与复习事件追加保存。工作流状态、当前文档指针、KP 当前意愿、笔记、批注与 SRS 当前状态允许更新。自动处理不得覆盖用户决定；这不限制用户主动修改自己的决定。详见 §0.1。
- **修改的提交边界**：文档编辑、提取结果提交、知识点确认分别具有原子提交边界。客户端和工具修改携带预期版本；过期写入必须报告冲突，不得覆盖并发修改。参与并发更新的会话、KP、笔记、批注和排程投影使用单调 version 或等价的原子比较机制；文档使用 current_revision_id。
- 版本戳（形态分析器版本、分析器词典版本、释义词典来源版本、prompt 版本、模型标识）在任何涉及外部资源的记录上都是必填项，不允许留空或用默认值。`analyzer_dict_version`（SudachiDict）与 `dictionary_source_version`（Yomitan 包等）属于不同命名空间，不得复用同一个 `dict_version` 含义。
- **anchor_key 序列化规范**：采用 Unicode NFC 归一化，连续空格折叠为单个空格，去除前后空白。序列化只取 `category + form + literal 文本 + 顺序`，不取槽位 id。当前模式版本为 `0.1`；序列化规则随 `pattern_grammar_version` 的大版本管理，枚举集合随小版本管理。
- **MVP 作用域是单用户、本地数据集**：当前实体不要求 `user_id`；未来若支持本地多用户或托管后端，必须在作用域迁移设计中为用户学习意愿、KnownEvidence、ReviewItem、ReviewState 与笔记补充用户边界。

### 0.1 历史与当前状态

| 数据 | 写入与保留策略 |
|---|---|
| 应用管理的原始资源 | 不修改原文件；派生文本和索引另存。外部资源发生变化时检测并提示 |
| 解析工作文档 | 流式未提交草稿可更新；一次有效编辑提交新的文档 revision，只新增变化的小节版本 |
| 被引用的文档／小节版本 | 内容和顺序不可覆盖、不可清理；提取固定引用整个文档版本，Occurrence 固定引用小节版本 |
| 无外部引用的草稿版本 | 可按撤销保留策略清理；不按流式 token 建历史版本 |
| KnownEvidence、LexemeKnowledgeDecision、KnownEvidenceRetraction、已发布导入结果、Occurrence 的提取内容与来源、已提交提取结果、ReviewEvent | 追加保存；纠错或重跑记录新的事实，不重写来源 |
| 会话阶段、任务状态、当前指针、访问时间 | 直接更新；无需为每次进度变化创建实体版本 |
| KP retention／canonical_id | 更新当前值，同时追加用户意愿／合并决策事件；抽取不可覆盖用户意愿 |
| Occurrence retention 与用户确认 | 会话内的局部选择由 `SessionConfirmation` 追加保存；知识库直接修改才追加紧凑的 `OccurrenceRetentionDecision`。两者与提取内容分离，不引入通用操作日志；局部值及所依赖 KP 策略使用版本检查，确认加入与建卡原子提交 |
| 笔记、画像、批注 | 可编辑和删除；Agent 修改记录操作结果，允许有限撤销历史，不要求永久保留每次正文 |
| ReviewState | 更新当前排程投影；复习事实保存在独立 ReviewEvent 中 |
| 证据摘要、SRS 传播资格、材料词频与覆盖率缓存 | 可增量更新、清理和重建；不是唯一事实，版本一致性与时间有效性见 §§2.5、11 |

“保留历史”约束正常编辑、合并、重跑和清理，不禁止用户明确删除个人数据。删除必须处理引用和影响范围，不能伪装成普通编辑。本次不设计通用事件溯源框架。

对话上下文裁切不等于删除学习记录；运行日志、provider 续接数据和调试输出按用途保留，不永久重复保存每轮注入的全文或原始响应。应用不要求访问或持久化模型隐藏推理。

---

## 1. Span（值对象）

**[不可推迟]** Span 被四方共用：`Occurrence`、`Annotation`、小节的 `ExtractionSection` 映射，以及将来的可疑句高亮（ADR-014）。它必须在第一天就定成一个独立、稳定的形状。

| 字段 | 类型 | 说明 |
|---|---|---|
| `sentence_id` | FK | 所属句子 |
| `surface` | string | **定位输入**。提取时由模型给出原文子串；Annotation 来自用户选区。二者使用同一规范文本 |
| `char_start` | int | 句内字符起始偏移，闭区间左端。**由后端定位得出** |
| `char_end` | int | 句内字符结束偏移，开区间右端。**由后端定位得出** |
| `alignment_sidecar_id` | FK? | **[不可推迟]** 本次 token 对齐使用的不可变 Sidecar；存在 token 区间时必填 |
| `token_start` | int? | sidecar 分词序列内的 token 索引，闭区间左端 |
| `token_end` | int? | 同上，开区间右端 |
| `alignment_status` | enum | `aligned` / `partial` / `ambiguous` / `unaligned` |

### 物理存储

Span 在逻辑上是值对象，在物理上使用独立的不可变 `spans` 表；每个 Span 有自己的 `span_id`。实体之间不使用多态 `owner_type / owner_id` 外键，而使用带真实外键的关联表：

- `occurrence_spans(occurrence_id, span_id, ordinal)`：有序数组，包含该次出现的完整匹配 Span 及需要的槽位 Span；`ordinal` 保证顺序，同一 `span_id` 不重复关联；
- `extraction_section_spans(extraction_section_id, span_id, ordinal)`：由特定抽取运行产生的小节映射，不修改小节正文版本；
- `annotation_spans(annotation_id, span_id, ordinal)`。

关联表上的 `ordinal` 保证数组顺序，`span_id` 只能指向一个 `sentence_id`。这样既能复用同一套 Span 约束，也不会牺牲数据库的引用完整性。文档中的 `Occurrence.spans`、`ExtractionSection.spans` 和 `Annotation.spans` 是上述物理关系的逻辑写法。

### 定位规则

模型**只给 `surface`，不给偏移**。后端在句子文本中执行 `find_all`：

| 命中数 | 处理 |
|---|---|
| 0 | 不产生 Span；将该 surface 记录到本次 `ExtractionRun.unresolved_surfaces`，供失败检测与重跑使用 |
| 1 | 产生一个 Span，按 token 边界对齐结果取 `aligned` 或 `partial` |
| >1 | 为**每一处命中各产生一个 Span**，全部标 `ambiguous` |

完整 surface 的重复命中保留为 ambiguous，不让模型猜偏移。模式槽位还需在各完整命中内部验证，无法唯一确定时拒绝该次模式出现；详见 prompt 契约 §5.2。
`ambiguous` 与 `partial` 是两回事：前者是「不知道指哪一处」，后者是「知道指哪里但边界不落在 token 上」。不得混用，否则统计读不出东西。

### 约束

1. 存储后，**字符区间是权威值**，下游一律使用它；token 区间是由 sidecar 对齐推导出的派生值。surface 已命中但 token 侧无法对齐时，保留字符区间，`alignment_status = unaligned`，**不得因 token 对齐失败而丢弃该 Span**。
2. **跨句 Span 不支持。**需要跨句时用有序的 Span 数组表达。
3. 对齐使用的 sidecar 必须与产生该 Span 时的 sidecar 是同一版本；重新分词后以新 Span／对齐版本记录重算结果，字符范围保持一致；不得原地覆盖已引用 Span 的旧 token 对齐来源。

---

## 2. Dictionary 与 Lexeme 层

### 2.0 Dictionary source and entries

词典释义与 Sudachi 形态身份分离。MVP 的用户导入格式是 Yomitan ZIP；Yomitan 只是交换格式，业务层使用下列 canonical 概念。未来的 JMdict XML、EPWING 或其他格式通过同一个 `DictionaryImporter` 适配器接入。

| 实体 | 最小职责 |
|---|---|
| `DictionarySource` | `source_id`、`format`、显示名、`source_version`、`schema_version`、archive hash、导入时间、许可元数据 |
| `DictionaryEntry` | source 外键、expression、reading、tags、score、sequence、definitions、source-local id |
| `DictionaryDefinition` | 纯文本投影 + 可选 structured content；保留原始 payload，不在导入时抹平富文本 |
| `DictionaryAsset` | source 外键、相对路径、mime、content hash、存储位置；资源缺失时定义仍可降级显示 |
| `DictionaryImportRun` | archive hash、开始/结束时间、状态、错误摘要、导入统计；重复导入同一 hash 必须幂等 |

一个 `Lexeme` 可命中多个 `DictionarySource`，查询结果必须带 source/version provenance。词典条目、词典义项、词频 metadata 与导入词表均不得自动创建 `KnowledgePoint`。

### 2.1 Lexeme

算法构成，全自动生成，数量级 \(10^4\)（单部作品）到 \(10^5\)（全库）。**它不是知识点。**

| 字段 | 类型 | 说明 |
|---|---|---|
| `lexeme_id` | string | **确定性派生**，非自签发。由 `normalized_form + pos + reading_form` 的规范化拼接或其哈希得到 |
| `normalized_form` | string | Sudachi 正規化形 |
| `pos` | string | 品詞（Sudachi POS tuple 的规范化串） |
| `reading_form` | string | 読み |
| `first_seen_analyzer_dict_version` | string | **[不可推迟]** 首次产生该记录时的 SudachiDict 版本 |

**约束**

1. **`analyzer_dict_version` 不参与 `lexeme_id` 的派生。**分析器词典版本记在 sidecar 与 KnownEvidence 上，而不是编进 id。理由：若编进 id，则每次 SudachiDict 升级会使全库 `lexeme_id` 变更，所有历史证据指向旧 id，词频与覆盖率查询从此永远要过映射层；而那张映射表实际只能靠「三元组相同即同一词」重建，等于自己造一道必须再拆掉的墙。三元组不变时 id 天然稳定，只有三元组实际漂移时才需要迁移映射，规模由实际变化决定。
2. **Lexeme 不参与 KnowledgePoint 的 ID 空间。**没有自签发主键，没有 `canonical_id`，不进别名表，不需要合并机制（ADR-005）。
3. 词典升级不是「合并」，而是**版本迁移映射**：仅对三元组实际发生漂移的条目维护带版本的新旧映射，查询时经映射层归并。只将可唯一核对的映射用于知识证据；拆分／合并或多义映射保留未消解状态，不自动把旧证据扩散给多个新词。
4. **[不可推迟]** 所有 Lexeme 相关记录与 sidecar 必须携带 `analyzer_dict_version`。`normalized_form` 会随 SudachiDict 更新漂移，不记版本则第一次升级词典就是全量脏数据。释义查询另外记录 `dictionary_source_id` 与 `dictionary_source_version`，二者不得混用。
5. **不得使用 Sudachi 内部 word id 作持久锚点**——它随词典构建变动。
6. 同形同音同词性的异义词无法由自然键区分。该碰撞只影响 Lexeme 层的统计口径，不影响 KnowledgePoint 的身份。

<a id="22-knownevidence"></a>

### 2.2 KnownEvidence 与用户裁定

**[不可推迟]** KE 保存面向 Lexeme 的、可解释的正向证据；“某时存在证据”与“现在如何估计”分离。阅读曝光、查词、播放和 SRS 评分不写 KE。来源枚举只包含本轮有明确生产契约的能力，未来听辨证据另行扩展，不能仅因预留值而实现生产者（ADR-040）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `lexeme_id` | FK | 目标只允许 Lexeme，不是 KP |
| `conjugated_form` | string? | **[不可推迟]** 证据作用于该具体表层；为空才是 Lexeme 级证据。非空值不自动证明整个 Lexeme 已知 |
| `source` | enum | `user_asserted` / `import_anki` / `import_jpdb` |
| `confidence` | float | 0–1 的来源权重，不是经校准的掌握概率；用户断言固定 1.0，导入权重由版本化导入配置记录，不能仅凭该值替代用户优先级 |
| `observed_at` | timestamp | 用户断言时间或外部观测时间；外部时间缺失时使用导入时间并记录 `observed_at_basis = imported_at`，有外部时间则为 `external`，用户为 `user_action` |
| `analyzer_dict_version` | string | **[不可推迟]** 把输入消解到 Lexeme 时使用的 SudachiDict 版本 |
| `input_surface` / `input_reading` | string / string? | 保留断言或导入的原始词串及可用读音；与规范化三元组分开，支持审计与重新消解 |
| `resolver_version` | string | **[不可推迟]** 消解规则版本；tokenizer / segmenter 等实际使用的版本保存在消解来源记录中 |
| `material_id` / `session_id` | FK? / FK? | 断言出处；有 session 时须与其材料作用域一致，不扩张 source 枚举 |
| `import_run_id` | FK? | import 来源必填且类型匹配；user_asserted 为空 |
| `operation_key` | string | 写入幂等键，同键同输入返回原结果，同键异输入拒绝 |

导入行按 `(import_run_id, lexeme_id, conjugated_form)` 唯一，空词形通过明确的 scope key 表达唯一性，不依赖 SQLite 的 NULL 唯一行为。多个输入项映射到同一行时保留关联；不同运行可追加证据，查询不因重复导入累加置信度。用户断言由下述 known 决定与 KE 同一事务产生，不能通过访问解析页或确认 srs 间接产生。

#### 用户当前判断与来源撤回

- `LexemeKnowledgeDecision(lexeme_id, conjugated_form?, analyzer_dict_version, decision, evidence_id?, decision_seq, operation_key)` 追加保存。decision 为 `known` / `unknown` / `clear`；known 必须引用同次提交、同目标同词形的 user_asserted KE，其余 evidence_id 为空。每个作用域具有单调 decision_seq 与预期版本检查，重试幂等；analyzer_dict_version 记录作出目标判断时的身份口径，迁移不改写旧裁定。
- 每个 `(lexeme_id, scope_form_key)` 只取最新决定。known 是用户正向裁定；unknown 是用户当前明确否认，压过该作用域的导入与 SRS 估计，但不伪造负向 KE、不删除复习历史；clear 清除该作用域的人工覆盖，回到其他来源求值，**不重新启用旧 user_asserted**。用户来源只有被当前 known 决定引用的有效 KE 可以贡献。
- 具体词形查询先使用该词形的非 clear 裁定，再回退到 Lexeme 级裁定。clear 只清除所在作用域，界面说明仍适用的其他范围。Lexeme 级覆盖率只使用 Lexeme 级证据和裁定，不能把某个词形的 known／unknown 提升为整词结论；词形冲突单列可查。
- `KnownEvidenceRetraction(evidence_id?, import_run_id?, reason?, operation_key)` 追加记录误操作、误消解或用户排除的来源。两个真实外键恰好一个非空，分别唯一；可撤回单条 KE 或整个已发布导入运行。撤回不表示“不认识”，不影响其他独立来源；若撤回的是当前 known 引用的 KE，同一事务追加该作用域的 clear，不能回退到更旧人工决定。
- 更正目标或表层时，撤回旧来源并追加正确 KE／决定；不改写原记录。撤回后的同键重试仍返回原结果并说明已撤回，不隐式恢复。用户明确恢复时建立新的断言或以新导入操作身份发布新运行，并关联原运行；unknown 裁定仍有效，恢复导入不能覆盖它。
- 所有变动与受影响词的投影失效记录同一事务提交；用户操作后的读取必须看见该决定。用户明确删除个人数据仍遵守 §0.1 的引用处理，不用逻辑撤回来阻止删除。

未来若接入听力自评或识别任务，需记录任务条件并区分原声与 TTS；播放本身仍不是识别成功。当前 source 不含 listening 值。导出到 Anki 默认只选择站内 user_asserted 或让用户明确筛选来源，避免外部证据循环导出。

### 2.3 已知词表导入与消解

词典释义导入仍使用 §2.0 的 DictionaryImportRun；已知词表使用独立实体，不创建 KP 或 ReviewItem。

| 实体 | 最小职责 |
|---|---|
| `KnownImportRun` | source、source_profile_id、输入 hash／存储引用、解析与消解版本、analyzer_dict_version、选项 hash／权重配置、外部快照时间（可空）、状态、统计、错误摘要、`retry_of?`／`restores_run_id?` 与 operation_key |
| `KnownImportEntry` | run_id、原始条目位置／外部 ID、原词串／可用读音、原始元数据引用、消解状态、候选 Lexeme／原因、成功时的 evidence_id；`(run_id, entry_ordinal)` 唯一 |

1. 默认幂等身份包含 source_profile_id、输入 hash、解析／消解／分析器及词典版本、选项 hash。同文件同配置重试不再产生 KE；换规则重新消解是新运行，并记录前驱。source_profile_id 区分外部账号／牌组等导入上下文，不含密钥。显式恢复使用新的操作身份，不把普通重复上传视作恢复。
2. 原始导入输入按内容 hash 复用一份不可变资源，条目通过位置引用，不重复保存每次解析的完整 Anki 数据或媒体。成功项也保留足够的原串、读音及原始依据，不能只保存未消解桶。输入资源的保留、删除与引用处理遵守 §0.1。
3. `resolution_status = resolved | ambiguous | unresolved | multi_token`。只有可唯一核对的 Lexeme 匹配才 resolved；单 token 本身不是唯一消解的证明，不能猜同形多读或把短单位拆分的复合词分别当作已知。其余项保留候选与原因并报告数量，后续以新运行重消解。
4. 运行阶段为 queued / running / done / failed / cancelled；解析、消解与有界批次写入可恢复的暂存结果，**done 发布前任何暂存 KE 都不参与领域查询或覆盖率**。最后短事务原子发布完整运行、统计与持久失效记录；失败或取消不暴露半批已知状态。done 后结果追加保护，撤回由 §2.2 记录表达。
5. 默认按追加来源处理不同外部快照：新快照缺少某个词不自动等于用户否认或撤回旧证据；旧来源可显式排除。重复命中同词不重复增权、不相加词汇数。具体权重与未来自动替换快照策略不得由 importer 自行推断，规则落点见产品规划 §15。

### 2.4 SRS 到 Lexeme 的受控信号

SRS 的事实和排程仍只在 §7；不生成 `srs_matured` KE。永久保存某时的里程碑与时间衰减并不矛盾，本轮不另建里程碑实体，是为避免重复维护同一事实。

传播只能给出“相关词汇卡的复习估计”，不是全义项、全词形或听辨掌握证明。资格由后端判定：

1. 贡献记录所属的原 KP 为 lexical，其确定性 lexical_anchors 恰好一个。完整匹配 Span 必须 aligned、覆盖一个 token，且该 token 的三元组与目标 Lexeme 相同；检查使用该 Span 固定的 sidecar／词典来源。partial / ambiguous / unaligned、槽位、pattern / entity / opaque 均不传播。
2. 校验对象是**实际 ReviewEvent 引用的 Occurrence**，不能借同一 KP 的另一条未复习 Occurrence 获得资格。使用整份 ReviewState 时，它所累积的全部有效评分事件必须可追溯且均对齐同一 Lexeme；存在不同目标、不合格事件或旧数据来源不足时，不传播这份状态。不能只校验最后一次评分，也不以过滤后重放冒充原排程状态。
3. 当前换例句后，须核对新提示与原累计目标仍一致；不一致时停用当前状态的跨层信号，旧事件仍保留。此限制只影响 Lexeme 估计，**不清零、回滚或暂停正常 SRS 排程**。
4. canonical 只用于当前查询聚合；先按每个实际贡献验证目标，再聚合到合并簇，不能把簇内任意卡的进度转授其他词。合并／撤销合并、锚点派生变化与词典迁移均重新验证资格。
5. 建立可重建的 `ReviewLexemeEligibility` 摘要：review_item_id、目标 lexeme_id（可空）、eligible／拒绝原因、覆盖到的事件序号及 ReviewState 版本、资格规则版本、对齐来源引用。评分提交增量更新或标脏；读取时核对覆盖事件序号、ReviewState 版本及资格／对齐版本，不能用旧 eligible 搭配新状态。查询包含目标候选关联中待重验的 dirty 卡，不能只读 eligible 索引导致不合格转合格的卡永久漏掉；局部无法及时重验则标记信号更新中。查询不扫描全部 ReviewEvent，只有重建／追溯读取累计历史。
6. 相同 Lexeme 的多张卡单列来源，不假定独立、不得相乘或相加概率。active / paused / retired 与 srs / reference 是排程控制，单独改变它们不构成认识或遗忘；仍有合法历史时可展示带时间和来源的估计。无实际评分的新卡不贡献信号。

SRS 信号在统一 `as_of` 时间从版本化算法参数和状态计算。首版与显式证据覆盖分列，不默认合成为一个掌握分数；合成阈值、多卡聚合及校准见产品规划 §15。讨论 Agent 不能写入资格摘要、KE 或用户裁定。

### 2.5 活动与已知状态查询投影

**LexemeActivity 后置。**未来“见过／查过／播放过”的活动汇总只以 Lexeme 为目标、可关联材料，不塞入 Lexeme 身份表，不进入 KE。首版没有曝光事件或阅读进度生产者；return_position 只负责导航，不能据此推导“读过”。Sentence / Sidecar 的材料出现频次不是活动次数。后续需先定义阅读范围／跳读语义再实现活动聚合，排期见产品规划 §15。

**证据摘要是首版查询基线，最终时间相关结果的物化按测量决定。**事实不存成 Lexeme 上可变 known 布尔值，但允许以下可重建索引／投影：

- `LexemeEvidenceSummary`：按 lexeme_id 与词形作用域索引，保存当前用户决定引用、有效来源支持摘要／计数、必要证据追溯入口、输入修订号与规则／消解版本。原始证据分页读取；撤回和 clear 的效果在重建后保持。
- `MaterialLexemeCount(material_id, sidecar_id, lexeme_id, token_count)`：只保存实际出现的词；正向唯一键与 lexeme→material 反向索引。sidecar 完整派生成功后原子切换当前版本，不混读不同代次。这是算法内容索引，**不提前实现活动统计**。
- `LexemeKnownView` 是查询组合：读取目标词的证据摘要、用户裁定及合格 SRS 状态，带 known_rule_version、资格规则版本、analyzer_dict_version、词典迁移映射版本、input_revision、as_of 与来源。词典版本是当前求值口径，旧事实仍保留各自产生版本，不统一改写。
- 若物化最终结果，另带 evaluated_at、valid_until 或可证明的 next_change_at。连续变化的概率不因没有新写入就保持不变；不能证明有效窗口时读取算法输入并按查询时间重新计算。规则输出字段与综合阈值不在未校准时冻结。

摘要必须可从 KE、当前有效决定／撤回、已发布导入、实际复习历史及其引用和词典迁移映射重建。材料频次来自对应 sidecar。重建不能恢复已经丢失的原始事实；缺少来源时报告不可重建范围，不伪造零值或映射。规则变动不改写历史，执行约束与失效矩阵见 §11。

---

## 3. KnowledgePoint 层

### 3.1 KnowledgePoint

**由一次显式指认构成**（ADR-005）。数量级 \(10^2\)–\(10^3\)。

| 字段 | 类型 | 说明 |
|---|---|---|
| `kp_id` | uuid | **自签发** |
| `anchor_shape` | enum | **[不可推迟]** `pattern` / `lexical` / `entity` / `opaque` |
| `anchor_payload` | json | **[不可推迟]** 类型特定的结构化内容，形状由 `anchor_shape` 决定 |
| `anchor` | string | **由 `anchor_payload` 确定性派生**，模型不书写。保留唯一约束与并发 upsert |
| `pattern_grammar_version` | string? | `shape = pattern` 时必填。记录创建时的枚举集合版本（小版本）与序列化算法版本（大版本），格式 `major.minor` 如 `0.1` |
| `opaque_reason` | enum? | `shape = opaque` 时必填。`model_chosen` / `validation_failed` |
| `zero_slot_lexeme_check` | json? | 0 槽位 pattern 写入时的 lint 结果：`{"passed": bool, "analyzer_dict_version": str}` |
| `display_form` | string? | **可选的人工覆写**。默认由渲染器从 payload 生成 |
| `tags` | string[] | **多值标签**，可为空、可重叠、可后加（ADR-021）。MVP 只保证 `grammar` 可靠打上 |
| `retention` | enum | **[不可推迟]** `srs` / `reference`。**KP 默认复习策略**，供 Occurrence 继承；不表示已有卡片或逐例句建卡授权 |
| `retention_set_by` | enum | **[不可推迟]** `default` / `user`。为 `user` 时，重跑抽取与批量重抽**不得覆盖** |
| `canonical_id` | uuid? | **[不可推迟]** 合并指向。空值表示自身即 canonical |
| `lexical_anchors` | lexeme_id[] | **可空、可多，不参与身份判定**。由后端确定性派生；服务召回并作为 §2.4 传播资格的必要条件，变化须使相关资格／摘要失效 |
| `origin` | enum | `extraction`（MVP 内唯一取值）/ 预留 `manual` |

**完整示例**：

```json
// pattern shape 示例
{
  "anchor_shape": "pattern",
  "pattern_grammar_version": "0.1",
  "anchor_payload": {
    "elements": [
      {"type": "slot", "id": "N1", "category": "N", "form": "none"},
      {"type": "literal", "text": "の"},
      {"type": "literal", "text": "ない"},
      {"type": "slot", "id": "N2", "category": "N", "form": "none"}
    ]
  },
  "anchor": "N[none].の.ない.N[none]",
  "display_form": null
}

// lexical shape 示例
{
  "anchor_shape": "lexical",
  "anchor_payload": {
    "surface": "向上心"
  },
  "anchor": "向上心",
  "display_form": null
}

// entity shape 示例
{
  "anchor_shape": "entity",
  "anchor_payload": {
    "entity_type": "literary_work",
    "entity_label": "夏目漱石《こころ》"
  },
  "anchor": "entity:literary_work:夏目漱石《こころ》",
  "display_form": null
}

// opaque shape 示例
{
  "anchor_shape": "opaque",
  "anchor_payload": {
    "freeform": "〜ことができる"
  },
  "anchor": "hash:a3f8c9...",
  "opaque_reason": "model_chosen",
  "display_form": "〜ことができる"
}
```

#### KP 默认复习策略与 Occurrence 用户决定

KP 的 `retention` 对用户称为“默认复习策略”，字段名保留。`srs` 允许已获逐例句授权的复习继续排程，`reference` 暂停继承该策略的已有复习项；两者都不是对全部历史或未来 Occurrence 的建卡授权，也不表示卡片数量或学习进度。两者都保留 KP、Occurrence、检索、聚合与记忆注入；知识点的存在不等于“已学会”。

Occurrence 另有局部 `retention` 决定，取值为 `inherit` / `srs` / `reference`。`inherit` 使用其原始 `kp_id` 对应 KP 的当前默认策略；`srs` 与 `reference` 是用户对具体例句或讲解实例的明确覆盖。有效意愿由后端求值并带来源，不把局部选择无提示地写回 KP。

**意愿值与用户是否确认分开**：`inherit` 本身不说明用户是否处理过该 Occurrence。会话内以 §4.2 的确认记录判断，知识库动作保留逐 Occurrence 的用户决策记录，不以当前 retention 值或 KP 是否有用户决定推导。用户明确沿用 KP 策略也必须确认具体 Occurrence；当次有效值为 `srs` 时，确认与 ReviewItem 的创建／复用原子提交。确认时为 `reference` 且没有 ReviewItem 的 Occurrence，后续仅因 KP 改为 `srs` 不会自动建卡，仍须用户明确加入。

1. 新 KP 创建时可使用 `retention = srs`、`retention_set_by = default` 作为尚未确认的初值；Occurrence 默认 `inherit`。该初值不授权建立 ReviewItem。
2. 用户在学习会话确认中选择 Occurrence 时，记录 Occurrence 级决定；若需要同时开放整个 KP，必须明确选择该附加操作。知识库可以直接修改 KP 意愿。两类决定均追加可审计事件，重跑抽取不得覆盖用户决定。
3. 后续抽取保留已有 KP 的默认策略，新 Occurrence 以 inherit 初始化，不复制旧 Occurrence 的局部决定或加入授权。标签可以并集补充；自动处理不覆盖人工 `display_form`。
   KP 为 `reference` 时，继承状态的 Occurrence 可在确认界面灰显或默认不选，但用户可明确选择局部 `srs`。KP 意愿变化不删除或退役卡片；只影响当前有效意愿继承该 KP 的 ReviewItem。
4. 会话中的候选按本次成功 ExtractionRun 的 KP 折叠展示，但卡片选择以 Occurrence 为粒度。是否完成本次确认由 §4.2 的 SessionConfirmation 决定，**不再用 `retention_set_by = default` 作为解析队列或会话退出条件**。
5. KP 的 `reference → srs` 只恢复受该默认策略影响的既有非退役 ReviewItem：已获配额的恢复排程，未获配额的回到 `queued`。无 ReviewItem 的历史 Occurrence 不因此创建复习项；正常流程没有“已确认加入学习、等待以后建卡”的中间状态。详见 §7。

#### 身份与合并

- `anchor` 是形式级自然键，数据库唯一；`kp_id` 是自签发主键。同一形式的不同义项共享 KP，差异保留在 Occurrence；归一锚点不归一内容。
- 并发抽取以幂等 upsert / 冲突重试收敛；MVP 不做全库写入时 alias 模糊查重，候选召回与条件身份消解见 prompt 契约 §5。
- `canonical_id` 是可更新、可撤销的当前合并指针。追加 `KnowledgePointMergeEvent(source_kp_id, previous_canonical_id?, canonical_id?, created_at)`，Occurrence 的原 `kp_id` 不改写。合并禁止自环和环；目标当前用户意愿须明确，不能由抽取借合并覆盖。
- 合并／撤销不迁移 ReviewItem，不改写其 `occurrence_id`、原 `kp_id` 或既有 ReviewEvent；知识库通过当前 canonical 归属聚合，并可追溯原来源。canonical 聚合不自动替换 Occurrence 的默认策略来源，也不覆盖局部 `srs` / `reference` 决定；如需统一默认策略或修改局部决定，必须另作用户知情的明确操作。
- `shape = pattern` 必有 `pattern_grammar_version` 和 `elements`；`opaque` 必有 `opaque_reason`；`lexical` / `entity` 的模式版本与 opaque 原因为空。
- `anchor` 必须由 payload 按记录的版本确定性派生；槽位 id 不参与身份。
- 展示优先使用人工 `display_form`，否则从 payload 渲染。被保存的导出产物记录渲染版本；当前 UI 渲染器可正常维护，不要求每次视觉修复新增永久函数。

### 3.2 Alias

| 字段 | 类型 | 说明 |
|---|---|---|
| `alias_string` | string | 变体写法 |
| `kp_id` | FK | 收敛到的 KP |
| `source` | enum | `seed`（JLPT 语法表种子）/ `extraction` / `merge` / `manual` |

**约束**：别名表只服务 KP 层，Lexeme 不进此表。

**用途**（ADR-034）：结构化 payload 减少自由串漂移后，Alias 主要承载「JLPT 种子串 / 教材写法 → 模式」映射与外部导入；实际规模与身份稳定性由实验测量。

### 3.3 Occurrence

| 字段 | 类型 | 说明 |
|---|---|---|
| `kp_id` | FK | |
| `sentence_id` | FK | |
| `material_id` | FK | |
| `spans` | Span[] | **[不可推迟]** 该知识点在原句中的位置。有序包含完整匹配与槽位 Span，物理上通过 `occurrence_spans(occurrence_id, span_id, ordinal)` 关联；不得限制为长度 1 |
| `slot_bindings` | json | 槽位实例绑定，键为槽位 id（如 "N1"），值为 `span_id`（引用 `spans` 表）。`shape` 为 `pattern` 时按模式槽位填充，其他 shape 时为空对象 `{}` |
| `salience` | enum | **[不可推迟]** `primary` / `secondary`。用于候选排序与用户决定后的新卡待建优先级；不决定 KP 的存在或复习意愿（ADR-019） |
| `retention` | enum | **[不可推迟]** `inherit` / `srs` / `reference`。Occurrence 的局部复习意愿决定；`inherit` 使用 KP 当前意愿 |
| `brief` | string | 该次讲解的要点摘要，由抽取段给出。MVP 的 `content_source = analysis_section` 时必填；未来 `user_gloss` 来源可按其契约为空 |
| `content_source` | enum | **[不可推迟]** `analysis_section`（MVP 内唯一取值）/ 预留 `user_gloss` |
| `section_id` | FK | **[不可推迟]** 指向 AnalysisSection 的逻辑小节，而非字符区间；MVP 必填 |
| `section_revision` | int | **[不可推迟]** 引用时的小节版本，配合上一字段；MVP 必填 |
| `source_analysis_id` | FK | |
| `extraction_run_id` | FK | 产生该 Occurrence 的具体 ExtractionRun |
| `extractor_model` | string | 模型标识 |
| `extractor_prompt_version` | string | |
| `user_marked_useful` | bool? | 三态：未评价 / 有用 / 无用 |

**约束**

1. **每个成功提取运行的有效出现均记录**，不因 retention 或配额丢弃。新的成功 run 追加 Occurrence；同一 run 的重复提交必须幂等，不复制产物（ADR-019）。
2. 内容引用必须是 `section_id + section_revision`，**不得用字符区间指向解析原文**——解析文档可变，字符区间会碎。`content_source = analysis_section` 时二者均非空；未来其他来源必须另行定义引用约束。
3. 抽取段输出的是原文子串，**字符区间、token 区间、三元组与 `lexical_anchors` 全部由后端推导，不由模型给出**（ADR-009）。
4. **槽位绑定完整性**：`shape = pattern` 的 KP 所产生的 Occurrence，其 `slot_bindings` 必须包含该模式全部槽位的成功绑定；任一槽位定位失败则该次出现不产生 Occurrence，在 `ExtractionRun.unresolved_patterns` 中定位 candidate 与失败范围；同一候选其他完整命中的有效出现可保留。
5. `slot_bindings` 的值为 `span_id`（surface 可从 Span 取，不冗余存储）。

---

## 4. 学习会话、工作文档与提取

### 4.1 StudySession（学习会话）

解析队列是未完成会话（StudySession）的查询视图，不是执行任务队列，也不新增 Inbox 实体。一次会话拥有一份解析工作文档、用户对话、执行记录与提取产物。

| 字段 | 类型 | 说明 |
|---|---|---|
| `material_id` | FK | 原材料与返回位置的作用域 |
| `source_sentence_ids` | ordered FK[] | 物理使用 `study_session_sentences(session_id, sentence_id, ordinal)`；首版恰好一句，预留多句不意味着已经支持联合分析 |
| `mode` | enum | `interactive` / `automatic`；后者必须显式选择，不因多选而推断 |
| `status` | enum | `active` / `completed` / `parked`；可更新的会话生命周期 |
| `phase` | enum | `preparation` / `discussion` / `extraction` / `confirmation`；搁置时保留阶段 |
| `current_extraction_run_id` | FK? | 当前正在处理或待确认的提取运行；重试明确切换，不覆盖旧 run |
| `completed_at` | timestamp? | 本次会话完成时间 |
| `return_position` | json? | 阅读／播放位置，不表达阅读或掌握状态 |

**流程与操作**

- 创建即进入 `active + preparation`，可立即打开会话。排队、运行、失败由执行记录呈现，不另造 KP。首次生成失败仍停留 preparation，可创建新的 generation AgentRun 重试；只有成功提交首稿才进入后续阶段。
- 首次生成成功：interactive 进入 `discussion`（可讨论）；automatic 固定成功版本后直接进入 `extraction`。普通多选创建多个 interactive 会话，各自仍可讨论；首版不把多句塞入同一生成请求。
- discussion 中允许多轮对话和文档编辑。离页、切换材料、关闭浏览器均不结束讨论、不自动提取。
- 用户“结束讨论并提取”时，等待当前文档写操作结束，原子选定 AnalysisRevision 并转入 extraction。提取期间不接受新的讨论写入；失败只重试该版本的提取。
- 成功提取后进入 confirmation；两种模式均在此由用户确认复习意愿，不自动为默认候选建卡。
- 当前 run 的所有不同 Occurrence 完成本次确认后进入 completed，退出解析队列；按 KP 折叠展示不改变确认粒度。零候选的合法结果显示原因，由用户明确“完成学习”，不伪造候选。
- 已完成会话保留文档、对话和来源，可从学习记录访问。继续研究时创建新的关联会话，不修改已确认提取的输入。
- 搁置移出默认队列但保留所有数据，恢复时回到保存阶段。运行中的操作必须先完成或确认取消再搁置，不允许搁置后隐藏后台写入。

**查询投影**

| 入口 | 数据依据 |
|---|---|
| 阅读器／播放器、素材卡片“解析队列” | `status = active` 且 `material_id` 匹配；可按阶段筛选 |
| 全局“解析队列” | 相同查询，不限定材料 |
| 学习记录 | 全部会话，支持 completed / parked / 材料筛选 |
| 知识库／材料知识视图 | KP 经 Occurrence 关联来源；独立显示用户意愿、实际排程、讲解次数与材料出现次数 |

同一句的多次会话保持独立 ID。访问页面不创建 `read/unread/learned` 状态；状态数量与运行进度可显示，不制造未读债务。会话完成与 KP 当前全局意愿是两个维度。

### 4.2 SessionConfirmation（本次结果确认）

| 字段 | 类型 | 说明 |
|---|---|---|
| `session_id` | FK | 本次会话 |
| `extraction_run_id` | FK | 必须是本次当前、成功的提取结果 |
| `occurrence_id` | FK | 本次确认的具体复习内容；必须是该 run 已提交 Occurrence |
| `kp_id` | FK | 必须出现在该 run 的已提交 Occurrence 中 |
| `retention_at_confirmation` | enum | 本次确认时的 `srs` / `reference` 快照 |
| `occurrence_retention_at_confirmation` | enum | 本次确认的局部值 `inherit` / `srs` / `reference`；与有效意愿快照分开 |
| `review_item_id` | FK? | 当次明确加入学习所创建／复用的 ReviewItem；有效值为 srs 时必填，且须引用本 Occurrence |
| `decision_source` | enum | `user`（本次 Occurrence 选择）/ `inherited`（沿用 KP 意愿） |
| `decision_id` | FK? | 对应的 KP 或 Occurrence 意愿决定；继承时关联所沿用的决定 |
| `confirmed_at` | timestamp | |

`inherited` 只允许继承已有用户明确决定的 KP 意愿；default 初值不能作为用户选择的替代。Occurrence 的局部 `srs` / `reference` 选择始终记录为 user。

无确认记录的 `inherit` 是尚未确认；存在 `inherited` 确认记录的 `inherit` 才表示用户明确沿用。`reference` 只作参考也是一次有效确认，不表示未处理。历史确认不授予其他 Occurrence 建卡权限，后续 KP 策略变化不改写当时的局部值、有效值或 ReviewItem 引用。

记录追加保存；同一会话、run、Occurrence 的最后一次明确确认是当前确认结果。继承默认策略不自动完成会话；可提供列明具体 Occurrence 与结果的“一并沿用并完成”。确认一个新选择时，Occurrence 决定、必要的 KP 决定、SessionConfirmation 及所需 ReviewItem 的创建／复用同一事务提交；任何一步失败均不提交“已加入学习”，重试不重复创建。会话结束后知识库修改不回写这些快照。

`SessionConfirmation` 本身就是会话内“用户是否处理并加入该 Occurrence”的审计事实，不另写一条重复的 Occurrence 决策事件。知识库直接修改局部意愿时使用紧凑的 `OccurrenceRetentionDecision(occurrence_id, previous_retention, retention, source, operation_key, created_at)`；相同值的重复写入不产生事件。该记录不保存页面状态、完整请求正文或重复的 Occurrence 内容。

最后一项确认与会话完成在同一提交边界；等待配额不阻止会话完成。若确认期间全局意愿已被别处更新，按版本检查提示刷新，不静默覆盖。KP 合并影响正在确认的结果时同样刷新，不复制意愿。

### 4.3 Analysis 与 AnalysisRevision

Analysis 承载当前工作文档；会话阶段、消息和确认不再挂在同一实体上。

| Analysis 字段 | 类型 | 说明 |
|---|---|---|
| `session_id` | FK unique | 一次会话一份工作文档 |
| `current_revision_id` | FK? | 当前已提交文档版本；生成前可为空 |
| `style_modules` / `style_free_text` | string[] / string? | 本次初始解析要求 |
| `user_question` | string? | 初始困惑 |
| `output_language` | string | 解析语言 |
| `retrieval_enabled` | bool | MVP 恒为 false；本地词典／KP 工具不属于联网检索 |

| AnalysisRevision 字段 | 类型 | 说明 |
|---|---|---|
| `analysis_id` | FK | |
| `revision` | int | 文档级递增版本号，与 analysis_id 唯一 |
| `section_refs` | ordered FK[] | `analysis_revision_sections(analysis_revision_id, section_version_id, ordinal)` 保存完整顺序 |
| `source_agent_run_id` | FK? | 产生这次提交的生成／讨论运行 |

一个 manifest 中同一逻辑 section_id 只能出现一次，所有小节必须属于该 Analysis；运行与确认引用必须属于同一 session/analysis 作用域。一次有效编辑原子提交新 revision、新增变化的小节版本并切换当前指针。未变化小节复用，不复制全篇正文；删除／移动通过新版本的引用集合与顺序表达。流式未完成内容是草稿，不成为提取输入。

提取必须引用一个已提交的 AnalysisRevision。该 manifest 和它引用的小节正文因此受保护；清理只能处理无历史引用且已超出撤销保留范围的草稿版本。不能通过修改当前指针改变旧 ExtractionRun 的输入。

### 4.4 AnalysisSection

| 字段 | 类型 | 说明 |
|---|---|---|
| `section_version_id` | uuid | 具体内容版本 |
| `section_id` | uuid | 逻辑小节身份 |
| `analysis_id` | FK | |
| `heading_path` | string[] | 后端切分的寻址辅助信息；降级为空 |
| `split_strategy` | enum | `heading` / `paragraph` / `fallback_single` |
| `body_md` | text | 自由讲解正文，无固定语义组织要求 |
| `revision` | int | 小节级版本，与 section_id 唯一 |
| `origin_agent_run_id` | FK | 产生该内容版本的运行 |

Occurrence 的 `(section_id, section_revision)` 引用保持有效。当前小节集合由 AnalysisRevision 决定，不再依赖可变 `superseded_by` 判定文档内容；合并产生新小节版本／逻辑小节并记录工具操作，旧被引用内容不删除。

`kind` 与 `spans` 是特定提取运行对小节的解释，存 §4.6 ExtractionSection，不回填不可变正文版本。API 可组合展示，但必须带 extraction_run_id，不把旧版本映射套到新正文。

### 4.5 AgentRun、AnalysisMessage 与工具记录

- `AgentRun`：关联 session_id，记录 `purpose = generation | discussion`、`status = queued | running | done | failed | cancelled`、provider/model/prompt_version、请求标识、usage、输入／输出文档 revision、注入的 KP/note ID 与必要版本或摘要。初始 generation 是一次运行；每次用户发送消息产生 discussion 运行，运行内部可多次调用工具。
- `AnalysisMessage`：`session_id`、单调 `message_index`、`role = user | assistant`、`content`、`agent_run_id?`。保存用户原始输入与可见回复，不拼入自动注入的全文；不再限制一个业务回合只有一个 assistant 消息。
- `AgentToolCall`：`agent_run_id`、`call_id`、`tool_name`、输入摘要／必要参数、状态、结果摘要、目标实体与前后版本。唯一键为 `(agent_run_id, call_id)`，保存规范化输入 hash；同键同 hash 重试返回原结果，同键不同 hash 拒绝为协议冲突。持久修改的操作记录与修改同一提交边界，不重复编辑或增加笔记。
- provider 所需的调用／结果关联与续接数据由适配层保存足够的协议记录，和用户可见消息分开；不得把任意截断后的工具半轮作为可重放上下文。失败／取消保留已成功提交的编辑，并清楚标出部分完成，不声称整轮成功。
- 画像与作品笔记写操作仍受作用域、槽位与长度检查；持久副作用须可审计。隐藏推理不是领域实体，不要求获取或永久保存。

旧 Analysis 上的 `status/extraction_status/extraction_trigger/session_closed/turn_count` 由会话与运行记录替代，不继续维护第二份状态机。如何迁移旧字段由后续实现任务处理。

### 4.6 ExtractionRun 与 ExtractionSection

每次提取尝试独立记录，固定输入版本。生成／讨论历史仅是可选执行优化，不能成为提取自足性的前提。

| 字段 | 类型 | 说明 |
|---|---|---|
| `session_id` / `analysis_id` | FK | |
| `analysis_revision_id` | FK | **[不可推迟]** 本次唯一、确定的输入文档版本 |
| `execution_path` | enum | `continued_turn` / `standalone` |
| `provider` / `model` / `prompt_version` | string | 审计来源 |
| `status` | enum | `running` / `done` / `failed`；运行中可更新，结束结果保留 |
| `retry_of` | FK? | 重试沿用原文档版本，保留旧尝试 |
| `failure_reason` | enum? | `invalid_json` / `empty_candidates` / `all_unresolved` / `provider_error` |
| `unresolved_surfaces` | string[] | 原文找不到的 surface |
| `invalid_patterns` | json[] | `{candidate_index, failed_rules}` |
| `unresolved_patterns` | json[] | `{candidate_index, anchor, missing_slots}` |
| `opaque_count` / `candidate_count` | int | 已提交产物统计；原始输出数量可在诊断中单列 |
| `started_at` / `finished_at` | timestamp | |

`ExtractionSection(extraction_run_id, section_version_id, kind)` 加有序 Span 关联表，为本次输入的每个小节提供分类与原句定位。kind 集合 = 九个解析模块 + `takeaway` + `qa`，与 KP tags 使用不同枚举。

成功的 KP upsert、Occurrence、ExtractionSection 与 run 完成状态一起提交；失败尝试不能产生部分可见学习产物。可定位的部分候选允许成功提交，同时记录被拒绝候选；整体失败规则见 prompt 契约 §5.5。

重试请求的传输幂等不等于跨运行去重：同一运行不得因重复提交复制产物；新的成功重抽运行追加新的 Occurrence，不覆盖旧 run、旧引用或用户决定。历史维护式重抽不自动重新打开已完成会话、不自动建卡；如用户要重新确认，创建新的会话。

---

## 5. Annotation

**叶子实体。与 KnowledgePoint 之间没有边**（ADR-030）。它是阅读器的基础功能，不为解析链路让步。

| 字段 | 类型 | 说明 |
|---|---|---|
| `material_id` | FK | |
| `spans` | Span[] | **有序数组**。单句划线为长度 1，跨句划线为长度 n |
| `note` | text? | 自由文本，无格式要求 |
| `color` | string? | |

**约束**

1. 不进 SRS、不进别名表、不需要合并、不需要锚点规范。
2. 能力边界：列表检索、按材料／时间／文本筛选、跳回原文。仅此。
3. 「划线到一个词」即为词汇标记，不需要专门设计。
4. **不提供从 Annotation 自动提升为 KP 或自动发起解析的入口。**用户想学它时，正确动作是跳回原文位置、在阅读器中手动触发一次解析。

---

## 6. 记忆

### 6.1 MaterialNote（作品笔记）

| 字段 | 类型 | 说明 |
|---|---|---|
| `material_id` | FK | 作用域为单部作品 |
| `content` | text | 上限 `M` 字 |
| `source_sentence_id` | FK? | 产生该条笔记的句子 |
| `last_hit_at` | timestamp? | 最近一次被注入上下文的时间 |
| `updated_by` | enum | `agent` / `user` |

### 6.2 LearnerProfileNote（学情画像）

| 字段 | 类型 | 说明 |
|---|---|---|
| `content` | text | 上限 `M` 字 |
| `last_hit_at` | timestamp? | |
| `updated_by` | enum | `agent` / `user` |

**两者共同约束**

1. **条数上限 `N` 与单条字数上限 `M` 由后端强制**，不由 prompt 约束。写满后新增必须以「替换某条」或「合并某两条」提交，后端校验后拒绝越界写入（ADR-029）。
2. 长期未被命中的条目走 LRU 淘汰。
3. 对用户可见、可编辑、可删除；允许更新当前正文。Agent 工具写入记录目标、操作结果与版本，有限撤销历史按 §0.1 保留。
4. **「某语法点是否已讲过」不由记忆承担**，它来自 KP 库检索这一确定性事实。记忆只承载风格与画像。

---

## 7. SRS

### 7.1 ReviewItem

ReviewItem 是复习调度绑定，不等同于最终渲染卡片。它固定连接一个 Occurrence 与其排程状态；未来的 CardDefinition 可以在不改变 ReviewItem 或复习历史的前提下描述站内卡片模板或外部导出字段。

| 字段 | 类型 | 说明 |
|---|---|---|
| `occurrence_id` | FK | 卡片固定引用的具体例句／讲解实例 |
| `kp_id` | FK | 必须与 `occurrence.kp_id` 一致；用于归属、聚合和查询，不决定唯一性 |
| `status` | enum | `queued` / `active` / `paused` / `retired` |
| `admitted_at` | timestamp? | 首次获新卡配额并进入排程的时间；一经分配保留，用于区分 paused 恢复为 queued 或 active。**准入不等于首次评分**：ReviewState 在首次评分时建立 |
| `retired_at` | timestamp? | 真正退役时单向设置；**reference 使用 paused，不使用退役标记** |

- `status = retired` 当且仅当 retired_at 非空；queued/active/paused 的 retired_at 必须为空。退役同次提交状态与时间戳且不可恢复；queued/active/paused 之间的转换不删除历史。
- queued 的 `admitted_at` 必须为空；active 必须已有 `admitted_at`。**ReviewState 不在准入时建立**，而是在首次评分提交时与首条 ReviewEvent 同一事务建立；已准入但尚未首评的 active 项没有 ReviewState。paused 可发生于准入前、准入后未首评或已首评之后，保留原准入标记；retired 不清除该标记。
- 用户明确选择 Occurrence 加入学习时立即创建 ReviewItem；每日配额不足时为 `queued`，按 salience 优先、同级 FIFO 转为 `active`。默认值或 KP 的 `srs` 意愿不单独授权创建。
- 同一 Occurrence 默认至多一条非 retired ReviewItem；同一 KP 下不同 Occurrence 可以各自拥有 ReviewItem。未来不同卡片模板可扩展为多个 ReviewItem，但必须有明确用户操作。
- 有效 retention 为 `reference` 时对应 ReviewItem 进入 `paused`，不进入到期队列；保留既有 ReviewState 与 ReviewEvent（尚未首评则两者均不存在）。KP 意愿变化只影响继承该意愿的 Occurrence，明确 `srs` 覆盖的 Occurrence 由用户决定是否暂停。
- 有效意愿改回 `srs` 时，仅恢复已有非退役复习项。`admitted_at` 非空的恢复为 active，不重复消耗新卡配额，保留原 due 与学习进度；**若该项尚未首评，则没有 ReviewState、due 或进度可保留**。`admitted_at` 为空的恢复为 queued，仍须首次配额。暂停恢复不伪造复习或清零历史。
- 每日新卡配额控制首次进入排程，不控制 ReviewItem 行的创建。queued 按 `salience` 优先、同级 FIFO 分配；准入前再次核对最新有效意愿，reference 不得因旧队列状态而激活。首次准入与 `admitted_at` 写入及配额扣减原子提交；**准入不构造 S/D，也不创建 ReviewState**，ReviewState 与首条 ReviewEvent 在首次评分时同一事务建立；queued 时不提前运行排程。
- 知识库的逐 Occurrence 加入动作与会话确认使用同一事务和排程服务。KP 默认策略更新本身不创建 ReviewItem。会话确认完成不要求配额已分配。
- 真正 retired 的卡片不恢复；用户另建卡须明确，不把 srs/reference 切换解释为退役重建。

### 7.2 ReviewState 与 ReviewEvent

ReviewState 是**已首次评分** ReviewItem 的当前 FSRS 排程投影，允许原地更新；首次评分前尚无 ReviewState，包括 queued、已准入但未首评，以及暂停中的项目。FSRS 的初始稳定性由首次评分决定，因此准入时不存在可写入的 S/D，不能在准入阶段创建该行。具体算法字段沿用实现所选算法，不要求给每次状态更新保存整行版本。

ReviewEvent 追加保存：`review_item_id`、该卡单调 `event_sequence`、当时的 `occurrence_id`、`reviewed_at`、评分、算法版本及重放所需的排程参数／结果。`(review_item_id, event_sequence)` 唯一；ReviewState 带覆盖到的事件序号与单调版本，供重建和资格摘要校验。同一次复习提交有幂等键；**首条 ReviewEvent 与该 ReviewState 的建立**、以及后续事件写入与当前状态更新，均在同一事务内完成。换例句、暂停和恢复不删除既有复习事件，也不伪造评分。

动态回忆估计在明确 as_of 时间按记录的算法／参数求值，不能仅把上次存储的概率当成当前值。SRS 向 Lexeme 提供信号须满足 §2.4；缺少来源的旧评分仍可用于既有排程，但不能凭空补齐传播资格。

---

## 8. 素材与句子

### 8.1 Material

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | string | 导入时从文件名或 EPUB metadata 推导，用户可修改 |
| `content_hash` | string | **[不可推迟]** |
| `locator` | string | 原始资源的路径或句柄；存储策略见下 |
| `kind` | enum | `subtitle_video` / `subtitle_audio` / `text` / `epub` |
| `copy_stored` | bool | 真实复制状态，不固定写 false |
| `storage_mode` | enum | `external_reference` / `managed_copy` |
| `current_sidecar_id` | FK? | 已完整发布的当前分句／分词及材料词频版本；准备前可空 |
| `source_sha256` | string? | 原始文件校验，与规范化文本 content_hash 分离 |

视频默认 external_reference；导入可明确选择 external_reference 或 managed_copy（音频、文本、EPUB 同样适用）。managed_copy 原始资源不可变；external_reference 源失效不删除已有 Sentence/sidecar。导入需说明文件大小与可用性影响。

### 8.2 Sentence

| 字段 | 类型 | 说明 |
|---|---|---|
| `material_id` | FK | |
| `index` | int | 材料内序号 |
| `text` | string | |
| `time_start` | ms? | |
| `time_end` | ms? | |
| `translation` | string? | 随素材附带的译文。**作为参考而非标准**传入解析 |
| `anchor_type` | enum | **[不可推迟]** 位置锚点类型 |
| `anchor_payload` | json | **[不可推迟]** 类型特定的位置数据 |

#### 锚点取值（MVP 三种）

| `anchor_type` | `anchor_payload` |
|---|---|
| `subtitle` | `{cue_index: int}` |
| `plain_text` | `{char_start: int, char_end: int}`，偏移相对规范化后的整份文本 |
| `epub` | `{spine_index: int, char_start: int, char_end: int}`，偏移相对该 spine item 抽出的规范化纯文本 |

EPUB 不使用 CFI。理由：CFI 绑定 DOM 结构，而本产品对 EPUB 的处理本就是「抽成纯文本再分句」，spine index + 纯文本偏移与这条处理链路一致，且重新解析同一文件时可复现。代价是重排版后偏移失效，但 `content_hash` 已能检出这种情况。

PDF **不在 MVP 内**，走「转纯文本」降级，落 `plain_text`。

**约束**

统一抽象：**素材 = 有序 Sentence 序列 + 可选时间戳 + 可选 locator。**视频、音频、文本的差异全部落在「时间戳有没有」与「locator 指向什么」上。上层的解析、抽取、复习、聚合**不得感知素材类型**。这是「音视频为一等公民」的可验证形式，应写成测试。

### 8.3 Sidecar

| 字段 | 类型 | 说明 |
|---|---|---|
| `content_hash` | string | |
| `segmenter_version` | string | **[不可推迟]** |
| `tokenizer_version` | string | **[不可推迟]** |
| `analyzer_dict_version` | string | **[不可推迟]** SudachiDict 版本；不得与释义词典来源版本混用 |
| `payload` | messagepack | 分句／分词结果 |

Sidecar 是一次派生的不可变版本；重分词产生新 ID，不能覆盖被 Span／复习来源引用的 payload。新版本的 MaterialLexemeCount 完整生成并校验后与 current_sidecar_id 同次发布，字典迁移可跨代次重建证据视图，见 §11。

懒生成的算法／翻译缓存 key 必须包含输入文本或 sidecar 身份及相关分析器、分析器词典版本；依赖释义词典时另带来源及版本。模型生成的翻译还须区分模型、prompt 版本与输出语言，不以缓存复用绕过来源变化。缓存可清理，不作为历史讲解引用。

---

## 9. 不变量清单

编号保留以便迁移；以下是目标契约，不代表已有测试已点亮。后续阶段验收应按当前契约重新映射。

1. Occurrence 指向存在的 KP；合并不改写其原 kp_id，canonical 指针无环。
2. Occurrence 引用存在的小节版本，且该版本属于其 ExtractionRun 固定输入的 AnalysisRevision；被引用内容不得覆盖或清理。
3. 有效 retention 为 reference 的 Occurrence 没有 active ReviewItem；paused 的卡片及复习历史保留。
4. 同一 Occurrence 默认至多一条非 retired ReviewItem；同一 KP 下不同 Occurrence 可以各自拥有 ReviewItem。status=retired 与 retired_at 非空等价，暂停恢复不改变退役标记。
5. 带三元组的记录有非空分析器词典版本来源；Lexeme 使用 first_seen_analyzer_dict_version，其余相关记录使用 analyzer_dict_version。
6. Span 的 code point 半开区间非空、在原句内，切片等于 surface。
7. 作品笔记／画像的条数与单条长度由写入路径强制限制。
8. Lexeme 不进入 Alias，KP 不成为 KnownEvidence 的 target；未来活动统计同样只以 Lexeme 为 target。查词、播放、阅读曝光和评分不产生 KE。
9. 只有 active + discussion 会话接受新的讨论运行；切换阶段须先结束或确认取消在途文档写操作，提取输入不会随当前文档变化。
10. 成功 ExtractionRun 对其输入版本的全部小节都有合法 ExtractionSection.kind；提取前无映射合法，提取不修改小节正文。
11. KP.anchor 唯一，并发 upsert 收敛；同一运行的重复提交不复制产物。
12. pattern KP 的 anchor 等于按其 pattern_grammar_version 序列化的 payload。
13. pattern Occurrence 的 slot_bindings 键集合等于模式槽位集合；其他 shape 为空对象。
14. pattern 有模式版本；opaque 有 opaque_reason。
15. 槽位顺序与模式一致，跨槽位 Span 不相交；完整匹配 Span 可以包含槽位 Span。
16. 每个 slot_bindings 值均在该 Occurrence.spans 中；spans 是有序数组，不限长度 1。
17. 会话完成只依据当前成功 run 的本次确认（零候选须明确完成），不依据 KP 当前全局 retention；后续意愿修改不复活旧会话。
18. 任意模式的新建复习项均有针对具体 Occurrence 的明确加入决定，并与该决定原子提交；default 或 KP 策略变化不构成授权。首次准入排程须满足配额，未准入项为 queued；已准入项的暂停恢复不重复消耗配额、不清除进度。
19. 提取、确认、Agent 工具副作用与复习提交各自原子且幂等；失败不得留下宣称成功的部分产物。
20. 当前状态可更新；历史引用、用户决定保护和关联完整性不因更新而失效。
21. 用户当前裁定按作用域生效，unknown 压过导入和 SRS；clear 不复活旧用户 KE。撤回保留来源历史，并与失效记录原子提交。
22. 已知词表同操作幂等；未发布、失败、取消和被撤回来源不贡献已知状态，未唯一消解输入不拆成多个已知词。
23. SRS 跨层信号有实际评分 Occurrence 与完整累计状态的资格依据；合并或换例句不能转授旧评分，不合格状态不影响原有排程。
24. 高频查询使用目标集合的摘要／索引，不全扫历史或解包全部 sidecar；增量结果与相同规则、来源版本和 as_of 的重建结果一致。
25. 时间相关结果不因无写入而无限有效；过期或重建中结果有明确状态，读请求不混合投影代次，不能把重建空窗显示为真实零值。

---

<a id="10-两个数不能相加"></a>

## 10. 统计口径与跨层依赖

**红线**：词汇证据覆盖与知识点学习进度分别显示、标明来源，永不相加、永不互相校验。该规则不限于界面文案，API、查询与导出也不能用两者相等作为完整性断言；它不要求输入来源绝对不相交。将来综合口径引用 SRS 时仍只允许 §2.4 的受控信号。

| 指标 | 首版口径 |
|---|---|
| 材料出现次数 | 当前 sidecar 的 token 频次，来自 MaterialLexemeCount；不声称用户实际读过 |
| 有已知证据支持的材料覆盖率 | 默认按 token 加权：分子为有效 Lexeme 级 user_asserted／已发布导入支持且未被 Lexeme 级 unknown 排除的 token 数，分母为具有有效 Lexeme 映射的全部 token 数；按词去重后的 Lexeme 覆盖另列并标注 |
| 相关词汇卡的复习估计 | 仅合格 ReviewState 的带时间、来源估计，首版单列，不自动并入上一行 |
| KP 数量／讲解次数／排程进度 | 分别按 KP、Occurrence、ReviewItem／ReviewEvent 的明确查询统计，与证据覆盖分离 |

首版显式覆盖是“是否存在有效来源支持”的集合口径，不把 confidence 当已知概率求和；同词、同 token 多来源只计一次。词形级证据单列，不提高 Lexeme 级分子。材料的出现次数只作频次权重／分母，不本身增加正向知识证据。分母同时返回可计 token 数、无有效映射数和采用的版本；分母为零时无可计算比例。

没有来源时显示“尚未建立词汇估计”或准确的“已记录证据覆盖 0”，不得显示“掌握 0”。覆盖率不能命名为曝光率；活动与阅读范围未实现前不展示用户见过／读过次数。“已讲解 3 次”与“材料出现 5 次”可并列，各自标明来源，不合并为一个数字。

## 11. 查询性能、增量失效与重建

本节规定执行边界，不承诺尚未测量的响应时间；性能验收见 [实验 11](spike-checklist.md#11-证据查询与投影性能)。继续使用现有 SQLite 与本地任务机制，不以增加数据库／队列服务代替查询设计。

### 11.1 常用查询的成本边界

- 阅读器按当前页／选区的去重 Lexeme 集合批量取摘要与 SRS 状态，不逐 token 请求或执行 SQL；卡片／证据详情按需分页。无关历史增长不应使当前页退化为扫描全库 KE、ReviewEvent 或 KP 合并图。
- 材料覆盖读取该材料的稀疏词频集合与摘要，初次计算成本随材料不同 Lexeme 数增长；反复打开可复用有效聚合。全库概览使用跨材料可合并的汇总，词汇集合不能直接累加各材料去重计数；全库精确重算允许后台执行并返回进度。
- 最小索引访问路径：KE(scope, source, observed_at, id)、KE(import_run_id, lexeme_id)、decision(scope, decision_seq)、retraction(evidence_id)／retraction(import_run_id)、import_entry(run_id, entry_ordinal)、material_count(material_id, sidecar_id, lexeme_id) 与反向 (lexeme_id, material_id, sidecar_id)、KP lexical anchor 双向关联、ReviewEvent(review_item_id, event_sequence)、eligibility(lexeme_id, review_item_id)。scope 是 lexeme_id + scope_form_key；物理列顺序按实际谓词与查询计划验证，外键不替代必要索引。
- lexical_anchors 使用可索引的关联关系，不在常用查询中反复展开全库 JSON 数组。canonical 解析可建立有界、可重建的簇成员索引；始终保留原始身份与无环约束。
- SRS 只加载目标词的合格卡片算法输入，以一次请求统一 as_of 求值；不在读取页面时回放评分历史。摘要来源详情保存可追溯引用，不把全部历史正文复制进每词摘要。
- 一次响应使用一致的 generation、输入修订号和 as_of；多条 SQL 使用短读快照，或比较读取前后修订号并有界重试。较长计算在取出一致输入、结束短读事务后执行，不能拼接撤回前的摘要与撤回后的裁定。

### 11.2 变更与时间失效

事实／当前状态写入与持久化的受影响 scope 标记或等价变更序列**同一事务**。本地任务合并重复标记，按输入修订号更新摘要；旧任务不能覆盖较新决定。变更序列保留到所有活动刷新／重建消费者的持久游标越过（或按 generation 隔离 dirty）；当前代次处理完成不能清除新代次尚未消费的标记，游标与对应投影更新同次提交。用户写后读优先局部补算或叠加该条已提交裁定；不得等待异步全库重算后才生效。

| 触发 | 失效／更新范围 |
|---|---|
| KE／决定／撤回提交、导入发布或恢复 | 关联 Lexeme 与词形摘要；按反向索引标记相关材料聚合 |
| 评分与 ReviewState 更新 | 本卡资格摘要及目标词 SRS 输入；历史缺口阻止传播 |
| 换例句、KP 合并／撤销、lexical_anchors 改变 | 原目标和新目标、受影响卡片资格；不能只处理新 canonical |
| 新 sidecar、词典／消解迁移 | 新材料频次及受影响身份映射、资格和证据摘要；映射无法局部界定时建立完整新代次 |
| 规则／算法参数版本变化 | 所依赖的摘要／时间结果；资格与合成规则分别版本化 |
| 时间流逝且无任何写入 | 按统一 as_of 重新计算动态信号，或使到期结果缓存失效 |

高频词关联大量材料时，先持久标脏，优先刷新当前打开材料，其余合并后按需／后台处理，不让一次用户判断同步改写全库材料。异步处理须支持进度、取消／恢复和重试幂等；取消不撤销已经提交的用户事实。

### 11.3 导入与重建的发布边界

- 文件读取、模型无关消解与索引构建不持有长数据库写事务；暂存按有界批次复用参数化写入，不能逐行独立提交或全文件解析持锁。最终发布状态和失效序列用短事务提交；导入前后的查询分别看到完整旧结果或已发布新结果，缺少新摘要时按目标集补算或明确“更新中”。
- 完整重建在新 generation 中分批进行，记录起始输入修订号并消费同事务记录的后续变更；追平、校验后短事务比较修订号并切换当前代次，若又有变更则继续追平。不要在整个重建期间持有读／写事务；一条查询固定一个完整代次。
- 重建时旧口径仍合法则可带版本／求值时间展示，已失效则显示重算中；不能清空后把部分结果当最终值。保留读者仍引用的旧代次，释放后才清理派生数据，不删除被引用 sidecar／原始事实。
- 分批导入的发布不要求逐词摘要同事务全量重算，但所有领域读路径必须尊重发布／撤回屏障与输入版本。发布／批量撤回事务递增持久修订屏障，材料与全库聚合缓存也须核验：未追平则按受影响集合补算或明确更新中，不能在用户撤回后继续声称旧缓存为当前结果。屏障可按作用域划分；采用全局序号时，可用变更集合证明缓存依赖未受影响并推进修订，不应为每次小操作重建全库。后台崩溃不能遗漏失效，重启从持久进度恢复；页面请求不能回退到全库历史重放。

SQLite WAL 支持读写并行但仍只有一个写入者；本地写入排队、busy 重试有上限且可取消，避免导入／重建占满交互写入机会。长读事务与 checkpoint、磁盘空间／WAL 增长需纳入测量，不能用 WAL 代替短事务与有界任务。[SQLite WAL](https://www.sqlite.org/wal.html)、[事务说明](https://www.sqlite.org/lang_transaction.html)
